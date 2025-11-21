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
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { Checkbox } from '../../../../../base/browser/ui/toggle/toggle.js';
import { asCssVariable } from '../../../../../platform/theme/common/colorRegistry.js';
import { checkboxBackground, checkboxBorder, checkboxForeground } from '../../../../../platform/theme/common/colors/inputColors.js';

type SettingPrimitive = string | boolean | number | undefined;
type SettingValue = SettingPrimitive | Record<string, SettingPrimitive | Record<string, SettingPrimitive>>;

interface IntrusiveOption {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly byline: string;
	readonly settings: Record<string, SettingValue>;
}

const INTRUSIVE_OPTIONS: IntrusiveOption[] = [
	{
		id: 'keep-current',
		label: 'Keep my current settings',
		description: 'No Changes',
		byline: 'Keep your existing editor configuration. You can always change this later in Settings.',
		settings: {}
	},
	{
		id: 'default',
		label: 'Chaos',
		description: 'The Eager Helper',
		byline: 'Every popup, every hint, every helpful suggestion. It\'s like having an overeager intern who won\'t stop helping. You\'ll love it.',
		settings: {
			'editor.autoSurround': undefined,
			'editor.autoClosingBrackets': undefined,
			'editor.autoClosingQuotes': undefined,
			'editor.autoClosingDelete': undefined,
			'editor.autoClosingOvertype': undefined,
			'editor.autoClosingComments': undefined,
			'editor.acceptSuggestionOnCommitCharacter': undefined,
			'editor.suggest.selectionMode': undefined,

			'editor.parameterHints.enabled': undefined,
			'editor.quickSuggestions': undefined,
			'editor.suggestOnTriggerCharacters': undefined,
			'editor.find.cursorMoveOnType': undefined,
			'[yaml]': {
				'editor.quickSuggestions': undefined
			},
			'[dockerfile]': {
				'editor.quickSuggestions': undefined
			},
			'[json]': {
				'editor.quickSuggestions': undefined,
				'editor.autoIndent': undefined
			},
			'[jsonc]': {
				'editor.quickSuggestions': undefined
			},
			'[snippets]': {
				'editor.quickSuggestions': undefined
			}
		}
	},
	{
		id: 'balanced',
		label: 'Compromise',
		description: 'The Respectful Assistant',
		byline: 'Stops the editor from editing your code without permission. Still offers suggestions. You know, boundaries.',
		settings: {
			'editor.autoSurround': 'never',
			'editor.autoClosingBrackets': 'never',
			'editor.autoClosingQuotes': 'never',
			'editor.autoClosingDelete': 'never',
			'editor.autoClosingOvertype': 'never',
			'editor.autoClosingComments': 'never',
			'editor.acceptSuggestionOnCommitCharacter': false,
			'editor.suggest.selectionMode': 'never',

			'editor.parameterHints.enabled': undefined,
			'editor.quickSuggestions': undefined,
			'editor.suggestOnTriggerCharacters': undefined,
			'editor.find.cursorMoveOnType': undefined,
			'[yaml]': {
				'editor.quickSuggestions': undefined
			},
			'[dockerfile]': {
				'editor.quickSuggestions': undefined
			},
			'[json]': {
				'editor.quickSuggestions': undefined,
				'editor.autoIndent': undefined
			},
			'[jsonc]': {
				'editor.quickSuggestions': undefined
			},
			'[snippets]': {
				'editor.quickSuggestions': undefined
			}
		}
	},
	{
		id: 'minimal',
		label: 'Bliss',
		description: 'The Silent Observer',
		byline: 'Maximum silence. The editor will sit there and let you work. Suggestions exist if you beg for them. This is what confidence looks like.',
		settings: {
			'editor.autoSurround': 'never',
			'editor.autoClosingBrackets': 'never',
			'editor.autoClosingQuotes': 'never',
			'editor.autoClosingDelete': 'never',
			'editor.autoClosingOvertype': 'never',
			'editor.autoClosingComments': 'never',
			'editor.acceptSuggestionOnCommitCharacter': false,
			'editor.suggest.selectionMode': 'never',

			'editor.parameterHints.enabled': false,
			'editor.quickSuggestions': { other: 'off', comments: 'off', strings: 'off' },
			'editor.suggestOnTriggerCharacters': false,
			'editor.find.cursorMoveOnType': false,
			'[yaml]': {
				'editor.quickSuggestions': {
					'strings': 'off'
				}
			},
			'[dockerfile]': {
				'editor.quickSuggestions': {
					'other': 'off',
					'strings': 'off'
				}
			},
			'[json]': {
				'editor.quickSuggestions': {
					'strings': 'off'
				},
				'editor.autoIndent': 'none'
			},
			'[jsonc]': {
				'editor.quickSuggestions': {
					'strings': 'off',
					'other': 'off'
				}
			},
			'[snippets]': {
				'editor.quickSuggestions': {
					'strings': 'off'
				}
			},
		}
	}
];

