/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildShellCommandLine, CommandString, commandStringValue, findOutputPath } from './shellCommandLine';

interface ICppBuildOptions {
	cwd?: string;
	env?: Record<string, string>;
	shell?: string;
}

interface ICppBuildPlatformOverride {
	command?: CommandString;
	args?: CommandString[];
	options?: ICppBuildOptions;
	problemMatcher?: string | string[];
}

/**
 * A `cppbuild` task from tasks.json, as defined by the Microsoft C/C++ extension.
 */
interface ICppBuildTaskDefinition extends vscode.TaskDefinition, ICppBuildPlatformOverride {
	label: string;
	command: CommandString;
	windows?: ICppBuildPlatformOverride;
	linux?: ICppBuildPlatformOverride;
	osx?: ICppBuildPlatformOverride;
}

const cppLanguageIds = new Set(['c', 'cpp', 'cuda-cpp', 'objective-c', 'objective-cpp']);

/**
 * Runs `cppbuild` tasks the way the Microsoft C/C++ extension does: the compiler command line is run
 * through a shell, and the build is reported as failed when the compiler reports errors.
 */
export class CppBuildTaskProvider implements vscode.TaskProvider {

	static readonly taskType = 'cppbuild';

	provideTasks(): vscode.Task[] {
		return [];
	}

