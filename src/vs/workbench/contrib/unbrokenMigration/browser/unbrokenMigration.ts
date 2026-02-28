/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, Dimension } from '../../../../base/browser/dom.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { isWindows, isMacintosh } from '../../../../base/common/platform.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { UnbrokenMigrationInput } from './unbrokenMigrationInput.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import './unbrokenMigration.css';

export class UnbrokenMigrationPage extends EditorPane {

	public static readonly ID = 'unbrokenMigrationPage';

	private container: HTMLElement | undefined;
	private readonly contentDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchThemeService themeService: IWorkbenchThemeService,
		@IStorageService storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(UnbrokenMigrationPage.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.unbroken-migration-page'));
	}

	override async setInput(input: UnbrokenMigrationInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.renderContent();
	}

	private renderContent(): void {
		if (!this.container) {
			return;
		}

		const content = append(this.container, $('.migration-content'));

		// Header
		const header = append(content, $('.migration-header'));
		const title = append(header, $('h1.migration-title'));
		title.textContent = 'Command Line Tool Renamed';

		const subtitle = append(header, $('p.migration-subtitle'));
		subtitle.textContent = 'The command line tool for Unbroken Code has been renamed to "uc". You will need to update your shell setup to use the new name.';

		// Platform-specific instructions
		if (isMacintosh) {
			this.renderMacInstructions(content);
		} else if (isWindows) {
			this.renderWindowsInstructions(content);
		} else {
			this.renderLinuxInstructions(content);
		}

		// Action buttons
		const actions = append(content, $('.migration-actions'));

		const installButton = append(actions, $('button.migration-button.primary'));
		installButton.textContent = 'Install \'uc\' command in PATH';
		this.contentDisposables.add(this.addDisposableListener(installButton, 'click', () => {
			this.commandService.executeCommand('workbench.action.installCommandLine');
		}));

		const closeButton = append(actions, $('button.migration-button.secondary'));
		closeButton.textContent = 'Close';
		this.contentDisposables.add(this.addDisposableListener(closeButton, 'click', () => {
			this.group?.closeEditor(this.input);
		}));
	}

	private renderMacInstructions(parent: HTMLElement): void {
		const section = append(parent, $('.migration-instructions'));

		const stepTitle = append(section, $('h2.migration-section-title'));
		stepTitle.textContent = 'What you need to do';

		const steps = append(section, $('ol.migration-steps'));

		const step1 = append(steps, $('li'));
		step1.textContent = 'Remove the old command:';
		const code1 = append(step1, $('code.migration-code'));
		code1.textContent = 'sudo rm /usr/local/bin/code';

		const step2 = append(steps, $('li'));
		step2.textContent = 'Install the new command by clicking the button below, or use the Command Palette and run "Shell Command: Install \'uc\' command in PATH".';
	}

	private renderWindowsInstructions(parent: HTMLElement): void {
		const section = append(parent, $('.migration-instructions'));

		const stepTitle = append(section, $('h2.migration-section-title'));
		stepTitle.textContent = 'What happened';

		const explanation = append(section, $('p.migration-explanation'));
		explanation.textContent = 'The old "code" command has been automatically removed during the update. The new "uc" command should already be available if you had "Add to PATH" selected during installation.';

		const note = append(section, $('p.migration-note'));
		note.textContent = 'If the "uc" command is not working, try restarting your terminal or click the button below.';
	}

	private renderLinuxInstructions(parent: HTMLElement): void {
		const section = append(parent, $('.migration-instructions'));

		const stepTitle = append(section, $('h2.migration-section-title'));
		stepTitle.textContent = 'What you need to do';

		const steps = append(section, $('ol.migration-steps'));

		const step1 = append(steps, $('li'));
		step1.textContent = 'Remove the old command:';
		const code1 = append(step1, $('code.migration-code'));
		code1.textContent = 'sudo rm /usr/local/bin/unbroken-code';

		const step2 = append(steps, $('li'));
		step2.textContent = 'Install the new command by clicking the button below, or use the Command Palette and run "Shell Command: Install \'uc\' command in PATH".';
	}

	private addDisposableListener(element: HTMLElement, event: string, handler: EventListener): IDisposable {
		element.addEventListener(event, handler);
		return { dispose: () => element.removeEventListener(event, handler) };
	}

	override focus(): void {
		this.container?.focus();
	}

	override layout(_dimension: Dimension): void {
		// CSS handles layout
	}
}
