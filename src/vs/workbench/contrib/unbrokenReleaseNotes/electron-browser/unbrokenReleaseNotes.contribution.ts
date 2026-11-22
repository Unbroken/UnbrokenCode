/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import product from '../../../../platform/product/common/product.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { IReleaseNotesFeedService } from '../../../../platform/update/common/updateFeed.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { CONTEXT_UPDATE_STATE } from '../../update/browser/update.js';
import { tryParseVersion } from '../../update/common/updateUtils.js';
import { ShowCurrentReleaseNotesActionId } from '../../update/common/update.js';
import { compareVersions, ReleaseNotesKind } from '../common/unbrokenReleaseNotes.js';
import { IUnbrokenReleaseNotesService, UnbrokenReleaseNotesService } from '../browser/unbrokenReleaseNotesService.js';

registerMainProcessRemoteService(IReleaseNotesFeedService, 'releaseNotesFeed');
registerSingleton(IUnbrokenReleaseNotesService, UnbrokenReleaseNotesService, InstantiationType.Delayed);

// The release notes come from the release notes feed next to the update feeds, unless the product
// has release notes of its own, which the update contribution shows.
const isAvailable = !product.releaseNotesUrl && !!product.updateUrl;

/**
 * Shows the release notes of a version: of the running version, or what an update to a newer
 * version brings. The update tooltip and the post-update widget pass the version to show.
 */
class ShowReleaseNotesAction extends Action2 {
	constructor() {
		super({
			id: ShowCurrentReleaseNotesActionId,
			title: {
				...localize2('unbrokenReleaseNotes.show', "Show Release Notes"),
				mnemonicTitle: localize({ key: 'unbrokenReleaseNotes.mshow', comment: ['&& denotes a mnemonic'] }, "Show &&Release Notes"),
			},
			category: { value: product.nameShort, original: product.nameShort },
			f1: true,
			menu: [{
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 5,
			}],
		});
	}

	async run(accessor: ServicesAccessor, version?: unknown): Promise<void> {
		const releaseNotesService = accessor.get(IUnbrokenReleaseNotesService);
		const currentVersion = accessor.get(IProductService).version;
		const targetVersion = typeof version === 'string' ? version : currentVersion;
		await releaseNotesService.show(compareVersions(targetVersion, currentVersion) > 0
			? { kind: ReleaseNotesKind.Update, version: targetVersion, since: currentVersion }
			: { kind: ReleaseNotesKind.Current, version: targetVersion });
	}
}

/**
 * Shows what the update that is available, downloaded or ready to install brings.
 */
