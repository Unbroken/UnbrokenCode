/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { debounce, throttle } from '../../../../base/common/decorators.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { MergedEnvironmentVariableCollection } from '../../../../platform/terminal/common/environmentVariableCollection.js';
import { deserializeEnvironmentDescriptionMap, deserializeEnvironmentVariableCollection, serializeEnvironmentDescriptionMap, serializeEnvironmentVariableCollection } from '../../../../platform/terminal/common/environmentVariableShared.js';
import { IEnvironmentVariableCollectionWithPersistence, IEnvironmentVariableService } from './environmentVariable.js';
import { TerminalStorageKeys } from './terminalStorageKeys.js';
import { IMergedEnvironmentVariableCollection, ISerializableEnvironmentDescriptionMap, ISerializableEnvironmentVariableCollection } from '../../../../platform/terminal/common/environmentVariable.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { disposableTimeout, RunOnceScheduler } from '../../../../base/common/async.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';

const enum Constants {
	/**
	 * The maximum time to wait for extensions to update their collections.
	 */
	CollectionsUpdatedTimeout = 10000,
	/**
	 * How long an extension's collection needs to stay unchanged after an update for the update to
	 * be considered complete, extensions often set several variables in a row.
	 */
	CollectionUpdateQuietTime = 200,
	/**
	 * How long to wait for an extension to update its collection after it has finished activating,
	 * since extensions may update their collection asynchronously after activation.
	 */
	ActivationGraceTime = 1000
}

interface ISerializableExtensionEnvironmentVariableCollection {
	extensionIdentifier: string;
	collection: ISerializableEnvironmentVariableCollection;
	description?: ISerializableEnvironmentDescriptionMap;
}

/**
 * Tracks and persists environment variable collections as defined by extensions.
 */
export class EnvironmentVariableService extends Disposable implements IEnvironmentVariableService {
	declare readonly _serviceBrand: undefined;

	collections: Map<string, IEnvironmentVariableCollectionWithPersistence> = new Map();
	mergedCollection: IMergedEnvironmentVariableCollection;

	private readonly _onDidChangeCollections = this._register(new Emitter<IMergedEnvironmentVariableCollection>());
	get onDidChangeCollections(): Event<IMergedEnvironmentVariableCollection> { return this._onDidChangeCollections.event; }

