/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseOnboardingScreen } from './baseScreen.js';
import { append, $, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { isMacintosh, OS } from '../../../../../base/common/platform.js';
import { ResolvedKeybinding } from '../../../../../base/common/keybindings.js';
import { KeybindingLabel } from '../../../../../base/browser/ui/keybindingLabel/keybindingLabel.js';
import { localize } from '../../../../../nls.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { areSameExtensions } from '../../../../../platform/extensionManagement/common/extensionManagementUtil.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { defaultKeybindingLabelStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { EnablementState, IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService } from '../../../../services/extensionManagement/common/extensionManagement.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { findSchemeKeybinding, KEYBOARD_SHORTCUTS_SCHEME_SETTING } from '../../common/keyboardShortcutsPreview.js';

const DEFAULT_SCHEME = 'vscode';

/** Visual Studio schemes that only exist for compatibility with old Visual Studio versions. */
const LEGACY_SCHEMES = new Set(['visualCpp2', 'visualStudio6']);

/** The Visual Studio Keymap extension from the marketplace, which duplicates the built-in schemes. */
const VISUAL_STUDIO_KEYMAP_EXTENSION_ID = 'ms-vscode.vs-keybindings';

interface IKeyboardScheme {
	readonly id: string;
	readonly label: string;
	readonly description: string;
}

/**
 * An action shown in the preview table, with the context the command's keybinding is looked up in.
 */
interface IShortcutPreviewRow {
	readonly label: string;
	readonly command: string;
	readonly context: Record<string, string | boolean>;
}

const EDITOR_CONTEXT = { editorFocus: true, editorTextFocus: true, editorIsOpen: true };
const STOPPED_CONTEXT = { inDebugMode: true, debugState: 'stopped' };

const PREVIEW_ROWS: IShortcutPreviewRow[] = [
	{ label: localize('keyboardShortcuts.preview.build', "Build"), command: 'workbench.action.tasks.build', context: {} },
	{ label: localize('keyboardShortcuts.preview.startDebugging', "Start Debugging"), command: 'workbench.action.debug.start', context: { inDebugMode: false } },
	{ label: localize('keyboardShortcuts.preview.stopDebugging', "Stop Debugging"), command: 'workbench.action.debug.stop', context: STOPPED_CONTEXT },
	{ label: localize('keyboardShortcuts.preview.stepOver', "Step Over"), command: 'workbench.action.debug.stepOver', context: STOPPED_CONTEXT },
	{ label: localize('keyboardShortcuts.preview.stepInto', "Step Into"), command: 'workbench.action.debug.stepInto', context: STOPPED_CONTEXT },
	{ label: localize('keyboardShortcuts.preview.runToCursor', "Run to Cursor"), command: 'editor.debug.action.runToCursor', context: { ...EDITOR_CONTEXT, ...STOPPED_CONTEXT } },
	{ label: localize('keyboardShortcuts.preview.toggleBreakpoint', "Toggle Breakpoint"), command: 'editor.debug.action.toggleBreakpoint', context: EDITOR_CONTEXT },
	{ label: localize('keyboardShortcuts.preview.callStack', "Focus Call Stack"), command: 'workbench.debug.action.focusCallStackView', context: {} },
	{ label: localize('keyboardShortcuts.preview.watch', "Focus Watch"), command: 'workbench.debug.action.focusWatchView', context: {} },
	{ label: localize('keyboardShortcuts.preview.breakpoints', "Focus Breakpoints"), command: 'workbench.debug.action.focusBreakpointsView', context: {} },
	{ label: localize('keyboardShortcuts.preview.goToDefinition', "Go to Definition"), command: 'editor.action.revealDefinition', context: { ...EDITOR_CONTEXT, editorHasDefinitionProvider: true } },
	{ label: localize('keyboardShortcuts.preview.findAllReferences', "Find All References"), command: 'references-view.findReferences', context: { ...EDITOR_CONTEXT, editorHasReferenceProvider: true } },
	{ label: localize('keyboardShortcuts.preview.navigateBack', "Navigate Backward"), command: 'workbench.action.navigateBack', context: {} },
	{ label: localize('keyboardShortcuts.preview.goToAll', "Go to File"), command: 'workbench.action.quickOpen', context: {} },
	{ label: localize('keyboardShortcuts.preview.switchHeader', "Switch Header/Source"), command: 'clangd.switchheadersource', context: { ...EDITOR_CONTEXT, editorLangId: 'cpp' } },
	{ label: localize('keyboardShortcuts.preview.comment', "Comment Selection"), command: 'editor.action.addCommentLine', context: EDITOR_CONTEXT },
	{ label: localize('keyboardShortcuts.preview.rename', "Rename"), command: 'editor.action.rename', context: { ...EDITOR_CONTEXT, editorHasRenameProvider: true } },
];

export class KeyboardShortcutsScreen extends BaseOnboardingScreen {

	private selectedSchemeId: string;
	private schemes: IKeyboardScheme[] = [];
	private showLegacySchemes = false;
	private optionsContainer: HTMLElement | undefined;
	private previewContainer: HTMLElement | undefined;
	private noticeContainer: HTMLElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());
	private readonly optionDisposables = this._register(new DisposableStore());
	private readonly previewDisposables = this._register(new DisposableStore());

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILanguageService languageService: ILanguageService,
		@IExtensionService extensionService: IExtensionService,
		@IStorageService storageService: IStorageService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchExtensionManagementService private readonly extensionManagementService: IWorkbenchExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService
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

		this.selectedSchemeId = this.configurationService.getValue<string>(KEYBOARD_SHORTCUTS_SCHEME_SETTING) || DEFAULT_SCHEME;
		this.showLegacySchemes = LEGACY_SCHEMES.has(this.selectedSchemeId);
	}

	get title(): string {
		return localize('keyboardShortcuts.title', "Unbroken Code Setup - Keyboard Shortcuts");
	}

	get description(): string {
		return localize('keyboardShortcuts.description', "Coming from Visual Studio? Pick the keyboard mapping scheme your fingers already know. The Visual Studio schemes match the schemes in Visual Studio's Tools > Options > Environment > Keyboard and are added on top of the VS Code shortcuts. You can change this later in Settings or re-run this setup from Help > Open Unbroken Code Setup.");
	}

	render(parent: HTMLElement): void {
		this.renderDisposables.clear();

		this.container = append(parent, $('.keyboard-shortcuts-screen'));
		this.createHeader(this.container);

		const content = append(this.container, $('.onboarding-screen-content'));
		this.noticeContainer = append(content, $('.keyboard-shortcuts-notice'));
		this.noticeContainer.style.display = 'none';

		const splitContainer = append(content, $('.keyboard-shortcuts-content-split'));

		const optionsColumn = append(splitContainer, $('.keyboard-shortcuts-options-column'));
		const label = append(optionsColumn, $('label.keyboard-shortcuts-label'));
		label.textContent = localize('keyboardShortcuts.schemeLabel', "Keyboard Mapping Scheme:");
		this.optionsContainer = append(optionsColumn, $('.keyboard-shortcuts-options'));
		this.optionsContainer.setAttribute('role', 'radiogroup');

		this.previewContainer = append(splitContainer, $('.keyboard-shortcuts-preview-column'));

		this.createFooter(this.container, { showSkip: true, showPrevious: true, nextLabel: localize('keyboardShortcuts.continue', "Continue"), settingsApplyMode: 'onfinish' });

		this.renderDisposables.add(this.keybindingService.onDidUpdateKeybindings(() => this.renderPreview()));

		this.loadSchemes();
		this.renderExtensionNotice();
	}

	private async loadSchemes(): Promise<void> {
		// The schemes are contributed by the built-in Visual Studio Keymap extension
		await this.extensionService.whenInstalledExtensionsRegistered();

		const property = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties()[KEYBOARD_SHORTCUTS_SCHEME_SETTING];
		const ids = (property?.enum ?? [DEFAULT_SCHEME]) as string[];
		this.schemes = ids.map((id, index) => ({
			id,
			label: property?.enumItemLabels?.[index] ?? id,
			description: property?.enumDescriptions?.[index] ?? '',
		}));
		if (!this.schemes.some(scheme => scheme.id === this.selectedSchemeId)) {
			this.selectedSchemeId = DEFAULT_SCHEME;
		}

		this.renderOptions();
		this.renderPreview();
	}

	private renderOptions(): void {
		if (!this.optionsContainer) {
			return;
		}
		this.optionDisposables.clear();
		clearNode(this.optionsContainer);

		const legacySchemes = this.schemes.filter(scheme => LEGACY_SCHEMES.has(scheme.id));
		for (const scheme of this.schemes) {
			if (!LEGACY_SCHEMES.has(scheme.id) || this.showLegacySchemes) {
				this.renderOption(this.optionsContainer, scheme);
			}
		}

		if (legacySchemes.length && !this.showLegacySchemes) {
			const moreButton = append(this.optionsContainer, $('button.keyboard-shortcuts-more-button')) as HTMLButtonElement;
			moreButton.type = 'button';
			moreButton.textContent = localize('keyboardShortcuts.moreSchemes', "Show Legacy Visual Studio Schemes");
			this.optionDisposables.add(this.addDisposableListener(moreButton, 'click', () => {
				this.showLegacySchemes = true;
				this.renderOptions();
			}));
		}
	}

	private renderOption(parent: HTMLElement, scheme: IKeyboardScheme): void {
		const optionElement = append(parent, $('.keyboard-shortcuts-option'));

		const radio = append(optionElement, $('input.keyboard-shortcuts-radio')) as HTMLInputElement;
		radio.type = 'radio';
		radio.name = 'keyboardShortcutsScheme';
		radio.value = scheme.id;
		radio.id = `keyboardShortcutsScheme${scheme.id}`;
		radio.checked = scheme.id === this.selectedSchemeId;

		const textWrapper = append(optionElement, $('.keyboard-shortcuts-option-text'));
		const labelElement = append(textWrapper, $<HTMLLabelElement>('label.keyboard-shortcuts-option-label'));
		labelElement.textContent = scheme.label;
		labelElement.htmlFor = radio.id;
		const descriptionElement = append(textWrapper, $('.keyboard-shortcuts-option-description'));
		descriptionElement.textContent = scheme.description;
		descriptionElement.id = `${radio.id}Description`;
		radio.setAttribute('aria-describedby', descriptionElement.id);

		const select = () => {
			radio.checked = true;
			if (this.selectedSchemeId !== scheme.id) {
				this.selectedSchemeId = scheme.id;
				this.renderPreview();
			}
		};
		this.optionDisposables.add(this.addDisposableListener(radio, 'change', select));
		this.optionDisposables.add(this.addDisposableListener(optionElement, 'click', select));
	}

	private renderPreview(): void {
		if (!this.previewContainer || !this.schemes.length) {
			return;
		}
		this.previewDisposables.clear();
		clearNode(this.previewContainer);

		const header = append(this.previewContainer, $('.keyboard-shortcuts-preview-header'));
		header.textContent = localize('keyboardShortcuts.previewHeader', "Preview:");

		const columns = this.selectedSchemeId === DEFAULT_SCHEME ? [DEFAULT_SCHEME] : [DEFAULT_SCHEME, this.selectedSchemeId];

		const table = append(this.previewContainer, $('table.keyboard-shortcuts-preview-table'));
		const headerRow = append(append(table, $('thead')), $('tr'));
		append(headerRow, $('th')).textContent = localize('keyboardShortcuts.actionColumn', "Action");
		for (const column of columns) {
			append(headerRow, $('th')).textContent = this.schemes.find(scheme => scheme.id === column)?.label ?? column;
		}

		const body = append(table, $('tbody'));
		for (const row of PREVIEW_ROWS) {
			const tableRow = append(body, $('tr'));
			append(tableRow, $('td.keyboard-shortcuts-action')).textContent = row.label;

			const defaultKeybinding = this.lookupKeybinding(DEFAULT_SCHEME, row);
			for (const column of columns) {
				const keybinding = column === DEFAULT_SCHEME ? defaultKeybinding : this.lookupKeybinding(column, row);
				const cell = append(tableRow, $('td.keyboard-shortcuts-key'));
				if (column !== DEFAULT_SCHEME && keybinding?.getUserSettingsLabel() !== defaultKeybinding?.getUserSettingsLabel()) {
					cell.classList.add('changed');
				}
				if (keybinding) {
					this.previewDisposables.add(new KeybindingLabel(cell, OS, defaultKeybindingLabelStyles)).set(keybinding);
				} else {
					append(cell, $('span.keyboard-shortcuts-unbound')).textContent = localize('keyboardShortcuts.unbound', "Not Bound");
				}
			}
		}

		const notes = append(this.previewContainer, $('.keyboard-shortcuts-notes'));
		if (isMacintosh && this.selectedSchemeId !== DEFAULT_SCHEME) {
			append(notes, $('p')).textContent = localize('keyboardShortcuts.macNote', "On macOS, Ctrl is replaced by Cmd. Shortcuts that macOS reserves, such as Cmd+Space, Cmd+Q and Cmd+M, and text navigation keys keep their macOS behavior. Function keys may need the fn key.");
		}
	}

	private lookupKeybinding(schemeId: string, row: IShortcutPreviewRow): ResolvedKeybinding | undefined {
		return findSchemeKeybinding(this.keybindingService.getKeybindings(), this.contextKeyService, schemeId, row.command, row.context);
	}

	private async renderExtensionNotice(): Promise<void> {
		await this.extensionService.whenInstalledExtensionsRegistered();
		const noticeContainer = this.noticeContainer;
		if (!noticeContainer || !this.extensionService.extensions.some(extension => ExtensionIdentifier.equals(extension.identifier, VISUAL_STUDIO_KEYMAP_EXTENSION_ID))) {
			return;
		}

		clearNode(noticeContainer);
		noticeContainer.style.display = '';
		const message = append(noticeContainer, $('span.keyboard-shortcuts-notice-message'));
		message.textContent = localize('keyboardShortcuts.extensionNotice', "The Visual Studio Keymap extension is installed. Its shortcuts would be added on top of the scheme you choose here, so we recommend disabling it.");

		const button = append(noticeContainer, $('button.onboarding-button.secondary')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = localize('keyboardShortcuts.disableExtension', "Disable Extension");
		this.renderDisposables.add(this.addDisposableListener(button, 'click', async () => {
			const installed = await this.extensionManagementService.getInstalled();
			const extension = installed.find(local => areSameExtensions(local.identifier, { id: VISUAL_STUDIO_KEYMAP_EXTENSION_ID }));
			if (extension) {
				await this.extensionEnablementService.setEnablement([extension], EnablementState.DisabledGlobally);
			}
			noticeContainer.style.display = 'none';
		}));
	}

	override async applySettings(): Promise<void> {
		const value = this.selectedSchemeId === DEFAULT_SCHEME ? undefined : this.selectedSchemeId;
		await this.configurationService.updateValue(KEYBOARD_SHORTCUTS_SCHEME_SETTING, value, ConfigurationTarget.USER);
	}
}