class ShowUpdateReleaseNotesAction extends Action2 {
	constructor() {
		const hasUpdate = ContextKeyExpr.or(
			CONTEXT_UPDATE_STATE.isEqualTo(StateType.AvailableForDownload),
			CONTEXT_UPDATE_STATE.isEqualTo(StateType.Downloaded),
			CONTEXT_UPDATE_STATE.isEqualTo(StateType.Ready),
		);
		super({
			id: 'unbrokenReleaseNotes.showUpdateReleaseNotes',
			title: localize2('unbrokenReleaseNotes.showUpdate', "Show Update Release Notes"),
			category: { value: product.nameShort, original: product.nameShort },
			f1: true,
			precondition: hasUpdate,
			menu: [{
				id: MenuId.GlobalActivity,
				group: '7_update',
				order: 1,
				when: hasUpdate,
			}],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const releaseNotesService = accessor.get(IUnbrokenReleaseNotesService);
		const currentVersion = accessor.get(IProductService).version;
		const state = accessor.get(IUpdateService).state;
		const version = state.type === StateType.AvailableForDownload || state.type === StateType.Downloaded || state.type === StateType.Ready ? state.update.productVersion : undefined;
		if (version) {
			await releaseNotesService.show({ kind: ReleaseNotesKind.Update, version, since: currentVersion });
		}
	}
}

/**
 * Shows the release notes as they are shown at the first start after an update from a version that
 * is entered, without an update, such as in builds from sources, which can't update.
 */
class SimulateRestartAfterUpdateAction extends Action2 {
	constructor() {
		super({
			id: '_unbrokenReleaseNotes.simulateRestartAfterUpdate',
			title: localize2('unbrokenReleaseNotes.simulateRestartAfterUpdate', "Simulate Restart After Update..."),
			category: Categories.Developer,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const releaseNotesService = accessor.get(IUnbrokenReleaseNotesService);
		const quickInputService = accessor.get(IQuickInputService);
		const currentVersion = accessor.get(IProductService).version;

		const since = await quickInputService.input({
			prompt: localize('unbrokenReleaseNotes.simulateRestartAfterUpdate.version', "The version that was updated from to {0}", currentVersion),
			placeHolder: localize('unbrokenReleaseNotes.simulateRestartAfterUpdate.example', "For example 1.144.67"),
			validateInput: async value => {
				if (!tryParseVersion(value)) {
					return localize('unbrokenReleaseNotes.simulateRestartAfterUpdate.invalid', "Enter a version like 1.2.3");
				}
				return compareVersions(value, currentVersion) < 0 ? undefined : localize('unbrokenReleaseNotes.simulateRestartAfterUpdate.notOlder', "Enter a version older than {0}", currentVersion);
			},
		});
		if (since) {
			await releaseNotesService.show({ kind: ReleaseNotesKind.Updated, version: currentVersion, since });
		}
	}
}

/**
 * Shows what changed since the version that was running before, after an update.
 */
class ShowReleaseNotesAfterUpdateContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.unbrokenReleaseNotesAfterUpdate';

	private static readonly LAST_VERSION_KEY = 'unbrokenReleaseNotes/lastVersion';

	/** The key the update contribution stores the last version in, which builds before this one stored. */
	private static readonly UPSTREAM_LAST_VERSION_KEY = 'releaseNotes/lastVersion';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IBrowserWorkbenchEnvironmentService private readonly environmentService: IBrowserWorkbenchEnvironmentService,
		@IHostService private readonly hostService: IHostService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IUnbrokenReleaseNotesService private readonly releaseNotesService: IUnbrokenReleaseNotesService,
	) {
		super();

		// Read the last version before the update contribution replaces it with this version
		const lastVersion = storageService.get(ShowReleaseNotesAfterUpdateContribution.LAST_VERSION_KEY, StorageScope.APPLICATION)
			?? storageService.get(ShowReleaseNotesAfterUpdateContribution.UPSTREAM_LAST_VERSION_KEY, StorageScope.APPLICATION);
		this.run(lastVersion).catch(onUnexpectedError);
	}

	private async run(lastVersion: string | undefined): Promise<void> {
		// Only the window that had the focus shows the release notes and stores the version, so
		// that the other windows that open with it don't store this version before it reads it
		await this.lifecycleService.when(LifecyclePhase.Restored);
		if (!await this.hostService.hadLastFocus()) {
			return;
		}

		// Another window that had the focus, such as one that lost it to this one while both were
		// restoring, may already have shown them
		const currentVersion = this.productService.version;
		if (lastVersion !== currentVersion && this.storageService.get(ShowReleaseNotesAfterUpdateContribution.LAST_VERSION_KEY, StorageScope.APPLICATION) === currentVersion) {
			return;
		}
		this.storageService.store(ShowReleaseNotesAfterUpdateContribution.LAST_VERSION_KEY, currentVersion, StorageScope.APPLICATION, StorageTarget.MACHINE);

		// A new installation has no last version, and shows Unbroken Code Setup instead
		if (!lastVersion || compareVersions(currentVersion, lastVersion) <= 0) {
			return;
		}

		if (this.environmentService.skipReleaseNotes || !this.configurationService.getValue<boolean>('update.showReleaseNotes')) {
			return;
		}

		await this.releaseNotesService.show({ kind: ReleaseNotesKind.Updated, version: currentVersion, since: lastVersion });
	}
}

if (isAvailable) {
	registerAction2(ShowReleaseNotesAction);
	registerAction2(ShowUpdateReleaseNotesAction);
	registerAction2(SimulateRestartAfterUpdateAction);
	registerWorkbenchContribution2(ShowReleaseNotesAfterUpdateContribution.ID, ShowReleaseNotesAfterUpdateContribution, WorkbenchPhase.BlockRestore);
}