	/**
	 * Extensions that have set or deleted their collection in this session.
	 */
	private readonly _updatedCollections = new Set<string>();
	private readonly _onDidUpdateCollection = this._register(new Emitter<string>());

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IStorageService private readonly _storageService: IStorageService
	) {
		super();

		this._storageService.remove(TerminalStorageKeys.DeprecatedEnvironmentVariableCollections, StorageScope.WORKSPACE);
		const serializedPersistedCollections = this._storageService.get(TerminalStorageKeys.EnvironmentVariableCollections, StorageScope.WORKSPACE);
		if (serializedPersistedCollections) {
			const collectionsJson: ISerializableExtensionEnvironmentVariableCollection[] = JSON.parse(serializedPersistedCollections);
			collectionsJson.forEach(c => this.collections.set(c.extensionIdentifier, {
				persistent: true,
				map: deserializeEnvironmentVariableCollection(c.collection),
				descriptionMap: deserializeEnvironmentDescriptionMap(c.description)
			}));

			// Asynchronously invalidate collections where extensions have been uninstalled, this is
			// async to avoid making all functions on the service synchronous and because extensions
			// being uninstalled is rare.
			this._invalidateExtensionCollections();
		}
		this.mergedCollection = this._resolveMergedCollection();

		// Listen for uninstalled/disabled extensions
		this._register(this._extensionService.onDidChangeExtensions(() => this._invalidateExtensionCollections()));
	}

	set(extensionIdentifier: string, collection: IEnvironmentVariableCollectionWithPersistence): void {
		this.collections.set(extensionIdentifier, collection);
		this._updateCollections();
		this._markCollectionUpdated(extensionIdentifier);
	}

	delete(extensionIdentifier: string): void {
		this.collections.delete(extensionIdentifier);
		this._updateCollections();
		this._markCollectionUpdated(extensionIdentifier);
	}

	private _markCollectionUpdated(extensionIdentifier: string): void {
		this._updatedCollections.add(extensionIdentifier);
		this._onDidUpdateCollection.fire(extensionIdentifier);
	}

	async whenCollectionsUpdated(extensionIdentifiers: readonly string[]): Promise<void> {
		const store = new DisposableStore();
		try {
			await new Promise<void>(resolve => {
				store.add(disposableTimeout(resolve, Constants.CollectionsUpdatedTimeout));
				this._extensionService.whenInstalledExtensionsRegistered().then(() => {
					if (store.isDisposed) {
						return;
					}
					const pending = new Set(extensionIdentifiers.filter(e => this._activatesOnStartup(e)));
					const settle = (extensionIdentifier: string) => {
						pending.delete(extensionIdentifier);
						if (pending.size === 0) {
							resolve();
						}
					};
					const schedulers = new Map<string, RunOnceScheduler>();
					const update = (extensionIdentifier: string) => {
						const scheduler = schedulers.get(extensionIdentifier);
						if (!scheduler) {
							return;
						}
						if (this._updatedCollections.has(extensionIdentifier)) {
							// An extension that had already settled is pending again until its new
							// update has settled too
							pending.add(extensionIdentifier);
							scheduler.schedule(Constants.CollectionUpdateQuietTime);
						} else if (pending.has(extensionIdentifier) && !scheduler.isScheduled() && this._extensionService.getExtensionsStatus()[extensionIdentifier]?.activationTimes) {
							scheduler.schedule(Constants.ActivationGraceTime);
						}
					};
					for (const extensionIdentifier of pending) {
						schedulers.set(extensionIdentifier, store.add(new RunOnceScheduler(() => settle(extensionIdentifier), 0)));
					}
					store.add(this._onDidUpdateCollection.event(update));
					store.add(this._extensionService.onDidChangeExtensionsStatus(ids => ids.forEach(id => update(id.value))));
					if (pending.size === 0) {
						resolve();
						return;
					}
					pending.forEach(update);
				});
			});
		} finally {
			store.dispose();
		}
	}

	/**
	 * Whether an extension is installed and will activate without further user interaction.
	 * `workspaceContains:` activation events are not considered since they are conditional, an
	 * extension whose pattern doesn't match would otherwise be waited for until the timeout.
	 */
	private _activatesOnStartup(extensionIdentifier: string): boolean {
		const extension = this._extensionService.extensions.find(e => ExtensionIdentifier.equals(e.identifier, extensionIdentifier));
		return !!extension?.activationEvents?.some(e => e === '*' || e === 'onStartupFinished');
	}

	private _updateCollections(): void {
		this._persistCollectionsEventually();
		this.mergedCollection = this._resolveMergedCollection();
		this._notifyCollectionUpdatesEventually();
	}

	@throttle(1000)
	private _persistCollectionsEventually(): void {
		this._persistCollections();
	}

	protected _persistCollections(): void {
		const collectionsJson: ISerializableExtensionEnvironmentVariableCollection[] = [];
		this.collections.forEach((collection, extensionIdentifier) => {
			if (collection.persistent) {
				collectionsJson.push({
					extensionIdentifier,
					collection: serializeEnvironmentVariableCollection(this.collections.get(extensionIdentifier)!.map),
					description: serializeEnvironmentDescriptionMap(collection.descriptionMap)
				});
			}
		});
		const stringifiedJson = JSON.stringify(collectionsJson);
		this._storageService.store(TerminalStorageKeys.EnvironmentVariableCollections, stringifiedJson, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	@debounce(1000)
	private _notifyCollectionUpdatesEventually(): void {
		this._notifyCollectionUpdates();
	}

	protected _notifyCollectionUpdates(): void {
		this._onDidChangeCollections.fire(this.mergedCollection);
	}

	private _resolveMergedCollection(): IMergedEnvironmentVariableCollection {
		return new MergedEnvironmentVariableCollection(this.collections);
	}

	private async _invalidateExtensionCollections(): Promise<void> {
		await this._extensionService.whenInstalledExtensionsRegistered();
		const registeredExtensions = this._extensionService.extensions;
		let changes = false;
		this.collections.forEach((_, extensionIdentifier) => {
			const isExtensionRegistered = registeredExtensions.some(r => r.identifier.value === extensionIdentifier);
			if (!isExtensionRegistered) {
				this.collections.delete(extensionIdentifier);
				changes = true;
			}
		});
		if (changes) {
			this._updateCollections();
		}
	}
}
