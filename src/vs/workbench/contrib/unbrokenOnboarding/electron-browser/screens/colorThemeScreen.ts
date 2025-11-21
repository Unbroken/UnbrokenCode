/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseOnboardingScreen } from './baseScreen.js';
import { append, $ } from '../../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { SAMPLE_CPP_CODE, SAMPLE_CPP_COLOR_DESIGN, SAMPLE_TYPESCRIPT_CODE, SAMPLE_RUST_CODE } from '../../common/unbrokenOnboardingConstants.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { IWorkbenchThemeService, IWorkbenchColorTheme } from '../../../../services/themes/common/workbenchThemeService.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

interface ThemeOption {
	readonly settingsId: string;
	readonly label: string;
	readonly description: string;
	readonly byline: string;
}

const THEME_OPTIONS: ThemeOption[] = [
	{
		settingsId: 'Malterlib',
		label: 'Default',
		description: 'Malterlib',
		byline: 'We both know you\'re picking this one. Let\'s not pretend otherwise.'
	},
	{
		settingsId: 'Malterlib (sRGB)',
		label: 'Dull Colors',
		description: 'Malterlib (sRGB)',
		byline: 'For the tastefully risk-averse. There\'s dignity in playing it safe. Somewhere.'
	},
	{
		settingsId: 'Malterlib (Dark Modern Syntax)',
		label: 'Familiar',
		description: 'Malterlib (Dark Modern Syntax)',
		byline: 'For those emotionally attached to VS Code\'s default syntax highlighting. The first step is admitting you have a problem.'
	}
];

export class ColorThemeScreen extends BaseOnboardingScreen {