	resolveTask(task: vscode.Task): vscode.Task | undefined {
		if (task.execution) {
			return undefined;
		}

		const definition = task.definition as ICppBuildTaskDefinition;
		const effective = applyPlatformOverrides(definition, process.platform);
		if (effective.command === undefined) {
			return undefined;
		}

		// A command with spaces in its path can be quoted, such as "C:\Program Files\...\cl.exe"
		const compilerName = path.basename(commandStringValue(effective.command).replace(/^(["'])(.*)\1$/, '$2')).toLowerCase();
		const isCl = compilerName === 'cl.exe' || compilerName === 'cl';
		// Must be checked before `${file}` is resolved
		const usesActiveFile = (effective.args ?? []).some(arg => commandStringValue(arg).includes('${file}'));
		const scope = task.scope ?? vscode.TaskScope.Workspace;

		const execution = new vscode.CustomExecution(async resolvedDefinition => {
			const resolved = applyPlatformOverrides(resolvedDefinition as ICppBuildTaskDefinition, process.platform);
			return new CppBuildTaskTerminal(resolved, effective.command, usesActiveFile, typeof scope === 'object' ? scope : undefined);
		});

		const resolvedTask = new vscode.Task(definition, scope, definition.label, 'C/C++', execution, effective.problemMatcher ?? (isCl ? '$msCompile' : '$gcc'));
		resolvedTask.group = vscode.TaskGroup.Build;
		resolvedTask.detail = task.detail ?? vscode.l10n.t("compiler: {0}", commandStringValue(effective.command));
		return resolvedTask;
	}
}

function applyPlatformOverrides(definition: ICppBuildTaskDefinition, platform: NodeJS.Platform): ICppBuildTaskDefinition {
	const override = platform === 'win32' ? definition.windows : platform === 'darwin' ? definition.osx : platform === 'linux' ? definition.linux : undefined;
	if (!override) {
		return definition;
	}
	return {
		...definition,
		command: override.command ?? definition.command,
		args: override.args ?? definition.args,
		// Platform specific options replace the common options, as when VS Code substitutes variables in the definition
		// before running the task. The task's identity is derived from the definition, so it can't carry merged options.
		options: override.options ?? definition.options,
		problemMatcher: override.problemMatcher ?? definition.problemMatcher,
	};
}

class CppBuildTaskTerminal implements vscode.Pseudoterminal {

	private readonly writeEmitter = new vscode.EventEmitter<string>();
	readonly onDidWrite = this.writeEmitter.event;

	private readonly closeEmitter = new vscode.EventEmitter<number>();
	readonly onDidClose = this.closeEmitter.event;

	private process: cp.ChildProcess | undefined;
	private terminated = false;

	constructor(
		private readonly definition: ICppBuildTaskDefinition,
		private readonly unresolvedCommand: CommandString,
		private readonly usesActiveFile: boolean,
		private readonly folder: vscode.WorkspaceFolder | undefined,
	) { }

	open(): void {
		this.build().then(
			exitCode => this.closeEmitter.fire(exitCode),
			error => {
				this.writeLine(error instanceof Error ? error.message : String(error));
				this.closeEmitter.fire(1);
			});
	}

	close(): void {
		this.terminate();
	}

	handleInput(data: string): void {
		if (data === '\x03') {
			this.terminate();
		}
	}

	/**
	 * Kills the shell and everything it started, such as the compiler and linker.
	 */
	private terminate(): void {
		// The build can be cancelled before the shell is started
		this.terminated = true;
		const pid = this.process?.pid;
		if (pid === undefined) {
			return;
		}
		if (process.platform === 'win32') {
			cp.execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => { });
			return;
		}
		try {
			// The shell is started in its own process group, see build()
			process.kill(-pid, 'SIGTERM');
		} catch {
			this.process?.kill();
		}
	}

	private async build(): Promise<number> {
		if (this.usesActiveFile) {
			const document = vscode.window.activeTextEditor?.document;
			if (!document || !cppLanguageIds.has(document.languageId)) {
				this.writeLine(vscode.l10n.t("Cannot build because the active file is not a C or C++ source file."));
				return 1;
			}
		}

		this.writeLine(vscode.l10n.t("Starting build..."));

		const args = this.definition.args ?? [];
		const outputPath = findOutputPath(args, process.platform);
		// Relative working directories are relative to the workspace folder, as for other tasks
		const defaultCwd = this.defaultCwd();
		const configuredCwd = this.definition.options?.cwd;
		const cwd = configuredCwd ? (defaultCwd ? path.resolve(defaultCwd, configuredCwd) : configuredCwd) : defaultCwd;
		if (outputPath) {
			await fs.promises.mkdir(path.dirname(path.resolve(cwd ?? '', outputPath)), { recursive: true });
		}

		if (this.terminated) {
			this.writeLine(vscode.l10n.t("Build run was terminated."));
			return 1;
		}

		const commandLine = buildShellCommandLine(this.definition.command, args, process.platform, this.unresolvedCommand);
		this.writeLine(commandLine);

		const env = this.definition.options?.env ? { ...process.env, ...this.definition.options.env } : undefined;
		// On Windows the command line is a `cmd /c` command line, which the configured shell may not be able
		// to run (PowerShell rejects `&&`), so it is always run by cmd.exe.
		// On POSIX the shell gets its own process group, so cancelling can terminate everything it started.
		const isWindows = process.platform === 'win32';
		const child = cp.spawn(commandLine, { cwd, env, shell: isWindows ? true : this.definition.options?.shell ?? true, detached: !isWindows });
		this.process = child;

		let stdout = '';
		let stderr = '';
		let spawnError = '';
		// Decoded as a stream, as a character can span two chunks of output
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (text: string) => {
			stdout += text;
			this.write(text);
		});
		child.stderr.on('data', (text: string) => {
			stderr += text;
			this.write(text);
		});

		const exitCode = await new Promise<number | null>(resolve => {
			child.on('error', error => {
				spawnError = error.message;
				this.writeLine(error.message);
				resolve(1);
			});
			child.on('close', code => resolve(code));
		});
		this.process = undefined;
		this.writeLine('');

		if (exitCode === null) {
			this.writeLine(vscode.l10n.t("Build run was terminated."));
			return 1;
		}
		return this.reportResult(exitCode, spawnError, stdout, stderr);
	}

	/**
	 * Same heuristics as the Microsoft C/C++ extension: cl.exe reports errors and warnings on stdout,
	 * gcc and clang on stderr.
	 */
	private reportResult(exitCode: number, spawnError: string, stdout: string, stderr: string): number {
		if (exitCode !== 0
			|| spawnError
			|| (!stdout && stderr.includes('error'))
			|| stdout.includes('error C')
			|| stdout.includes('LINK : fatal error')) {
			this.writeLine(vscode.l10n.t("Build finished with error(s)."));
			// Negative exit codes are reported as the task failing to launch
			return exitCode > 0 ? exitCode : 1;
		}
		if ((!stdout && stderr) || stdout.includes('warning C')) {
			this.writeLine(vscode.l10n.t("Build finished with warning(s)."));
		} else {
			this.writeLine(vscode.l10n.t("Build finished successfully."));
		}
		return 0;
	}

	private defaultCwd(): string | undefined {
		if (this.folder) {
			return this.folder.uri.fsPath;
		}
		const editorUri = vscode.window.activeTextEditor?.document.uri;
		const folder = (editorUri && vscode.workspace.getWorkspaceFolder(editorUri)) ?? vscode.workspace.workspaceFolders?.[0];
		return folder?.uri.fsPath;
	}

	private write(text: string): void {
		this.writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));
	}

	private writeLine(text: string): void {
		this.writeEmitter.fire(`${text}\r\n`);
	}
}
