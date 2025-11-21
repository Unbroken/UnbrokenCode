/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseOnboardingScreen } from './baseScreen.js';
import { append, $, getWindow, clearNode } from '../../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { SAMPLE_CPP_CODE, SAMPLE_TYPESCRIPT_CODE, SAMPLE_RUST_CODE, FontSize, getPixelPerfectOptions, isDyadicRational, isIntegerFractionOfNative, resolveFontFamily, formatCssFontSize, IPixelPerfectFontOption } from '../../common/unbrokenOnboardingConstants.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IFontSmoothingService } from '../../../../../platform/fontSmoothing/common/fontSmoothingService.js';
import { IDisplayNativeResolution, INativeHostService } from '../../../../../platform/native/common/native.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { isMacintosh, isLinux } from '../../../../../base/common/platform.js';
import { IModelDeltaDecoration } from '../../../../../editor/common/model.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IJSONEditingService } from '../../../../services/configuration/common/jsonEditing.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { parse } from '../../../../../base/common/jsonc.js';

const FONT_STYLES_SAMPLE = [
	'Regular:',
	'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	'abcdefghijklmnopqrstuvwxyz',
	'0123456789 !@#$%^&*()_+-=',
	'',
	'Bold:',
	'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	'abcdefghijklmnopqrstuvwxyz',
	'0123456789 !@#$%^&*()_+-=',
	'',
	'Italic:',
	'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	'abcdefghijklmnopqrstuvwxyz',
	'0123456789 !@#$%^&*()_+-=',
	'',
	'Bold Italic:',
	'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	'abcdefghijklmnopqrstuvwxyz',
	'0123456789 !@#$%^&*()_+-=',
].join('\n');

export class FontSizeScreen extends BaseOnboardingScreen {

	private selectedFontSize: FontSize;
	private selectedOption: IPixelPerfectFontOption | undefined;
	private currentOptions: IPixelPerfectFontOption[] = [];
	private fontSizeOptionsElements: Map<number, HTMLElement> = new Map();
	private fontSizeBylineElements: Map<number, HTMLElement> = new Map();
	private currentDevicePixelRatio: number;
	private fontSmoothingWarningContainer: HTMLElement | undefined;
	private scalingWarningContainer: HTMLElement | undefined;
	private scalingWarningMessageElement: HTMLElement | undefined;
	private optionsContainer: HTMLElement | undefined;
	private descriptionElement: HTMLElement | undefined;
	private nativeDisplayResolutions: IDisplayNativeResolution[] | undefined;
	private readonly optionDisposables = this._register(new DisposableStore());
	private launchedDisableLcdText: boolean = true;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILanguageService languageService: ILanguageService,
		@IExtensionService extensionService: IExtensionService,
		@IStorageService storageService: IStorageService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IFontSmoothingService private readonly fontSmoothingService: IFontSmoothingService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IJSONEditingService private readonly jsonEditingService: IJSONEditingService,
		@ITextFileService private readonly textFileService: ITextFileService
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

		// Initialize selected font size from current user settings
		this.selectedFontSize = this.configurationService.getValue<number>('editor.fontSize') || 10;