export class EditorIntrusiveScreen extends BaseOnboardingScreen {

	private selectedOptionId: string;
	private optionElements: Map<string, HTMLElement> = new Map();
	private settingsPreviewModel: ITextModel | undefined;
	private previewColumn: HTMLElement | undefined;
	private aiSuggestionsEnabled: boolean = true;
	private aiSuggestionsCheckbox: Checkbox | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILanguageService languageService: ILanguageService,
		@IExtensionService extensionService: IExtensionService,
		@IStorageService storageService: IStorageService,
		@ILifecycleService lifecycleService: ILifecycleService
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

		// Initialize with keep-current option
		this.selectedOptionId = 'keep-current';
	}

	get title(): string {
		return 'Unbroken Code Setup - Editor Intrusiveness';
	}

	get description(): string {
		return 'One final choice: how much should the editor "help" while you\'re coding? Popups, hints, suggestions - some developers love them, ' + // allow-any-unicode-next-line
			'others find them distracting. Unlike previous screens where we had Strong Opinions™, this one\'s genuinely up to you. All three options ' +
			'are perfectly valid. Yes, really. We promise we won\'t judge. You can always change this later in Settings or re-run this setup ' +
			'from Help → Open Unbroken Code Setup.';
	}

	async render(parent: HTMLElement): Promise<void> {
		this.container = append(parent, $('.editor-intrusive-screen'));

		// Create header
		this.createHeader(this.container);

		// Create content area
		const content = append(this.container, $('.onboarding-screen-content'));

		// Create side-by-side layout
		const splitContainer = append(content, $('.editor-intrusive-content-split'));

		// Create option selector (left side)
		const optionsColumn = append(splitContainer, $('.editor-intrusive-options-column'));
		this.createOptionSelector(optionsColumn);

		// Create preview editor (right side)
		this.previewColumn = append(splitContainer, $('.editor-intrusive-preview-column'));
		this.createSettingsPreviewEditor(this.previewColumn);

		// Create footer with navigation
		this.createFooter(this.container, { showSkip: true, showPrevious: true, nextLabel: 'Continue', settingsApplyMode: 'onfinish' });
	}

	private createOptionSelector(parent: HTMLElement): void {
		const selectorContainer = append(parent, $('.editor-intrusive-selector'));

		const label = append(selectorContainer, $('label.editor-intrusive-label'));
		label.textContent = 'Editor Behavior:';

		const optionsContainer = append(selectorContainer, $('.editor-intrusive-options'));

		INTRUSIVE_OPTIONS.forEach(option => {
			const optionElement = append(optionsContainer, $('.editor-intrusive-option'));

			// Radio input (hidden, controlled by clicking the entire option)
			const radio = append(optionElement, $('input.editor-intrusive-radio')) as HTMLInputElement;
			radio.type = 'radio';
			radio.name = 'editorIntrusive';
			radio.value = option.id;
			radio.id = `editorIntrusive${option.id}`;
			radio.checked = option.id === this.selectedOptionId;

			// Content wrapper
			const textWrapper = append(optionElement, $('.editor-intrusive-option-text'));

			const labelDisplay = append(textWrapper, $('.editor-intrusive-option-label'));
			labelDisplay.textContent = option.label;

			const descriptionElement = append(textWrapper, $('.editor-intrusive-option-description'));
			descriptionElement.textContent = option.description;

			const bylineElement = append(textWrapper, $('.editor-intrusive-option-byline'));
			bylineElement.textContent = option.byline;

			// Store reference to the option element
			this.optionElements.set(option.id, optionElement);

			this._register(this.addDisposableListener(radio, 'change', () => {
				if (radio.checked) {
					this.selectedOptionId = option.id;
					this.updatePreviewContent();
				}
			}));

			// Make the entire option container clickable
			this._register(this.addDisposableListener(optionElement, 'click', () => {
				radio.checked = true;
				this.selectedOptionId = option.id;
				this.updatePreviewContent();
			}));
		});
	}

	private createAISuggestionsCheckbox(): HTMLElement {
		const container = $('.ai-suggestions-section');

		const label = append(container, $('label.ai-suggestions-label'));
		label.textContent = 'AI Suggestions:';

		const checkboxRow = append(container, $('.ai-suggestions-checkbox-row'));

		this.aiSuggestionsCheckbox = this._register(new Checkbox(
			'Enable AI-powered inline suggestions (requires GitHub Copilot)',
			this.aiSuggestionsEnabled,
			{
				checkboxBackground: asCssVariable(checkboxBackground),
				checkboxBorder: asCssVariable(checkboxBorder),
				checkboxForeground: asCssVariable(checkboxForeground),
				checkboxDisabledBackground: undefined,
				checkboxDisabledForeground: undefined
			}
		));
		checkboxRow.appendChild(this.aiSuggestionsCheckbox.domNode);

		const checkboxLabel = append(checkboxRow, $('.ai-suggestions-checkbox-label'));
		checkboxLabel.textContent = 'Enable AI-powered inline suggestions (requires GitHub Copilot)';

		this._register(this.aiSuggestionsCheckbox.onChange(() => {
			this.aiSuggestionsEnabled = this.aiSuggestionsCheckbox!.checked;
			this.updatePreviewContent();
		}));

		// Make the label clickable too
		this._register(this.addDisposableListener(checkboxLabel, 'click', () => {
			if (this.aiSuggestionsCheckbox) {
				this.aiSuggestionsCheckbox.checked = !this.aiSuggestionsCheckbox.checked;
				this.aiSuggestionsEnabled = this.aiSuggestionsCheckbox.checked;
				this.updatePreviewContent();
			}
		}));

		return container;
	}

	private createSettingsPreviewEditor(parent: HTMLElement): void {
		// Use the base class method to create the preview editor
		super.createPreviewEditor(parent, {
			languages: [
				{
					language: 'JSON',
					languageId: 'json',
					code: '{\n  "loading": "settings preview..."\n}',
					uri: 'inmemory://onboarding/settings-preview.json'
				}
			],
			defaultLanguage: 'json',
			readOnly: true
		});

		// Insert AI suggestions checkbox before the editor wrapper
		if (this.editorWrapper?.parentElement) {
			const checkboxSection = this.createAISuggestionsCheckbox();
			this.editorWrapper.parentElement.insertBefore(checkboxSection, this.editorWrapper);
		}

		// Store reference to the model for dynamic updates
		this.settingsPreviewModel = this.previewEditor?.getModel() as ITextModel;

		// Update with actual settings content
		this.updatePreviewContent();

		// Re-layout when content changes
		if (this.settingsPreviewModel) {
			this._register(this.settingsPreviewModel.onDidChangeContent(() => {
				this.layoutEditor();
			}));
		}
	}

	private updatePreviewContent(): void {
		// Toggle preview column visibility based on selection
		// Hide preview when keep-current is selected (no changes to show)
		if (this.previewColumn) {
			if (this.selectedOptionId === 'keep-current') {
				this.previewColumn.style.visibility = 'hidden';
			} else {
				this.previewColumn.style.visibility = 'visible';
			}
		}

		if (!this.settingsPreviewModel) {
			return;
		}

		// Don't update preview content for keep-current option
		if (this.selectedOptionId === 'keep-current') {
			return;
		}

		// Find the selected option
		const selectedOption = INTRUSIVE_OPTIONS.find(opt => opt.id === this.selectedOptionId);

		// Filter out undefined values and empty objects to show only changed settings
		const filteredSettings: Record<string, SettingValue> = {};

		// Add intrusive settings
		if (selectedOption) {
			for (const [key, value] of Object.entries(selectedOption.settings)) {
				if (value !== undefined) {
					// Skip empty objects
					if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
						const hasNonUndefinedValues = Object.values(value).some(v => v !== undefined);
						if (hasNonUndefinedValues) {
							// Filter the nested object to remove undefined values
							const filteredNestedObj: Record<string, SettingPrimitive | Record<string, SettingPrimitive>> = {};
							for (const [nestedKey, nestedValue] of Object.entries(value)) {
								if (nestedValue !== undefined) {
									filteredNestedObj[nestedKey] = nestedValue;
								}
							}
							filteredSettings[key] = filteredNestedObj;
						}
					} else {
						filteredSettings[key] = value;
					}
				}
			}
		}

		// Add Copilot setting if AI suggestions are disabled
		if (!this.aiSuggestionsEnabled) {
			filteredSettings['github.copilot.enable'] = {
				'*': false,
				'plaintext': false,
				'markdown': false,
				'scminput': false
			};
		}

		// Format as pretty JSON
		const jsonContent = JSON.stringify(filteredSettings, null, 2);

		// Update the model content
		this.settingsPreviewModel.setValue(jsonContent);
	}


	override async applySettings(): Promise<void> {
		// Skip applying all settings if keep-current is selected
		if (this.selectedOptionId === 'keep-current') {
			return;
		}

		const promises: Promise<void>[] = [];

		// Apply intrusive settings
		const selectedOption = INTRUSIVE_OPTIONS.find(opt => opt.id === this.selectedOptionId);

		if (selectedOption) {
			for (const [key, value] of Object.entries(selectedOption.settings)) {
				promises.push(
					this.configurationService.updateValue(key, value, ConfigurationTarget.USER)
				);
			}
		}

		// Apply or clear Copilot setting based on checkbox state
		if (!this.aiSuggestionsEnabled) {
			// Disable Copilot for all file types
			promises.push(
				this.configurationService.updateValue('github.copilot.enable', {
					'*': false,
					'plaintext': false,
					'markdown': false,
					'scminput': false
				}, ConfigurationTarget.USER)
			);
		} else {
			// Clear the Copilot setting (remove it from user settings)
			promises.push(
				this.configurationService.updateValue('github.copilot.enable', undefined, ConfigurationTarget.USER)
			);
		}

		await Promise.all(promises);
	}
}
