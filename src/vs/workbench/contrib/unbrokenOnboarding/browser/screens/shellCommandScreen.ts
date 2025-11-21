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
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';

export class ShellCommandScreen extends BaseOnboardingScreen {

	private installButton: HTMLButtonElement | undefined;
	private statusMessage: HTMLElement | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILanguageService languageService: ILanguageService,
		@IExtensionService extensionService: IExtensionService,
		@IStorageService storageService: IStorageService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService private readonly productService: IProductService
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
		return 'Unbroken Code Setup - Command Line Tool';
	}

	get description(): string {
		return '';
	}

	render(parent: HTMLElement): void {
		this.container = append(parent, $('.shell-command-screen'));

		// Create header
		this.createHeader(this.container);

		// Create content area
		const content = append(this.container, $('.onboarding-screen-content'));

		// Explanation section
		const explanation = append(content, $('.shell-command-explanation'));

		const introText = append(explanation, $('p.shell-command-intro'));
		introText.textContent = `You can install a "${this.productService.applicationName}" command in your terminal that lets you open files and folders directly from the command line.`;

		const useCasesTitle = append(explanation, $('h3.shell-command-uses-title'));
		useCasesTitle.textContent = 'What you can do with it:';

		const useCases = append(explanation, $('ul.shell-command-uses'));
		const appName = this.productService.applicationName;
		const cases: [string, string][] = [
			[`${appName} .`, 'Open the current folder in Unbroken Code'],
			[`${appName} myfile.txt`, 'Open a specific file'],
			[`${appName} --diff file1 file2`, 'Compare two files side by side'],
			[`${appName} -r ~/projects/myapp`, 'Open a folder and reuse the current window'],
			[`some-command | ${appName} -`, 'Pipe output into the editor'],
		];
		for (const [command, description] of cases) {
			const li = append(useCases, $('li'));
			const cmd = append(li, $('code.shell-command-cmd'));
			cmd.textContent = command;
			const desc = append(li, $('span.shell-command-desc'));
			desc.textContent = ` \u2014 ${description}`;
		}

		const noteText = append(explanation, $('p.shell-command-note'));
		noteText.textContent = 'You can always install or remove this later from the Command Palette: "Shell Command: Install/Uninstall".';

		// Install button
		const actions = append(content, $('.shell-command-actions'));

		this.installButton = append(actions, $('button.onboarding-button.primary')) as HTMLButtonElement;
		this.installButton.textContent = `Install '${this.productService.applicationName}' command in PATH`;
		this._register(this.addDisposableListener(this.installButton, 'click', () => {
			this.installShellCommand();
		}));

		this.statusMessage = append(actions, $('span.shell-command-status'));

		// Create footer with navigation
		this.createFooter(this.container, { showSkip: true, showPrevious: true, nextLabel: 'Finish' });
	}

	private async installShellCommand(): Promise<void> {
		if (!this.installButton || !this.statusMessage) {
			return;
		}

		this.installButton.disabled = true;
		this.installButton.textContent = 'Installing...';
		this.statusMessage.textContent = '';

		try {
			await this.commandService.executeCommand('workbench.action.installCommandLine');
			this.installButton.textContent = 'Installed';
			this.statusMessage.textContent = `The '${this.productService.applicationName}' command is now available in your terminal.`;
			this.statusMessage.classList.remove('error');
			this.statusMessage.classList.add('success');
		} catch {
			this.installButton.textContent = `Install '${this.productService.applicationName}' command in PATH`;
			this.installButton.disabled = false;
		}
	}

	override async applySettings(): Promise<void> {
		// No settings to apply
	}
}