		// Initialize device pixel ratio (will be updated when container is available)
		this.currentDevicePixelRatio = 1;
	}

	get title(): string {
		return 'Unbroken Code Setup - Choose Your Font Size';
	}

	get description(): string {
		const scalingPercent = Math.round(this.currentDevicePixelRatio * 100);
		return 'Unbroken Code ships with a pixel-perfect font optimized for coding. ' +
			`The available sizes below are calculated for your display scaling (${scalingPercent}%) to ensure pixel-perfect rendering. ` +
			'Sizes marked with "Bold" include a pixel-perfect bold variant. ' +
			'You can change this anytime in Settings or reopen this wizard from Help \u2192 Open Unbroken Code Setup.';
	}

	render(parent: HTMLElement): void {
		this.container = append(parent, $('.font-size-screen'));

		// Set up resolution change detection first so DPR is known for the description
		this.setupResolutionChangeDetection();

		// Create header (with stored description element for dynamic updates)
		const header = append(this.container, $('.onboarding-screen-header'));
		const titleElement = append(header, $('h1.onboarding-screen-title'));
		titleElement.textContent = this.title;
		this.descriptionElement = append(header, $('p.onboarding-screen-description'));
		this.descriptionElement.textContent = this.description;

		// Create font smoothing warning (if needed)
		this.createFontSmoothingWarning(this.container);

		// Check for non-native display scaling on macOS (async, with live updates)
		this.checkAndDisplayNativeScalingStatus();
		this.setupDisplayChangeListener();

		// Create content area
		const content = append(this.container, $('.onboarding-screen-content'));

		// Create font size selector
		this.createFontSizeSelector(content);

		// Create preview editor
		this.createPreviewEditorWithComparisonButton(content);

		// Create footer with navigation
		this.createFooter(this.container, { showSkip: true, nextLabel: 'Continue', settingsApplyMode: 'realtime' });
	}

	private createFontSmoothingWarning(parent: HTMLElement): void {
		// Only show on supported platforms (macOS)
		if (!this.fontSmoothingService.isSupported()) {
			return;
		}

		// Create container for warning (initially hidden)
		this.fontSmoothingWarningContainer = append(parent, $('.font-smoothing-warning'));
		this.fontSmoothingWarningContainer.style.display = 'none';

		const warningContent = append(this.fontSmoothingWarningContainer, $('.font-smoothing-warning-content'));

		// Warning icon
		append(warningContent, $('.codicon.codicon-warning.font-smoothing-warning-icon'));

		// Warning message
		const messageContainer = append(warningContent, $('.font-smoothing-warning-message'));
		const messageText = append(messageContainer, $('span'));
		messageText.textContent = 'Font smoothing is enabled, which makes it impossible to render a pixel perfect font and will make text appear blurry. ';

		const link = append(messageContainer, $('a.font-smoothing-warning-link')) as HTMLAnchorElement;
		link.href = 'https://tonsky.me/blog/monitors/#turn-off-font-smoothing';
		link.textContent = 'Learn why font smoothing is problematic';
		link.target = '_blank';
		link.rel = 'noopener noreferrer';

		const messageText2 = append(messageContainer, $('span'));
		messageText2.textContent = '. For the best experience with Unbroken Code\'s crisp font rendering, consider disabling it.';

		// Action buttons container
		const actionsContainer = append(this.fontSmoothingWarningContainer, $('.font-smoothing-warning-actions'));

		// Disable and restart button
		const disableButton = append(actionsContainer, $('button.onboarding-button.primary')) as HTMLButtonElement;
		disableButton.textContent = 'Disable Font Smoothing and Restart';

		this._register(this.addDisposableListener(disableButton, 'click', async () => {
			disableButton.disabled = true;
			disableButton.textContent = 'Disabling...';

			try {
				const success = await this.fontSmoothingService.disableFontSmoothing();
				if (success) {
					disableButton.textContent = 'Restarting...';
					// Give a brief moment for the user to see the status
					setTimeout(async () => {
						await this.nativeHostService.relaunch();
					}, 500);
				} else {
					disableButton.textContent = 'Failed - Try Manual Disable';
					disableButton.disabled = false;
				}
			} catch (error) {
				disableButton.textContent = 'Failed - Try Manual Disable';
				disableButton.disabled = false;
			}
		}));

		// Check font smoothing status asynchronously
		this.checkAndDisplayFontSmoothingStatus();
	}

	private async checkAndDisplayFontSmoothingStatus(): Promise<void> {
		if (!this.fontSmoothingWarningContainer) {
			return;
		}

		try {
			const fontSmoothingEnabled = await this.fontSmoothingService.isFontSmoothingEnabled();
			if (fontSmoothingEnabled && this.fontSmoothingWarningContainer) {
				this.fontSmoothingWarningContainer.style.display = 'flex';
			}
		} catch (error) {
			// Silently ignore errors in detection
		}
	}

	private createSubpixelAAButton(parent: HTMLElement): void {
		// Only show on non-macOS platforms (macOS doesn't support subpixel rendering)
		if (isMacintosh) {
			return;
		}

		const button = append(parent, $('button.subpixel-aa-open-button')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = 'Subpixel Anti-aliasing\u2026';

		this._register(this.addDisposableListener(button, 'click', () => {
			this.showSubpixelAAModal();
		}));
	}

	private showSubpixelAAModal(): void {
		if (!this.container) {
			return;
		}

		// Create modal overlay
		const modal = append(this.container, $('.subpixel-aa-modal'));
		const modalContent = append(modal, $('.subpixel-aa-modal-content'));

		// Header
		const header = append(modalContent, $('.subpixel-aa-modal-header'));
		const title = append(header, $('h2.subpixel-aa-modal-title'));
		title.textContent = 'Subpixel Anti-aliasing';
		const closeButton = append(header, $('button.subpixel-aa-modal-close')) as HTMLButtonElement;
		closeButton.textContent = '\u00D7';
		closeButton.type = 'button';

		// Explanation
		const explanation = append(modalContent, $('.subpixel-aa-explanation'));
		const para1 = append(explanation, $('p'));
		para1.textContent = 'Subpixel anti-aliasing (LCD text rendering) is incompatible with pixel-perfect rendering. ' +
			'It colors the red, green, and blue sub-components of each pixel independently, ' +
			'which introduces color fringing. To reduce this fringing, blurring is applied to the edges of letter stems, ' +
			'ruining the crisp grid-aligned appearance of a pixel-perfect font.';

		const para2 = append(explanation, $('p'));
		if (isLinux) {
			para2.textContent = 'This is especially problematic on Linux where the blurring algorithm is worse than on Windows, producing more visible artifacts. ' +
				'Note that the amount of blurring is hardcoded in Skia (the rendering library used by Chrome/Electron), so fontconfig settings have no effect.';
		} else {
			para2.textContent = 'On Windows the blurring algorithm produces reasonable results even for pixel-perfect fonts, but it is still recommended to disable it for the sharpest rendering. ' +
				'Additionally, ClearType causes glyphs such as box-drawing characters and block elements to not mesh correctly in the terminal renderer, producing visible seams and gaps.';
		}

		// Toggle
		const toggleContainer = append(modalContent, $('.subpixel-aa-toggle'));
		const checkbox = append(toggleContainer, $('input.subpixel-aa-checkbox')) as HTMLInputElement;
		checkbox.type = 'checkbox';
		checkbox.id = 'subpixelAAToggleModal';

		const label = append(toggleContainer, $('label.subpixel-aa-label')) as HTMLLabelElement;
		label.htmlFor = 'subpixelAAToggleModal';
		label.textContent = 'Disable subpixel anti-aliasing';

		// Restart button (initially hidden)
		const restartButton = append(modalContent, $('button.onboarding-button.primary.subpixel-aa-restart')) as HTMLButtonElement;
		restartButton.textContent = 'Restart to Apply';
		restartButton.style.display = 'none';

		// Load current state
		this.loadSubpixelAAState(checkbox);

		// Handle toggle
		const toggleListener = this.addDisposableListener(checkbox, 'change', async () => {
			const disableLcdText = checkbox.checked;
			await this.jsonEditingService.write(this.environmentService.argvResource, [
				{ path: ['disable-lcd-text'], value: disableLcdText }
			], true);
			restartButton.style.display = disableLcdText !== this.launchedDisableLcdText ? '' : 'none';
		});

		// Handle restart
		const restartListener = this.addDisposableListener(restartButton, 'click', async () => {
			await this.nativeHostService.relaunch();
		});

		// Close handlers
		const closeModal = () => {
			toggleListener.dispose();
			restartListener.dispose();
			closeListener.dispose();
			backdropListener.dispose();
			modal.remove();
		};

		const closeListener = this.addDisposableListener(closeButton, 'click', closeModal);
		const backdropListener = this.addDisposableListener(modal, 'click', (e) => {
			if (e.target === modal) {
				closeModal();
			}
		});
	}

	private async loadSubpixelAAState(checkbox: HTMLInputElement): Promise<void> {
		try {
			const content = await this.textFileService.read(this.environmentService.argvResource, { encoding: 'utf8' });
			const config = parse(content.value) as { 'disable-lcd-text'?: boolean };
			// If not specified in argv.json, the default in main.ts applies it as true
			const disableLcdText = config['disable-lcd-text'] !== false;
			this.launchedDisableLcdText = disableLcdText;
			checkbox.checked = disableLcdText;
		} catch {
			// Default: LCD text disabled (subpixel AA off)
			this.launchedDisableLcdText = true;
			checkbox.checked = true;
		}
	}

	private async checkAndDisplayNativeScalingStatus(): Promise<void> {
		if (!isMacintosh) {
			return;
		}

		try {
			this.nativeDisplayResolutions = await this.nativeHostService.getDisplayNativeResolutions();
			this.updateScalingWarning();
		} catch {
			// Silently ignore errors in detection
		}
	}

	private setupDisplayChangeListener(): void {
		if (!isMacintosh) {
			return;
		}

		// Re-check when display settings change (e.g. resolution change in System Settings).
		// On macOS DPR stays at 2, so setupResolutionChangeDetection won't fire for this.
		this._register(this.nativeHostService.onDidChangeDisplay(() => {
			this.checkAndDisplayNativeScalingStatus();
		}));
	}

	private createFontSizeSelector(parent: HTMLElement): void {
		const selectorContainer = append(parent, $('.font-size-selector'));

		const labelRow = append(selectorContainer, $('.font-size-label-row'));
		const label = append(labelRow, $('label.font-size-label'));
		label.textContent = 'Font Size:';

		// Add subpixel AA button on the same row (non-macOS only)
		this.createSubpixelAAButton(labelRow);

		// Create scaling warning (initially hidden)
		this.createScalingWarning(selectorContainer);

		this.optionsContainer = append(selectorContainer, $('.font-size-options'));

		// Build initial options based on detected DPR
		this.rebuildFontSizeOptions();
	}

	private createScalingWarning(parent: HTMLElement): void {
		this.scalingWarningContainer = append(parent, $('.scaling-warning'));
		this.scalingWarningContainer.style.display = 'none';

		const warningContent = append(this.scalingWarningContainer, $('.scaling-warning-content'));

		// Warning icon
		append(warningContent, $('.codicon.codicon-warning.scaling-warning-icon'));

		// Warning message
		this.scalingWarningMessageElement = append(warningContent, $('.scaling-warning-message'));
	}

	private updateScalingWarning(): void {
		if (!this.scalingWarningContainer || !this.scalingWarningMessageElement) {
			return;
		}

		// Check for non-dyadic DPR (primarily affects Windows/Linux with fractional scaling)
		if (!isDyadicRational(this.currentDevicePixelRatio)) {
			const dprPercent = Math.round(this.currentDevicePixelRatio * 100);
			this.scalingWarningContainer.style.display = 'flex';
			this.scalingWarningMessageElement.textContent =
				`Your display scaling (${dprPercent}%) may not render fonts pixel-perfectly due to sub-pixel alignment limitations. ` +
				`For the best experience, consider using 100%, 125%, 150%, 175%, 200%, 225%, 250%, or 300%.`;
			return;
		}

		// On macOS, check for non-native display scaling
		if (isMacintosh && this.container && this.nativeDisplayResolutions) {
			const targetWindow = getWindow(this.container);
			const screenWidth = targetWindow.screen.width;
			const screenHeight = targetWindow.screen.height;

			// Find the display matching the current screen dimensions
			const display = this.nativeDisplayResolutions.find(d =>
				d.currentLogicalWidth === screenWidth && d.currentLogicalHeight === screenHeight
			);

			if (display && !isIntegerFractionOfNative(screenWidth, screenHeight, display.nativeWidth, display.nativeHeight)) {
				const defaultWidth = display.nativeWidth / 2;
				const defaultHeight = display.nativeHeight / 2;
				this.scalingWarningContainer.style.display = 'flex';
				this.scalingWarningMessageElement.textContent =
					`Your display is using a non-native scaled resolution. ` +
					`For pixel-perfect rendering, use the "Default" resolution (${defaultWidth}\u00D7${defaultHeight}) ` +
					`in System Settings \u2192 Displays.`;
				return;
			}
		}

		this.scalingWarningContainer.style.display = 'none';
	}

	private rebuildFontSizeOptions(): void {
		// Compute options for current DPR
		this.currentOptions = getPixelPerfectOptions(this.currentDevicePixelRatio);

		// Update description with current scaling
		if (this.descriptionElement) {
			this.descriptionElement.textContent = this.description;
		}

		// Update scaling warning
		this.updateScalingWarning();

		// Clear existing option elements and disposables
		this.optionDisposables.clear();
		if (this.optionsContainer) {
			clearNode(this.optionsContainer);
		}
		this.fontSizeOptionsElements.clear();
		this.fontSizeBylineElements.clear();

		// Try to match previously selected font size to new options
		this.selectedOption = this.currentOptions.find(
			opt => Math.abs(opt.cssFontSize - this.selectedFontSize) < 0.01
		);

		// If no match, pick the closest option
		if (!this.selectedOption && this.currentOptions.length > 0) {
			this.selectedOption = this.findClosestOption(this.selectedFontSize);
		}

		if (this.selectedOption) {
			this.selectedFontSize = this.selectedOption.cssFontSize;
		}

		// Build radio buttons for each option
		this.currentOptions.forEach(option => {
			this.createFontSizeOptionElement(option);
		});

		// Update preview if editor exists
		if (this.previewEditor) {
			this.updatePreview();
		}
	}

	private findClosestOption(targetSize: number): IPixelPerfectFontOption | undefined {
		if (this.currentOptions.length === 0) {
			return undefined;
		}
		let closest = this.currentOptions[0];
		let closestDist = Math.abs(closest.cssFontSize - targetSize);
		for (const opt of this.currentOptions) {
			const dist = Math.abs(opt.cssFontSize - targetSize);
			if (dist < closestDist) {
				closest = opt;
				closestDist = dist;
			}
		}
		return closest;
	}

	private createFontSizeOptionElement(option: IPixelPerfectFontOption): void {
		if (!this.optionsContainer) {
			return;
		}

		const optionEl = append(this.optionsContainer, $('.font-size-option'));

		// Radio input (hidden, controlled by clicking the entire option)
		const radio = append(optionEl, $('input.font-size-radio')) as HTMLInputElement;
		radio.type = 'radio';
		radio.name = 'fontSize';
		radio.value = option.cssFontSize.toString();
		radio.id = `fontSize${option.physicalHeight}`;
		radio.checked = (this.selectedOption === option);

		// Left side: Font size display
		const sizeDisplay = append(optionEl, $('.font-size-option-size'));
		sizeDisplay.textContent = formatCssFontSize(option.cssFontSize);

		// Right side: Description and byline wrapper
		const textWrapper = append(optionEl, $('.font-size-option-text'));

		const descElement = append(textWrapper, $('.font-size-option-desc'));
		descElement.textContent = option.description;

		// Physical pixel size info
		const physicalElement = append(textWrapper, $('.font-size-option-byline'));
		physicalElement.textContent = `${option.physicalWidth}\u00D7${option.physicalHeight} physical`;

		// Bottom row: line count + bold indicator
		const bottomRow = append(textWrapper, $('.font-size-option-bottom-row'));

		const bylineElement = append(bottomRow, $('.font-size-option-byline'));
		bylineElement.textContent = '-'; // Placeholder until calculated

		if (option.config.variants.includes('Bold')) {
			const boldBadge = append(bottomRow, $('.font-size-option-bold-badge'));
			boldBadge.textContent = '\u2714 Bold';
		}

		// Store references keyed by physicalHeight (unique per option)
		this.fontSizeOptionsElements.set(option.physicalHeight, optionEl);
		this.fontSizeBylineElements.set(option.physicalHeight, bylineElement);

		this.optionDisposables.add(this.addDisposableListener(radio, 'change', () => {
			if (radio.checked) {
				this.selectedOption = option;
				this.selectedFontSize = option.cssFontSize;
				this.updatePreview();
			}
		}));

		// Make the entire option container clickable
		this.optionDisposables.add(this.addDisposableListener(optionEl, 'click', () => {
			radio.checked = true;
			this.selectedOption = option;
			this.selectedFontSize = option.cssFontSize;
			this.updatePreview();
		}));
	}

	private createPreviewEditorWithComparisonButton(parent: HTMLElement): void {
		// First, create the preview editor using the base class method with multiple languages
		super.createPreviewEditor(parent, {
			languages: [
				{
					language: 'C++',
					languageId: 'cpp',
					code: SAMPLE_CPP_CODE,
					uri: 'inmemory://onboarding/preview.cpp'
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
				},
				{
					language: 'Font Styles',
					languageId: 'plaintext',
					code: FONT_STYLES_SAMPLE,
					uri: 'inmemory://onboarding/fontstyles.txt'
				}
			],
			defaultLanguage: 'cpp'
		});

		// Apply font style decorations when Font Styles tab is shown
		this.setupFontStyleDecorations();

		// Add comparison button to the preview header
		if (this.previewHeader) {
			const comparisonButton = append(this.previewHeader, $('button.font-size-comparison-button')) as HTMLButtonElement;
			comparisonButton.textContent = 'Compare for different screen sizes';
			comparisonButton.type = 'button';
			this._register(this.addDisposableListener(comparisonButton, 'click', () => {
				this.showComparisonTable();
			}));
		}

		// Update preview to apply current font settings
		this.updatePreview();
	}

	private setupFontStyleDecorations(): void {
		if (!this.previewEditor) {
			return;
		}

		const applyDecorations = () => {
			if (!this.previewEditor) {
				return;
			}
			const model = this.previewEditor.getModel();
			if (!model || !model.uri.path.endsWith('fontstyles.txt')) {
				return;
			}

			// Lines 6-9: Bold, Lines 11-14: Italic, Lines 16-19: Bold Italic
			const decorations: IModelDeltaDecoration[] = [];

			// Bold (lines 6-9)
			for (let line = 6; line <= 9; line++) {
				const lineContent = model.getLineContent(line);
				if (lineContent) {
					decorations.push({
						range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: lineContent.length + 1 },
						options: { description: 'font-style-bold', inlineClassName: 'mtk-font-style-bold' }
					});
				}
			}

			// Italic (lines 11-14)
			for (let line = 11; line <= 14; line++) {
				const lineContent = model.getLineContent(line);
				if (lineContent) {
					decorations.push({
						range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: lineContent.length + 1 },
						options: { description: 'font-style-italic', inlineClassName: 'mtk-font-style-italic' }
					});
				}
			}

			// Bold Italic (lines 16-19)
			for (let line = 16; line <= 19; line++) {
				const lineContent = model.getLineContent(line);
				if (lineContent) {
					decorations.push({
						range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: lineContent.length + 1 },
						options: { description: 'font-style-bold-italic', inlineClassName: 'mtk-font-style-bold-italic' }
					});
				}
			}

			this.previewEditor.createDecorationsCollection(decorations);
		};

		// Apply when model changes (i.e., switching to Font Styles tab)
		this._register(this.previewEditor.onDidChangeModel(() => {
			applyDecorations();
		}));
	}

	protected override layoutEditor(): void {
		// Call base class layout first
		super.layoutEditor();

		// Then update line count bylines (screen-specific behavior)
		this.updateLineCountBylines();
	}

	private calculateVisibleLines(fontSize: number): number {
		if (!this.editorContainer || !this.previewEditor) {
			return 0;
		}

		// Get the container height
		const rect = this.editorContainer.getBoundingClientRect();
		const containerHeight = rect.height;

		// Account for editor wrapper padding (10px top + 10px bottom)
		const padding = 20;
		const availableHeight = containerHeight - padding;

		// Line height equals font size (as per user clarification)
		const lineHeight = fontSize;

		// Calculate number of visible lines
		const visibleLines = Math.floor(availableHeight / lineHeight);

		return visibleLines;
	}

	private updateLineCountBylines(): void {
		if (!this.editorContainer || !this.previewEditor || this.currentOptions.length === 0) {
			return;
		}

		// Use the smallest option as baseline for percentage calculation
		const baselineOption = this.currentOptions[0]; // sorted ascending by CSS size
		const baselineLines = this.calculateVisibleLines(baselineOption.cssFontSize);

		if (baselineLines === 0) {
			return; // Container not ready yet
		}

		// Update byline for each font size option
		this.currentOptions.forEach(option => {
			const bylineElement = this.fontSizeBylineElements.get(option.physicalHeight);
			if (!bylineElement) {
				return;
			}

			const visibleLines = this.calculateVisibleLines(option.cssFontSize);
			const percentage = Math.round((visibleLines / baselineLines) * 100);

			bylineElement.textContent = `${visibleLines} lines (${percentage}%)`;
		});
	}

	private showComparisonTable(): void {
		if (!this.container) {
			return;
		}

		// Create modal overlay
		const modal = append(this.container, $('.font-size-comparison-modal'));

		// Create modal content
		const modalContent = append(modal, $('.font-size-comparison-content'));

		// Header
		const header = append(modalContent, $('.font-size-comparison-header'));
		const title = append(header, $('h2.font-size-comparison-title'));
		title.textContent = 'Font Size Comparison by Resolution';

		const closeButton = append(header, $('button.font-size-comparison-close')) as HTMLButtonElement;
		closeButton.textContent = '×';
		closeButton.type = 'button';

		// Explanation text
		const explanation = append(modalContent, $('.font-size-comparison-explanation'));
		const explanationPara1 = append(explanation, $('p'));
		explanationPara1.textContent = 'Each cell shows the number of characters per line × number of lines that fit on screen for that font size and resolution combination.';

		const explanationPara2 = append(explanation, $('p'));
		explanationPara2.textContent = 'Note: These resolutions represent logical (scaled) resolutions. On Retina/HiDPI displays (2x scaling), the physical resolution is twice the logical resolution. For example, a MacBook with 1280×720 logical resolution has a 2560×1440 physical display, so refer to the 1280×720 column for accurate sizing.';

		// Table
		const table = append(modalContent, $('table.font-size-comparison-table'));

		// Table header
		const thead = append(table, $('thead'));
		const headerRow = append(thead, $('tr'));
		function appendHeaderCell() {
			const element = append(headerRow, $('th'));
			element.style.textAlign = 'center';
			return element;
		}
		appendHeaderCell().textContent = '';

		// Get current screen resolution
		// In fullscreen mode, only the notch reduces available space, not the menu bar
		const targetWindow = getWindow(this.container);
		const screenWidth = targetWindow.screen.width;
		const screenHeight = targetWindow.screen.height;

		console.log('screen', targetWindow.innerWidth, targetWindow.innerHeight);

		const currentWidth = screenWidth;
		let currentHeight = screenHeight;

		if (isMacintosh) {
			// MacBook Pro with notch specifications
			// 14" MacBook Pro: 3024×1964 physical → 1512×982 logical (native)
			// 16" MacBook Pro: 3456×2234 physical → 1728×1117 logical (native)
			// Physical notch height: 66px
			// At native resolution (2x): 66px physical → 33px logical
			// Menu bar minimum: 31px logical

			const macBookProNotchModels = [
				{ nativeWidth: 1512, nativeHeight: 982, physicalNotch: 66 },  // 14" MacBook Pro
				{ nativeWidth: 1728, nativeHeight: 1117, physicalNotch: 66 }  // 16" MacBook Pro
			];

			// Find if we're on a MacBook Pro with notch
			for (const model of macBookProNotchModels) {
				// Calculate the scaling factor based on width
				const scaleFactor = screenWidth / model.nativeWidth;

				// Check if this matches the model's aspect ratio (with some tolerance for rounding)
				const expectedHeight = Math.round(model.nativeHeight * scaleFactor);
				const heightTolerance = 2; // Allow 2px difference due to rounding

				if (Math.abs(screenHeight - expectedHeight) <= heightTolerance) {
					// This is a MacBook Pro with notch at this scaled resolution
					// Calculate the scaled notch height
					const scaledNotchHeight = Math.round(model.physicalNotch / 2 * scaleFactor);

					// The unusable space is the max of notch height and menu bar (31px minimum)
					const unusableHeight = Math.max(scaledNotchHeight, 26);

					currentHeight = screenHeight - unusableHeight;
					break;
				}
			}
		}

		const resolutions = [
			{ width: 1152, height: 864, label: '1152×720' },
			{ width: 1280, height: 720, label: '1280×720' },
			{ width: 1920, height: 1080, label: '1920×1080' },
			{ width: 1728, height: 1084, label: '1728×1084' },
			{ width: 2560, height: 1440, label: '2560×1440' },
			{ width: 3008, height: 1692, label: '3008×1692' }
		];

		// Check if current resolution is already in the list
		const currentResExists = resolutions.some(res => res.width === currentWidth && res.height === currentHeight);

		// Add current resolution if not present
		if (!currentResExists) {
			resolutions.push({
				width: currentWidth,
				height: currentHeight,
				label: `${currentWidth}×${currentHeight}`
			});
		}

		// Sort by width, then by height
		resolutions.sort((a, b) => {
			if (a.width !== b.width) {
				return a.width - b.width;
			}
			return a.height - b.height;
		});

		// Find the index of the current resolution for highlighting
		const currentResIndex = resolutions.findIndex(res => res.width === currentWidth && res.height === currentHeight);

		resolutions.forEach((res, index) => {
			const th = appendHeaderCell();
			th.textContent = res.label;
			if (index === currentResIndex) {
				th.classList.add('current-resolution');
			}
		});

		// Table body
		const tbody = append(table, $('tbody'));

		// Use dynamically computed options for the current DPR
		this.currentOptions.forEach(option => {
			const row = append(tbody, $('tr'));
			const fontCell = append(row, $('td.font-size-label-cell'));
			fontCell.textContent = formatCssFontSize(option.cssFontSize);
			fontCell.style.textAlign = 'center';

			resolutions.forEach((res, index) => {
				const cell = append(row, $('td'));

				// Calculate columns using CSS char width
				const columns = Math.floor(res.width / option.cssCharWidth);

				// Calculate lines using CSS font size
				const lines = Math.floor(res.height / option.cssFontSize);

				cell.textContent = `${columns} × ${lines}`;
				cell.style.textAlign = 'center';

				// Highlight current resolution column
				if (index === currentResIndex) {
					cell.classList.add('current-resolution');
				}
			});
		});

		// Close button handler
		const closeModal = () => {
			modal.remove();
		};

		this._register(this.addDisposableListener(closeButton, 'click', closeModal));
		this._register(this.addDisposableListener(modal, 'click', (e) => {
			if (e.target === modal) {
				closeModal();
			}
		}));
	}

	private async updatePreview(): Promise<void> {
		if (!this.previewEditor) {
			return;
		}

		// Update the configuration - the base class's configuration change listener
		// will automatically update the editor with the new font settings
		await this.applySettings();

		// Force layout after font size change to ensure scrollbar updates
		this.layoutEditor();

		// Update line count bylines after preview update
		this.updateLineCountBylines();
	}

	private setupResolutionChangeDetection(): void {
		if (!this.container) {
			return;
		}

		// Get the window from the container element
		const targetWindow = getWindow(this.container);

		// Update initial device pixel ratio
		this.currentDevicePixelRatio = targetWindow.devicePixelRatio || 1;

		// Monitor for resolution changes using matchMedia
		const updateResolution = () => {
			const newDevicePixelRatio = targetWindow.devicePixelRatio || 1;
			if (newDevicePixelRatio !== this.currentDevicePixelRatio) {
				this.currentDevicePixelRatio = newDevicePixelRatio;
				this.rebuildFontSizeOptions();
			}
		};

		// Set up media query listener for resolution changes
		// This watches for changes in device pixel ratio
		const mediaQuery = targetWindow.matchMedia(`(resolution: ${this.currentDevicePixelRatio}dppx)`);
		const listener = () => {
			updateResolution();
			// Re-attach listener with new resolution value
			this.setupResolutionChangeDetection();
		};

		mediaQuery.addEventListener('change', listener);

		this._register({
			dispose: () => {
				mediaQuery.removeEventListener('change', listener);
			}
		});
	}

	override onActivate(): void {
		// Call base class onActivate (handles layoutEditor and malterlib)
		super.onActivate();

		// Update line count bylines when screen becomes active (screen-specific)
		this.updateLineCountBylines();
	}

	override async applySettings(): Promise<void> {
		const promises: Promise<void>[] = [];

		// Resolve the font family based on the selected option and current DPR
		const fontFamily = this.selectedOption
			? resolveFontFamily(this.selectedOption, this.currentDevicePixelRatio)
			: undefined;

		promises.push(this.configurationService.updateValue(
			'editor.fontFamily',
			fontFamily,
			ConfigurationTarget.USER
		));

		// Use undefined (default) when font family is default and size is ~10px
		const isDefault = fontFamily === undefined && Math.abs(this.selectedFontSize - 10) < 0.01;
		const fontSizeSetting = isDefault ? undefined : this.selectedFontSize;

		// Write the selected font size to user settings
		promises.push(this.configurationService.updateValue(
			'editor.fontSize',
			fontSizeSetting,
			ConfigurationTarget.USER
		));
		promises.push(this.configurationService.updateValue(
			'chat.editor.fontSize',
			fontSizeSetting,
			ConfigurationTarget.USER
		));
		promises.push(this.configurationService.updateValue(
			'debug.console.fontSize',
			fontSizeSetting,
			ConfigurationTarget.USER
		));
		promises.push(this.configurationService.updateValue(
			'terminal.integrated.fontSize',
			fontSizeSetting,
			ConfigurationTarget.USER
		));
		promises.push(this.configurationService.updateValue(
			'debug.console.lineHeight',
			fontSizeSetting,
			ConfigurationTarget.USER
		));

		let rulers: { column: number; color: null }[] | undefined = undefined;

		if (!isDefault) {
			rulers = [{
				'column': Math.round(190 / this.selectedFontSize * 10),
				'color': null
			}];
		}

		promises.push(this.configurationService.updateValue(
			'editor.rulers',
			rulers,
			ConfigurationTarget.USER
		));

		await Promise.all(promises);
	}

}
