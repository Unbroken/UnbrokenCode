/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CppBuildTaskProvider } from './cppBuildTaskProvider';
import { completeLldbCommands, IDebugConfiguration, translateCppDebugConfiguration } from './debugConfigurationTranslator';

const cppToolsExtensionId = 'ms-vscode.cpptools';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	let compatibility: vscode.Disposable | undefined;

	// The Microsoft C/C++ extension can be installed, enabled or removed while VS Code is running
	const update = async (): Promise<void> => {
		const useCompatibility = !vscode.extensions.getExtension(cppToolsExtensionId);
		if (useCompatibility === !!compatibility) {
			return;
		}
		if (useCompatibility) {
			compatibility = registerCompatibility(context);
		} else {
			// The real thing is installed. Stay out of its way.
			compatibility?.dispose();
			compatibility = undefined;
		}
		// Hide the cppdbg and cppvsdbg debug types from the debug type picker while they are translated, as only
		// existing launch configurations are supported. The context key is only set here, so before activation,
		// or with the Microsoft C/C++ extension installed, the debug types it contributes are never hidden.
		await vscode.commands.executeCommand('setContext', 'cpptoolsCompat.hideDebuggers', useCompatibility);
	};

	context.subscriptions.push(
		vscode.extensions.onDidChange(() => update()),
		{ dispose: () => compatibility?.dispose() },
	);
	await update();
}

function registerCompatibility(context: vscode.ExtensionContext): vscode.Disposable {
	const log = vscode.window.createOutputChannel(vscode.l10n.t("C/C++ Compatibility"), { log: true });
	const debugConfigurationResolver = new CppDebugConfigurationResolver(log);
	const commandFileDirectory = path.join(context.globalStorageUri.fsPath, 'lldb-commands');

	return vscode.Disposable.from(
		log,
		vscode.tasks.registerTaskProvider(CppBuildTaskProvider.taskType, new CppBuildTaskProvider()),
		vscode.debug.registerDebugConfigurationProvider('cppdbg', debugConfigurationResolver),
		vscode.debug.registerDebugConfigurationProvider('cppvsdbg', debugConfigurationResolver),
		// The translated configurations are resolved as lldb configurations. Generated LLDB commands are
		// completed once VS Code has substituted the variables in them.
		vscode.debug.registerDebugConfigurationProvider('lldb', {
			resolveDebugConfigurationWithSubstitutedVariables: async (_folder, configuration) => {
				const commandFiles = new Map<string, string>();
				const completed = completeLldbCommands(configuration as IDebugConfiguration, commands => addLldbCommandFile(commandFiles, commandFileDirectory, commands));
				await writeLldbCommandFiles(commandFileDirectory, commandFiles);
				return completed as vscode.DebugConfiguration;
			},
		}),
	);
}

/**
 * Turns cppdbg and cppvsdbg configurations into CodeLLDB configurations. The debug service resolves
 * the configuration again for the new type, so CodeLLDB's own resolver runs afterwards.
 */
class CppDebugConfigurationResolver implements vscode.DebugConfigurationProvider {

	constructor(private readonly log: vscode.LogOutputChannel) { }

	resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration): vscode.DebugConfiguration | undefined {
		const { configuration, issues } = translateCppDebugConfiguration(debugConfiguration as IDebugConfiguration, process.platform);

		const unsupported: string[] = [];
		for (const issue of issues) {
			switch (issue.kind) {
				case 'ignoredProperty':
					this.log.info(`${debugConfiguration.name}: ignoring '${issue.property}', it only applies to the Microsoft C/C++ debuggers`);
					break;
				case 'ignoredSetupCommand':
					this.log.info(`${debugConfiguration.name}: ignoring setup command '${issue.command}', it is not an LLDB command`);
					break;
				case 'unsupportedProperty':
					unsupported.push(issue.property);
					break;
			}
		}

		if (unsupported.length) {
			this.log.error(`${debugConfiguration.name}: unsupported properties ${unsupported.join(', ')}`);
			vscode.window.showErrorMessage(vscode.l10n.t("The launch configuration '{0}' uses {1}, which requires the Microsoft C/C++ extension.", debugConfiguration.name, unsupported.join(', ')));
			return undefined;
		}

		this.log.info(`${debugConfiguration.name}: translated ${debugConfiguration.type} configuration to lldb: ${JSON.stringify(configuration)}`);
		return configuration as vscode.DebugConfiguration;
	}
}

/**
 * Adds an LLDB command file to the files to write, in a directory only this user can write to, named after its
 * contents, and returns its path.
 */
function addLldbCommandFile(files: Map<string, string>, directory: string, commands: readonly string[]): string {
	const contents = commands.join('\n') + '\n';
	const file = path.join(directory, `${crypto.createHash('sha256').update(contents).digest('hex')}.lldb`);
	files.set(file, contents);
	return file;
}

/**
 * Writes the LLDB command files, which the debugger reads once the configuration is resolved. Configurations that
 * are resolved at the same time, as those of a compound launch are, can write the same file, so each is written to a
 * file of its own and then renamed, which replaces the file in one step: the debugger never reads a partial file.
 */
async function writeLldbCommandFiles(directory: string, files: ReadonlyMap<string, string>): Promise<void> {
	if (files.size === 0) {
		return;
	}
	await fs.promises.mkdir(directory, { recursive: true });
	await Promise.all(Array.from(files, async ([file, contents]) => {
		const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
		try {
			await fs.promises.writeFile(temporaryFile, contents);
			await fs.promises.rename(temporaryFile, file);
		} finally {
			await fs.promises.rm(temporaryFile, { force: true });
		}
	}));
}
