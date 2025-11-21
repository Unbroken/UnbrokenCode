/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { UnbrokenOnboardingInput, unbrokenOnboardingInputTypeId } from './unbrokenOnboardingInput.js';
import { UnbrokenOnboardingPage } from './unbrokenOnboarding.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ILifecycleService, LifecyclePhase, StartupKind } from '../../../services/lifecycle/common/lifecycle.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { UNBROKEN_ONBOARDING_STORAGE_KEY } from '../common/unbrokenOnboardingConstants.js';
import { registerAction2, Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { GettingStartedInput } from '../../welcomeGettingStarted/browser/gettingStartedInput.js';

// Import to ensure the configuration override manager contribution is registered
import './configurationOverrideManager.contribution.js';

// Register the editor pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		UnbrokenOnboardingPage,
		UnbrokenOnboardingPage.ID,
		'Unbroken Code Setup'
	),
	[new SyncDescriptor(UnbrokenOnboardingInput)]
);

// Register the editor serializer
class UnbrokenOnboardingInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(): string {
		return '';
	}

	deserialize(instantiationService: IInstantiationService): UnbrokenOnboardingInput {
		return instantiationService.createInstance(UnbrokenOnboardingInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	unbrokenOnboardingInputTypeId,
	UnbrokenOnboardingInputSerializer
);

// Register editor resolver for the onboarding
class UnbrokenOnboardingEditorResolverContribution extends Disposable {
	static readonly ID = 'workbench.contrib.unbrokenOnboardingEditorResolver';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorResolverService editorResolverService: IEditorResolverService
	) {
		super();
		const disposables = new DisposableStore();
		this._register(disposables);

		editorResolverService.registerEditor(
			`${UnbrokenOnboardingInput.RESOURCE.scheme}:/**`,
			{
				id: UnbrokenOnboardingInput.ID,
				label: localize('unbrokenOnboarding.displayName', "Unbroken Code Setup"),
				priority: RegisteredEditorPriority.builtin,
			},
			{
				singlePerResource: false,
				canSupportResource: uri => uri.scheme === UnbrokenOnboardingInput.RESOURCE.scheme && uri.authority === 'unbroken_onboarding',
			},
			{
				createEditorInput: ({ options }) => {
					return {
						editor: disposables.add(this.instantiationService.createInstance(UnbrokenOnboardingInput)),
						options: {
							...options,
							pinned: options?.pinned ?? false
						}
					};
				}
			}
		);
	}
}

// Contribution to show onboarding on first launch
class UnbrokenOnboardingContribution extends Disposable {
	static readonly ID = 'workbench.contrib.unbrokenOnboarding';

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

		// Check if this is the first launch
		const hasCompletedOnboarding = this.storageService.get(
			UNBROKEN_ONBOARDING_STORAGE_KEY,
			StorageScope.APPLICATION
		);

		// Only show onboarding if:
		// 1. User hasn't completed it before
		// 2. This is not a reload (StartupKind.ReloadedWindow)
		const startupKind = this.lifecycleService.startupKind;

		if (!hasCompletedOnboarding && startupKind !== StartupKind.ReloadedWindow) {
			// Mark as shown (not completed, just shown)
			// This prevents showing it multiple times
			this.storageService.store(
				UNBROKEN_ONBOARDING_STORAGE_KEY,
				true,
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);

			// Open the welcome page behind the onboarding editor so it's
			// visible when the user finishes or closes onboarding.
			await this.editorService.openEditor({
				resource: GettingStartedInput.RESOURCE,
				options: {
					override: GettingStartedInput.ID,
					pinned: true,
					inactive: true
				}
			});

			// Open the onboarding editor on top
			await this.editorService.openEditor({
				resource: UnbrokenOnboardingInput.RESOURCE,
				options: {
					override: UnbrokenOnboardingInput.ID,
					pinned: true
				}
			});
		}
	}
}

// Register the editor resolver
registerWorkbenchContribution2(
	UnbrokenOnboardingEditorResolverContribution.ID,
	UnbrokenOnboardingEditorResolverContribution,
	WorkbenchPhase.BlockRestore
);

// Register the contribution to run at BlockRestore phase to show before workspace
registerWorkbenchContribution2(
	UnbrokenOnboardingContribution.ID,
	UnbrokenOnboardingContribution,
	WorkbenchPhase.BlockRestore
);

// Register command to open onboarding
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openUnbrokenOnboarding',
			title: localize2('openUnbrokenOnboarding', 'Open Unbroken Code Setup'),
			category: Categories.Help,
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 2,
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(IEditorService);

		editorService.openEditor({
			resource: UnbrokenOnboardingInput.RESOURCE,
			options: {
				override: UnbrokenOnboardingInput.ID,
				pinned: false
			}
		});
	}
});
