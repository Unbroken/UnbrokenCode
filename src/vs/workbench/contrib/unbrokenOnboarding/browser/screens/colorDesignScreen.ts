/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseOnboardingScreen } from './baseScreen.js';
import { append, $ } from '../../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { SAMPLE_CPP_COLOR_DESIGN } from '../../common/unbrokenOnboardingConstants.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';

export class ColorDesignScreen extends BaseOnboardingScreen {

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
	}

	get title(): string {
		return 'Unbroken Code Setup - Understanding Color Design';
	}

	get description(): string {
		return 'Unbroken Code uses a carefully designed color scheme that provides semantic cues to help you understand code structure at a glance. ' +
			'The colors work with semantic tokenization and naming conventions to create a visual hierarchy that reduces cognitive load and improves code readability.';
	}

	async render(parent: HTMLElement): Promise<void> {
		this.container = append(parent, $('.color-design-screen'));

		// Create header
		this.createHeader(this.container);

		// Create content area
		const content = append(this.container, $('.onboarding-screen-content'));

		// Create explanation section
		this.createExplanationSection(content);

		// Create preview editor with annotated C++ code
		this.createPreviewEditorWithAnnotations(content);

		// Create footer with navigation
		this.createFooter(this.container, { showSkip: true, showPrevious: true, nextLabel: 'Continue' });
	}

	private createExplanationSection(parent: HTMLElement): void {
		const explanationContainer = append(parent, $('.color-design-explanation'));

		const title = append(explanationContainer, $('.explanation-title'));
		title.textContent = 'The Philosophy: Maximum Visual Cues';

		const principlesList = append(explanationContainer, $('.principles-list'));

		const principles = [
			{
				title: 'Visual Cues Accelerate Code Comprehension',
				description: 'Color-coded naming conventions provide instant visual cues that help your brain parse code structure faster. Variables, functions, and types are ' +
					'distinguished by consistent color patterns that reveal their scope, lifetime, and purpose at a glance..'
			},
			{
				title: 'Dark Background Enhances Color Discrimination',
				description: 'The black background maximizes color contrast, allowing your brain to process subtle color distinctions more effectively. Against darkness, the spectrum' +
					'from red (globals), through gold (members), to green (functions) and blue/purple (types) becomes instantly recognizable.'
			},
			{
				title: 'Semantic Meaning Through Color Hierarchy',
				description: 'Related concepts share color families: danger signals (red for globals), structural information (purple/blue for types), active code (green for ' +
					'functions), and data flow (yellow for parameters). This color hierarchy helps your brain build a mental model of the code\'s organization without conscious effort.'
			}
		];

		principles.forEach(principle => {
			const principleItem = append(principlesList, $('.principle-item'));

			const principleTitle = append(principleItem, $('.principle-title'));
			principleTitle.textContent = principle.title;

			const principleDesc = append(principleItem, $('.principle-description'));
			principleDesc.textContent = principle.description;
		});

		const note = append(explanationContainer, $('.explanation-note'));
		note.textContent = 'The C++ code below demonstrates these principles in action. Notice how the inline comments explain the color choices - ' +
			'this creates a visually scannable document where semantic meaning emerges instantly.';
	}

	private createPreviewEditorWithAnnotations(parent: HTMLElement): void {
		// Create the preview editor using the base class method with the annotated C++ sample
		super.createPreviewEditor(parent, {
			languages: [
				{
					language: 'C++',
					languageId: 'cpp',
					code: SAMPLE_CPP_COLOR_DESIGN,
					uri: 'inmemory://onboarding/color-design.cpp'
				}
			],
			defaultLanguage: 'cpp',
			configOverrides: {
				'workbench.colorTheme': 'Malterlib'
			}
		});

		// Override editor options to disable scrollbars and fit content
		if (this.previewEditor) {
			this.updateEditorOptions({
				scrollbar: {
					vertical: 'hidden',
					horizontal: 'hidden'
				},
				scrollBeyondLastLine: false
			});
		}

		// Disable pointer events on the editor wrapper to allow page scrolling
		if (this.editorWrapper) {
			this.editorWrapper.style.pointerEvents = 'none';
		}
	}

	override onActivate(): void {
		super.onActivate();
		// Calculate and set the content height when the screen becomes active
		this.updateEditorHeight();
	}

	private updateEditorHeight(): void {
		if (!this.previewEditor || !this.editorWrapper) {
			return;
		}

		const model = this.previewEditor.getModel();
		if (!model) {
			return;
		}

		// Get the number of lines in the model
		const lineCount = model.getLineCount();

		// Get the line height from editor configuration
		const lineHeight = this.previewEditor.getOption(EditorOption.lineHeight);

		// Calculate the total content height (lines + padding)
		const contentHeight = (lineCount * lineHeight) + 20; // 20px for top/bottom padding

		// Set the editor wrapper height to fit the content
		this.editorWrapper.style.height = `${contentHeight}px`;

		// Force a layout update
		this.layoutEditor();
	}

	override async applySettings(): Promise<void> {
		// This screen is purely informational, no settings to apply
		return Promise.resolve();
	}
}
