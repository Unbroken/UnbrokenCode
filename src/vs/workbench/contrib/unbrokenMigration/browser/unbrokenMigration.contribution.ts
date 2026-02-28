/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { UnbrokenMigrationInput, unbrokenMigrationInputTypeId } from './unbrokenMigrationInput.js';
import { UnbrokenMigrationPage } from './unbrokenMigration.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ILifecycleService, LifecyclePhase, StartupKind } from '../../../services/lifecycle/common/lifecycle.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { UNBROKEN_MIGRATION_STORAGE_KEY } from '../common/unbrokenMigrationConstants.js';
import { UNBROKEN_ONBOARDING_STORAGE_KEY } from '../../unbrokenOnboarding/common/unbrokenOnboardingConstants.js';
import { registerAction2, Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';

// Register the editor pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		UnbrokenMigrationPage,
		UnbrokenMigrationPage.ID,
		'Command Line Name Change'
	),
	[new SyncDescriptor(UnbrokenMigrationInput)]
);

// Register the editor serializer
class UnbrokenMigrationInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(): string {
		return '';
	}

	deserialize(instantiationService: IInstantiationService): UnbrokenMigrationInput {
		return instantiationService.createInstance(UnbrokenMigrationInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	unbrokenMigrationInputTypeId,
	UnbrokenMigrationInputSerializer
);

// Register editor resolver for the migration page
class UnbrokenMigrationEditorResolverContribution extends Disposable {
	static readonly ID = 'workbench.contrib.unbrokenMigrationEditorResolver';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorResolverService editorResolverService: IEditorResolverService
	) {
		super();
		const disposables = new DisposableStore();
		this._register(disposables);

		editorResolverService.registerEditor(
			`${UnbrokenMigrationInput.RESOURCE.scheme}:/**`,
			{
				id: UnbrokenMigrationInput.ID,
				label: localize('unbrokenMigration.displayName', "Command Line Name Change"),
				priority: RegisteredEditorPriority.builtin,
			},
			{
				singlePerResource: false,
				canSupportResource: uri => uri.scheme === UnbrokenMigrationInput.RESOURCE.scheme && uri.authority === 'unbroken_migration',
			},
			{
				createEditorInput: ({ resource, options }) => {
					return {
						editor: disposables.add(this.instantiationService.createInstance(UnbrokenMigrationInput)),
						options: {
							...options,
							pinned: false
						}
					};
				}
			}
		);
	}
}

// Contribution to show migration screen on first launch after update for existing users
class UnbrokenMigrationContribution extends Disposable {
	static readonly ID = 'workbench.contrib.unbrokenMigration';

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IStorageService private readonly storageService: IStorageService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService
	) {
		super();
		this.run();
	}

	private async run(): Promise<void> {
		// Wait for the workbench to be restored
		await this.lifecycleService.when(LifecyclePhase.Restored);

		// Already shown?
		const hasShownMigration = this.storageService.get(
			UNBROKEN_MIGRATION_STORAGE_KEY,
			StorageScope.APPLICATION
		);
		if (hasShownMigration) {
			return;
		}

		// Mark as shown immediately so it never triggers again,
		// regardless of whether we actually display it below.
		this.storageService.store(
			UNBROKEN_MIGRATION_STORAGE_KEY,
			'true',
			StorageScope.APPLICATION,
			StorageTarget.MACHINE
		);

		// Only show for existing users who already completed onboarding.
		// New users start fresh with "uc" and don't need migration info.
		const hasCompletedOnboarding = this.storageService.get(
			UNBROKEN_ONBOARDING_STORAGE_KEY,
			StorageScope.APPLICATION
		);
		if (!hasCompletedOnboarding) {
			return;
		}

		// Don't show on window reload
		if (this.lifecycleService.startupKind === StartupKind.ReloadedWindow) {
			return;
		}

		// Open the migration editor
		await this.editorService.openEditor({
			resource: UnbrokenMigrationInput.RESOURCE,
			options: {
				override: UnbrokenMigrationInput.ID,
				pinned: false
			}
		});
	}
}

// Register the editor resolver
registerWorkbenchContribution2(
	UnbrokenMigrationEditorResolverContribution.ID,
	UnbrokenMigrationEditorResolverContribution,
	WorkbenchPhase.BlockRestore
);

// Register the contribution to run at BlockRestore phase
registerWorkbenchContribution2(
	UnbrokenMigrationContribution.ID,
	UnbrokenMigrationContribution,
	WorkbenchPhase.BlockRestore
);

// Register command to manually open migration screen
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openUnbrokenMigration',
			title: localize2('openUnbrokenMigration', 'Show Command Line Name Change'),
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 3,
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(IEditorService);

		editorService.openEditor({
			resource: UnbrokenMigrationInput.RESOURCE,
			options: {
				override: UnbrokenMigrationInput.ID,
				pinned: false
			}
		});
	}
});
