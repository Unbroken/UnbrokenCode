/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { UnbrokenOnboardingInput } from './unbrokenOnboardingInput.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { BaseOnboardingScreen, IOnboardingScreenNavigationEvent } from './screens/baseScreen.js';
import { FontSizeScreen } from './screens/fontSizeScreen.js';
import { ColorDesignScreen } from './screens/colorDesignScreen.js';
import { ColorThemeScreen } from './screens/colorThemeScreen.js';
import { EditorIntrusiveScreen } from './screens/editorIntrusiveScreen.js';
import './unbrokenOnboarding.css';
import './screens/editorIntrusiveScreen.css';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';

export class UnbrokenOnboardingPage extends EditorPane {

	public static readonly ID = 'unbrokenOnboardingPage';

	private container: HTMLElement | undefined;
	private screenContainer: HTMLElement | undefined;
	private screens: BaseOnboardingScreen[] = [];
	private currentScreenIndex: number = 0;
	private readonly screenDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchThemeService themeService: IWorkbenchThemeService,
		@IStorageService storageService: IStorageService
	) {
		super(UnbrokenOnboardingPage.ID, group, telemetryService, themeService, storageService);
		this.initializeScreens();
	}

	private initializeScreens(): void {
		// Initialize the onboarding screens
		// Start with the font size screen
		const fontSizeScreen = this.instantiationService.createInstance(FontSizeScreen);
		this.screens.push(fontSizeScreen);
		this._register(fontSizeScreen);

		// Add color design explanation screen
		const colorDesignScreen = this.instantiationService.createInstance(ColorDesignScreen);
		this.screens.push(colorDesignScreen);
		this._register(colorDesignScreen);

		// Add color theme screen
		const colorThemeScreen = this.instantiationService.createInstance(ColorThemeScreen);
		this.screens.push(colorThemeScreen);
		this._register(colorThemeScreen);

		// Add editor intrusiveness screen
		const editorIntrusiveScreen = this.instantiationService.createInstance(EditorIntrusiveScreen);
		this.screens.push(editorIntrusiveScreen);
		this._register(editorIntrusiveScreen);

		// Register navigation handlers for each screen
		this.screens.forEach(screen => {
			this._register(screen.onNavigate((e: IOnboardingScreenNavigationEvent) => {
				this.handleNavigation(e);
			}));
		});
	}

	private handleNavigation(event: IOnboardingScreenNavigationEvent): void {
		if (event.direction === 'skip') {
			// Skip all screens and close the onboarding
			this.completeOnboarding();
		} else if (event.direction === 'next') {
			// Move to next screen
			if (this.currentScreenIndex < this.screens.length - 1) {
				this.showScreen(this.currentScreenIndex + 1);
			} else {
				// Last screen completed
				this.completeOnboarding();
			}
		} else if (event.direction === 'previous') {
			// Move to previous screen
			if (this.currentScreenIndex > 0) {
				this.showScreen(this.currentScreenIndex - 1);
			}
		}
	}

	private showScreen(index: number): void {
		if (index < 0 || index >= this.screens.length || !this.screenContainer) {
			return;
		}

		// Deactivate current screen
		if (this.currentScreenIndex >= 0 && this.currentScreenIndex < this.screens.length) {
			this.screens[this.currentScreenIndex].onDeactivate();
		}

		// Clear the screen container
		clearNode(this.screenContainer);
		this.screenDisposables.clear();

		// Update current index
		this.currentScreenIndex = index;

		// Render new screen
		const screen = this.screens[index];
		screen.render(this.screenContainer);
		screen.onActivate();
	}

	private completeOnboarding(): void {
		// Close this editor
		this.group?.closeEditor(this.input);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.unbroken-onboarding-page'));
		this.screenContainer = append(this.container, $('.unbroken-onboarding-screens'));
	}

	override async setInput(input: UnbrokenOnboardingInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		// Show the first screen when the editor is opened
		if (this.screens.length > 0) {
			this.showScreen(0);
		}
	}

	override clearInput(): void {
		// Deactivate current screen
		if (this.currentScreenIndex >= 0 && this.currentScreenIndex < this.screens.length) {
			this.screens[this.currentScreenIndex].onDeactivate();
		}

		this.screenDisposables.clear();
		super.clearInput();
	}

	override dispose(): void {
		// Ensure current screen is deactivated before disposal
		if (this.currentScreenIndex >= 0 && this.currentScreenIndex < this.screens.length) {
			this.screens[this.currentScreenIndex].onDeactivate();
		}

		super.dispose();
	}

	override focus(): void {
		if (this.screenContainer) {
			this.screenContainer.focus();
		}
	}

	override layout(dimension: import('../../../../base/browser/dom.js').Dimension): void {
		// Layout can be handled by CSS, but if needed we can add logic here
		// The embedded editor has automaticLayout: true, so it will resize itself
	}
}
