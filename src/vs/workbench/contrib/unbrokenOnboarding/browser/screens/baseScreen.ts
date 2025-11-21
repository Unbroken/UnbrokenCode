/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { append, $ } from '../../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ConfigurationOverrideManager } from '../configurationOverrideManager.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { deepClone } from '../../../../../base/common/objects.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { isObject } from '../../../../../base/common/types.js';

export interface IOnboardingScreenNavigationEvent {
	direction: 'next' | 'previous' | 'skip';
}

export interface ILanguageSample {
	language: string;
	languageId: string;
	code: string;
	uri: string;
}

export interface IPreviewEditorConfig {
	languages: ILanguageSample[];
	defaultLanguage?: string;
	configOverrides?: Record<string, any>;
	readOnly?: boolean;
}

export abstract class BaseOnboardingScreen extends Disposable {

	private readonly _onNavigate = this._register(new Emitter<IOnboardingScreenNavigationEvent>());
	readonly onNavigate: Event<IOnboardingScreenNavigationEvent> = this._onNavigate.event;

	protected container: HTMLElement | undefined;
	protected previewEditor: CodeEditorWidget | undefined;
	protected editorContainer: HTMLElement | undefined;
	protected editorWrapper: HTMLElement | undefined;
	protected overlayElement: HTMLElement | undefined;
	protected configOverrideManager: ConfigurationOverrideManager;
	protected languageSamples: ILanguageSample[] = [];
	protected currentLanguageIndex: number = 0;
	protected currentConfigOverrides?: Record<string, any>;

	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IModelService protected readonly modelService: IModelService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@ILanguageService protected readonly languageService: ILanguageService,
		@IExtensionService protected readonly extensionService: IExtensionService,
		@IStorageService storageService: IStorageService,
		@ILifecycleService lifecycleService: ILifecycleService
	) {
		super();

		// Get the singleton manager instance
		this.configOverrideManager = ConfigurationOverrideManager.getInstance(
			storageService,
			configurationService,
			lifecycleService
		);
	}

	abstract get title(): string;
	abstract get description(): string;

	/**
	 * Render the screen content into the provided parent element
	 */
	abstract render(parent: HTMLElement): void;

	/**
	 * Called when the screen becomes active
	 */
	onActivate(): void {
		// Layout editor when screen becomes active (if preview editor exists)
		if (this.previewEditor && this.currentConfigOverrides) {
			this.layoutEditor();
			// Re-apply the configuration overrides for the preview
			this.configOverrideManager.enableForPreview(this.extensionService, this.currentConfigOverrides);
		}
	}

	/**
	 * Called when the screen becomes inactive
	 */
	onDeactivate(): void {
		// Restore the configuration overrides when leaving the screen (if preview editor exists)
		if (this.previewEditor) {
			this.configOverrideManager.restoreOriginalConfiguration();
		}
	}

	/**
	 * Apply any settings changes made in this screen
	 */
	abstract applySettings(): Promise<void>;

	protected navigate(direction: 'next' | 'previous' | 'skip'): void {
		this._onNavigate.fire({ direction });
	}

	protected createHeader(parent: HTMLElement): void {
		const header = append(parent, $('.onboarding-screen-header'));
		const titleElement = append(header, $('h1.onboarding-screen-title'));
		titleElement.textContent = this.title;

		if (this.description) {
			const descElement = append(header, $('p.onboarding-screen-description'));
			descElement.textContent = this.description;
		}
	}

	protected createFooter(parent: HTMLElement, options: {
		showSkip?: boolean;
		showPrevious?: boolean;
		nextLabel?: string;
		settingsApplyMode?: 'realtime' | 'onfinish';
	} = {}): void {
		const footer = append(parent, $('.onboarding-screen-footer'));

		if (options.showSkip) {
			const skipButton = append(footer, $('button.onboarding-button.secondary'));
			skipButton.textContent = 'Exit Setup';
			this._register(this.addDisposableListener(skipButton, 'click', () => {
				this.navigate('skip');
			}));
		}

		// Add settings apply note if mode is specified
		if (options.settingsApplyMode) {
			const note = append(footer, $('.onboarding-footer-note'));
			note.textContent = options.settingsApplyMode === 'realtime'
				? 'Try it out - changes save instantly'
				: 'Review your choices, then click Finish to apply';
		}

		const buttonGroup = append(footer, $('.onboarding-button-group'));

		if (options.showPrevious) {
			const previousButton = append(buttonGroup, $('button.onboarding-button.secondary'));
			previousButton.textContent = 'Previous';
			this._register(this.addDisposableListener(previousButton, 'click', () => {
				this.navigate('previous');
			}));
		}

		const nextButton = append(buttonGroup, $('button.onboarding-button.primary'));
		nextButton.textContent = options.nextLabel || 'Continue';
		this._register(this.addDisposableListener(nextButton, 'click', async () => {
			await this.applySettings();
			this.navigate('next');
		}));
	}

	protected addDisposableListener(element: HTMLElement, event: string, handler: EventListener): IDisposable {
		element.addEventListener(event, handler);
		return {
			dispose: () => element.removeEventListener(event, handler)
		};
	}

	/**
	 * Get editor options with user font settings from configuration
	 */
	private getEditorOptions(previewConfig: IPreviewEditorConfig): IEditorOptions {
		// Read ALL editor settings from user configuration
		const config = deepClone(this.configurationService.getValue<IEditorOptions>('editor'));
		return {
			...isObject(config) ? config : Object.create(null),
			// Override specific options for the preview editor
			readOnly: previewConfig.readOnly ?? false,
			minimap: { enabled: false },
			lineNumbers: 'on',
			scrollBeyondLastLine: false,
			automaticLayout: false,
			scrollbar: {
				vertical: 'auto',
				horizontal: 'auto'
			},
			renderLineHighlight: previewConfig.readOnly ? 'line' : 'none',
			occurrencesHighlight: 'off',
			selectionHighlight: false,
			stickyScroll: { enabled: false },
		};
	}

	/**
	 * Create a preview editor with the specified configuration
	 */
	protected createPreviewEditor(parent: HTMLElement, config: IPreviewEditorConfig): void {
		this.languageSamples = config.languages;

		// Find default language index
		if (config.defaultLanguage) {
			const index = this.languageSamples.findIndex(lang => lang.languageId === config.defaultLanguage);
			if (index !== -1) {
				this.currentLanguageIndex = index;
			}
		}

		const previewContainer = append(parent, $('.preview-editor-container'));

		const previewHeader = append(previewContainer, $('.preview-header'));
		const previewLabel = append(previewHeader, $('label.preview-label'));
		previewLabel.textContent = 'Preview:';

		// Add language switcher if multiple languages are available
		if (this.languageSamples.length > 1) {
			const languageSwitcher = append(previewHeader, $('.language-switcher'));

			this.languageSamples.forEach((langSample, index) => {
				const button = append(languageSwitcher, $('button.language-button')) as HTMLButtonElement;
				button.textContent = langSample.language;
				button.type = 'button';

				if (index === this.currentLanguageIndex) {
					button.classList.add('active');
				}

				this._register(this.addDisposableListener(button, 'click', () => {
					if (this.currentLanguageIndex !== index) {
						// Remove active class from all buttons
						const buttons = languageSwitcher.querySelectorAll('.language-button');
						buttons.forEach(btn => btn.classList.remove('active'));

						// Add active class to clicked button
						button.classList.add('active');

						// Switch to the new language
						this.currentLanguageIndex = index;
						this.switchLanguage();
					}
				}));
			});
		}

		this.editorWrapper = append(previewContainer, $('.preview-editor'));
		this.editorWrapper.style.border = '1px solid var(--vscode-editorWidget-border)';
		this.editorWrapper.style.display = 'flex';
		this.editorWrapper.style.flexDirection = 'column';
		this.editorWrapper.style.position = 'relative';

		// Create an inner container that will auto-size to fill the wrapper
		this.editorContainer = append(this.editorWrapper, $('div'));
		this.editorContainer.style.flex = '1';
		this.editorContainer.style.minHeight = '0';

		// Create overlay element (initially hidden) to prevent flickering during theme changes
		this.overlayElement = append(this.editorWrapper, $('.editor-overlay'));
		this.overlayElement.style.position = 'absolute';
		this.overlayElement.style.top = '0';
		this.overlayElement.style.left = '0';
		this.overlayElement.style.right = '0';
		this.overlayElement.style.bottom = '0';
		this.overlayElement.style.backgroundColor = 'var(--vscode-editor-background)';
		this.overlayElement.style.display = 'none';
		this.overlayElement.style.zIndex = '1000';

		// Create the editor widget with user font settings from configuration
		this.previewEditor = this.instantiationService.createInstance(
			CodeEditorWidget,
			this.editorContainer,
			this.getEditorOptions(config),
			{}
		);

		// Create model for the current language
		this.loadLanguageModel();

		// Enable configuration overrides through the centralized manager
		// Merge with default malterlib semantic coloring setting
		this.currentConfigOverrides = {
			'malterlib.enableSemanticColoring': true,
			...config.configOverrides
		};
		this.configOverrideManager.enableForPreview(this.extensionService, this.currentConfigOverrides);

		// Register cleanup for configuration overrides
		this._register({
			dispose: () => {
				this.configOverrideManager.restoreOriginalConfiguration();
			}
		});

		// Register disposables
		this._register(this.previewEditor);

		// Listen for configuration changes to update editor font settings
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor') && this.previewEditor) {
				this.previewEditor.updateOptions(this.getEditorOptions(config));
			}
		}));

		// Set up resize observer to update layout when container size changes
		const resizeObserver = new ResizeObserver(() => {
			this.layoutEditor();
		});
		resizeObserver.observe(this.editorContainer);
		this._register({
			dispose: () => {
				resizeObserver.disconnect();
			}
		});

		// Force initial layout after a short delay to ensure proper sizing
		setTimeout(() => {
			this.layoutEditor();
		}, 0);
	}

	/**
	 * Load the model for the current language
	 */
	private loadLanguageModel(): void {
		if (!this.previewEditor || this.languageSamples.length === 0) {
			return;
		}

		const currentSample = this.languageSamples[this.currentLanguageIndex];
		const languageSelection = this.languageService.createById(currentSample.languageId);
		const dummyUri = URI.parse(currentSample.uri);

		// Check if a model with this URI already exists, otherwise create a new one
		let model = this.modelService.getModel(dummyUri);
		if (!model) {
			model = this.modelService.createModel(currentSample.code, languageSelection, dummyUri);
			// Only register disposal for new models
			this._register(model);
		}

		this.previewEditor.setModel(model);
	}

	/**
	 * Switch to a different language sample
	 */
	private switchLanguage(): void {
		this.loadLanguageModel();
		this.layoutEditor();
	}

	/**
	 * Layout the preview editor based on container dimensions
	 */
	protected layoutEditor(): void {
		if (this.previewEditor && this.editorContainer) {
			const rect = this.editorContainer.getBoundingClientRect();
			const width = rect.width;
			const height = rect.height;
			if (width > 0 && height > 0) {
				this.previewEditor.layout({ width, height });
			}
		}
	}

	/**
	 * Update editor options
	 */
	protected updateEditorOptions(options: any): void {
		if (this.previewEditor) {
			this.previewEditor.updateOptions(options);
		}
	}

	/**
	 * Show the editor overlay to hide flickering during theme changes
	 */
	protected showEditorOverlay(): void {
		if (this.overlayElement) {
			this.overlayElement.style.display = 'block';
		}
	}

	/**
	 * Hide the editor overlay
	 */
	protected hideEditorOverlay(): void {
		if (this.overlayElement) {
			this.overlayElement.style.display = 'none';
		}
	}

	override dispose(): void {
		super.dispose();
		if (this.container) {
			this.container.remove();
			this.container = undefined;
		}
	}
}
