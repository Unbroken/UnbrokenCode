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

interface IntrusiveOption {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly byline: string;
	readonly settings: Record<string, any>;
}

const INTRUSIVE_OPTIONS: IntrusiveOption[] = [
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
			'editor.dragAndDrop': undefined,
			'editor.acceptSuggestionOnCommitCharacter': undefined,
			'editor.suggest.selectionMode': undefined,

			'editor.parameterHints.enabled': undefined,
			'editor.quickSuggestions': undefined,
			'editor.suggestOnTriggerCharacters': undefined,
			'editor.stickyScroll.enabled': undefined,
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
			'editor.dragAndDrop': false,
			'editor.acceptSuggestionOnCommitCharacter': false,
			'editor.suggest.selectionMode': 'never',

			'editor.parameterHints.enabled': undefined,
			'editor.quickSuggestions': undefined,
			'editor.suggestOnTriggerCharacters': undefined,
			'editor.stickyScroll.enabled': undefined,
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
			'editor.dragAndDrop': false,
			'editor.acceptSuggestionOnCommitCharacter': false,
			'editor.suggest.selectionMode': 'never',

			'editor.parameterHints.enabled': false,
			'editor.quickSuggestions': { other: 'off', comments: 'off', strings: 'off' },
			'editor.suggestOnTriggerCharacters': false,
			'editor.stickyScroll.enabled': false,
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

		// Initialize with default option
		this.selectedOptionId = 'default';
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

		// Create option selector
		this.createOptionSelector(content);

		// Create footer with navigation
		this.createFooter(this.container, { showSkip: true, showPrevious: true, nextLabel: 'Finish' });
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
				}
			}));

			// Make the entire option container clickable
			this._register(this.addDisposableListener(optionElement, 'click', () => {
				radio.checked = true;
				this.selectedOptionId = option.id;
			}));
		});
	}

	override async applySettings(): Promise<void> {
		// Find the selected option
		const selectedOption = INTRUSIVE_OPTIONS.find(opt => opt.id === this.selectedOptionId);

		if (!selectedOption) {
			return;
		}

		// Apply all settings for the selected option
		const promises: Promise<void>[] = [];
		for (const [key, value] of Object.entries(selectedOption.settings)) {
			promises.push(
				this.configurationService.updateValue(key, value, ConfigurationTarget.USER)
			);
		}

		await Promise.all(promises);
	}
}