	private selectedThemeId: string;
	private themeOptionElements: Map<string, HTMLElement> = new Map();
	private availableThemes: IWorkbenchColorTheme[] = [];
	private pendingOverlayTimeout: IDisposable | undefined;
	private pendingTokensListener: IDisposable | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILanguageService languageService: ILanguageService,
		@IExtensionService extensionService: IExtensionService,
		@IStorageService storageService: IStorageService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService
	) {
		super(
			instantiationService,
			modelService,
			configurationService,
			languageService,
			extensionService,
			storageService,
			lifecycleService
		);

		// Initialize selected theme from current user settings
		const currentTheme = this.themeService.getColorTheme();
		this.selectedThemeId = currentTheme.settingsId || 'Malterlib';
	}

	get title(): string {
		return 'Unbroken Code Setup - Choose Your Color Theme';
	}

	get description(): string {
		return 'Alright, you\'ve seen the science: color-coded semantics + black background = your brain on fast-forward. Time to commit to a Malterlib variant. We offer three ' +
			'options, though calling them "options" implies they\'re equally valid choices. They\'re not. But hey, free will and all that. You can change this later in Settings or re-run ' +
			'this setup from Help → Open Unbroken Code Setup.';
	}

	async render(parent: HTMLElement): Promise<void> {
		this.container = append(parent, $('.color-theme-screen'));

		// Load available themes first
		await this.loadThemes();

		// Create header
		this.createHeader(this.container);

		// Create content area
		const content = append(this.container, $('.onboarding-screen-content'));

		// Create theme selector
		this.createThemeSelector(content);

		// Create preview editor
		this.createPreviewEditorWithLanguages(content);

		// Create footer with navigation
		this.createFooter(this.container, { showSkip: true, showPrevious: true, nextLabel: 'Continue', settingsApplyMode: 'realtime' });
	}

	private async loadThemes(): Promise<void> {
		const allThemes = await this.themeService.getColorThemes();

		// Find the Malterlib theme variants
		this.availableThemes = THEME_OPTIONS
			.map(option => allThemes.find(t => t.settingsId === option.settingsId))
			.filter((t): t is IWorkbenchColorTheme => t !== undefined);

		// If we couldn't find the currently selected theme, default to 'Malterlib'
		if (!this.availableThemes.find(t => t.settingsId === this.selectedThemeId)) {
			this.selectedThemeId = 'Malterlib';
		}
	}

	private createThemeSelector(parent: HTMLElement): void {
		const selectorContainer = append(parent, $('.color-theme-selector'));

		const label = append(selectorContainer, $('label.color-theme-label'));
		label.textContent = 'Color Theme:';

		const optionsContainer = append(selectorContainer, $('.color-theme-options'));

		THEME_OPTIONS.forEach(themeOption => {
			const option = append(optionsContainer, $('.color-theme-option'));

			// Radio input (hidden, controlled by clicking the entire option)
			const radio = append(option, $('input.color-theme-radio')) as HTMLInputElement;
			radio.type = 'radio';
			radio.name = 'colorTheme';
			radio.value = themeOption.settingsId;
			radio.id = `colorTheme${themeOption.settingsId.replace(/[^a-zA-Z0-9]/g, '')}`;
			radio.checked = themeOption.settingsId === this.selectedThemeId;

			// Content wrapper
			const textWrapper = append(option, $('.color-theme-option-text'));

			const labelDisplay = append(textWrapper, $('.color-theme-option-label'));
			labelDisplay.textContent = themeOption.label;

			const bylineElement = append(textWrapper, $('.color-theme-option-byline'));
			bylineElement.textContent = themeOption.byline;

			// Store reference to the option element
			this.themeOptionElements.set(themeOption.settingsId, option);

			this._register(this.addDisposableListener(radio, 'change', () => {
				if (radio.checked) {
					this.selectedThemeId = themeOption.settingsId;
					this.updatePreview();
				}
			}));

			// Make the entire option container clickable
			this._register(this.addDisposableListener(option, 'click', () => {
				radio.checked = true;
				this.selectedThemeId = themeOption.settingsId;
				this.updatePreview();
			}));
		});
	}

	private createPreviewEditorWithLanguages(parent: HTMLElement): void {
		// Create the preview editor using the base class method with multiple languages
		super.createPreviewEditor(parent, {
			languages: [
				{
					language: 'C++',
					languageId: 'cpp',
					code: SAMPLE_CPP_CODE,
					uri: 'inmemory://onboarding/preview.cpp'
				},
				{
					language: 'C++ Color Demo',
					languageId: 'cpp',
					code: SAMPLE_CPP_COLOR_DESIGN,
					uri: 'inmemory://onboarding/preview-color.cpp'
				},
				{
					language: 'TypeScript',
					languageId: 'typescript',
					code: SAMPLE_TYPESCRIPT_CODE,
					uri: 'inmemory://onboarding/preview.ts'
				},
				{
					language: 'Rust',
					languageId: 'rust',
					code: SAMPLE_RUST_CODE,
					uri: 'inmemory://onboarding/preview.rs'
				}
			],
			defaultLanguage: 'cpp'
		});

		// Update preview to apply current theme
		this.updatePreview();
	}

	private async updatePreview(): Promise<void> {
		if (!this.previewEditor) {
			return;
		}

		// Check if the selected theme is already applied
		const currentTheme = this.themeService.getColorTheme();
		if (currentTheme.settingsId === this.selectedThemeId) {
			// Theme is already active, no need to update
			return;
		}

		// Cancel any pending operations from previous theme change
		this.cancelPendingOverlayOperations();

		this.showEditorOverlay();

		// Apply the selected theme and save to settings
		await this.applySettings();

		// Wait for semantic tokens to complete before hiding overlay
		const model = this.previewEditor.getModel();
		if (model) {
			let timeoutCleared = false;

			// Listen for semantic token changes
			this.pendingTokensListener = model.onDidChangeTokens((e) => {
				if (e.semanticTokensApplied && !timeoutCleared) {
					timeoutCleared = true;
					this.hideEditorOverlay();
					this.cancelPendingOverlayOperations();
				}
			});

			// Fallback timeout in case semantic tokens never arrive
			// (e.g., no semantic token provider registered)
			this.pendingOverlayTimeout = disposableTimeout(() => {
				if (!timeoutCleared) {
					timeoutCleared = true;
					this.hideEditorOverlay();
					this.cancelPendingOverlayOperations();
				}
			}, 1000);
		} else {
			// No model, hide immediately
			this.hideEditorOverlay();
		}
	}

	private cancelPendingOverlayOperations(): void {
		if (this.pendingOverlayTimeout) {
			this.pendingOverlayTimeout.dispose();
			this.pendingOverlayTimeout = undefined;
		}
		if (this.pendingTokensListener) {
			this.pendingTokensListener.dispose();
			this.pendingTokensListener = undefined;
		}
	}

	override onActivate(): void {
		// Call base class onActivate (handles layoutEditor and malterlib)
		super.onActivate();

		// Apply the selected theme when screen becomes active
		this.updatePreview();
	}

	override async applySettings(): Promise<void> {
		// Find the selected theme
		const theme = this.availableThemes.find(t => t.settingsId === this.selectedThemeId);

		if (theme) {
			// Apply and save to user settings
			await this.themeService.setColorTheme(theme.id, ConfigurationTarget.USER);
		}
	}
}
