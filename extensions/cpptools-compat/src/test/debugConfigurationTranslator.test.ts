/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import { completeLldbCommands, IDebugConfiguration, ITranslationResult, translateCppDebugConfiguration } from '../debugConfigurationTranslator';

suite('translateCppDebugConfiguration', () => {

	const writeCommandFile = (commands: readonly string[]) => `/storage/${commands.join(';')}.lldb`;

	/**
	 * Translates a configuration, substitutes variables in it like VS Code does, and completes the LLDB commands.
	 */
	function translate(source: IDebugConfiguration, platform: NodeJS.Platform, variables: Record<string, string> = {}): ITranslationResult {
		const { configuration, issues } = translateCppDebugConfiguration(source, platform);
		const substituted = JSON.parse(JSON.stringify(configuration, (_key, value) =>
			typeof value === 'string' ? value.replace(/\$\{(?<name>[\w:]+)\}/g, (match, name: string) => variables[name] ?? match) : value));
		return { configuration: completeLldbCommands(substituted, writeCommandFile), issues };
	}

	test('cppdbg launch with lldb', () => {
		const result = translate({
			name: 'Debug',
			type: 'cppdbg',
			request: 'launch',
			program: '${workspaceFolder}/build/app',
			args: ['--verbose'],
			cwd: '${workspaceFolder}',
			environment: [{ name: 'GREETING', value: 'hello' }, { name: 'EMPTY' }],
			stopAtEntry: true,
			externalConsole: false,
			MIMode: 'lldb',
			miDebuggerPath: '/usr/bin/lldb-mi',
			setupCommands: [
				{ text: '-enable-pretty-printing', ignoreFailures: true },
				{ text: 'settings set target.max-children-count 500' },
				{ text: 'command script import ~/formatters.py', ignoreFailures: true },
			],
			sourceFileMap: { '/build': '/src', '/other': { editorPath: '/local', useForBreakpoints: true } },
			preLaunchTask: 'C/C++: clang++ build active file',
		}, 'darwin');

		assert.deepStrictEqual(result, {
			configuration: {
				name: 'Debug',
				type: 'lldb',
				request: 'launch',
				program: '${workspaceFolder}/build/app',
				args: ['--verbose'],
				cwd: '${workspaceFolder}',
				env: { GREETING: 'hello', EMPTY: '' },
				preRunCommands: ['breakpoint set --one-shot true --name main'],
				initCommands: [
					'settings set target.max-children-count 500',
					'command source --stop-on-error false "/storage/command script import ~/formatters.py.lldb"',
				],
				sourceMap: { '/build': '/src', '/other': '/local' },
				preLaunchTask: 'C/C++: clang++ build active file',
			},
			issues: [
				{ kind: 'ignoredSetupCommand', command: '-enable-pretty-printing' },
				{ kind: 'ignoredProperty', property: 'miDebuggerPath' },
			],
		});
	});

	test('gdb setup commands are skipped', () => {
		const result = translate({
			name: 'Debug',
			type: 'cppdbg',
			request: 'launch',
			program: 'app',
			setupCommands: [{ text: 'set print pretty on' }],
		}, 'linux');

		assert.deepStrictEqual(result.issues, [{ kind: 'ignoredSetupCommand', command: 'set print pretty on' }]);
		assert.strictEqual(result.configuration.initCommands, undefined);
	});

	test('cppdbg attach', () => {
		const result = translate({
			name: 'Attach',
			type: 'cppdbg',
			request: 'attach',
			program: 'app',
			processId: '${command:pickProcess}',
			additionalSOLibSearchPath: '/opt/lib;/usr/local/lib',
		}, 'linux');

		assert.deepStrictEqual(result, {
			configuration: {
				name: 'Attach',
				type: 'lldb',
				request: 'attach',
				program: 'app',
				pid: '${command:pickProcess}',
				initCommands: ['settings append target.exec-search-paths "/opt/lib" "/usr/local/lib"'],
			},
			issues: [],
		});
	});

	test('core dump and remote server', () => {
		const core = translate({
			name: 'Core',
			type: 'cppdbg',
			request: 'launch',
			program: '/tmp/my app',
			coreDumpPath: '/tmp/core',
		}, 'linux');
		const remote = translate({
			name: 'Remote',
			type: 'cppdbg',
			request: 'attach',
			program: 'app',
			processId: 12,
			miDebuggerServerAddress: 'localhost:1234',
		}, 'linux');

		assert.deepStrictEqual([core.configuration, remote.configuration], [
			{
				name: 'Core',
				type: 'lldb',
				request: 'launch',
				program: '/tmp/my app',
				targetCreateCommands: ['target create "/tmp/my app" --core "/tmp/core"'],
				processCreateCommands: [],
			},
			{
				name: 'Remote',
				type: 'lldb',
				request: 'attach',
				program: 'app',
				pid: 12,
				processCreateCommands: ['gdb-remote localhost:1234', 'process continue'],
			},
		]);
	});

	test('LLDB commands are completed after substituting variables', () => {
		const result = translate({
			name: 'Core',
			type: 'cppdbg',
			request: 'launch',
			program: '${workspaceFolder}\\app',
			coreDumpPath: '${workspaceFolder}\\core',
			symbolSearchPath: '${workspaceFolder}\\symbols',
			additionalSOLibSearchPath: '${env:LIB_DIRS};C:\\more',
			MIMode: 'lldb',
			setupCommands: [{ text: 'command script import "${workspaceFolder}\\optional.py"', ignoreFailures: true }],
		}, 'win32', { workspaceFolder: '\\\\server\\John\'s share', 'env:LIB_DIRS': 'C:\\one;C:\\two' });

		assert.deepStrictEqual([result.configuration.initCommands, result.configuration.targetCreateCommands], [
			[
				String.raw`settings append target.exec-search-paths "C:\\one" "C:\\two" "C:\\more"`,
				String.raw`settings append target.debug-file-search-paths "\\\\server\\John's share\\symbols"`,
				String.raw`command source --stop-on-error false "/storage/command script import \"\\\\server\\John's share\\optional.py\".lldb"`,
			],
			[String.raw`target create "\\\\server\\John's share\\app" --core "\\\\server\\John's share\\core"`],
		]);
	});

	test('search path lists that are empty after substituting variables', () => {
		const result = translate({
			name: 'Attach',
			type: 'cppdbg',
			request: 'attach',
			program: 'app',
			additionalSOLibSearchPath: '${env:LIB_DIRS}',
		}, 'linux', { 'env:LIB_DIRS': '' });

		assert.deepStrictEqual(result.configuration.initCommands, ['# settings append target.exec-search-paths ']);
	});

	test('LLDB commands are usable before they are completed', () => {
		// CodeLLDB's process picker runs the init commands while VS Code substitutes variables
		const { configuration } = translateCppDebugConfiguration({
			name: 'Attach',
			type: 'cppdbg',
			request: 'attach',
			program: 'app',
			processId: '${command:pickProcess}',
			additionalSOLibSearchPath: '${workspaceFolder}/lib',
			MIMode: 'lldb',
			setupCommands: [{ text: 'command script import optional.py', ignoreFailures: true }],
		}, 'linux');

		assert.deepStrictEqual(configuration.initCommands, [
			'settings append target.exec-search-paths "${workspaceFolder}/lib"',
			'# command script import optional.py',
		]);
	});

	test('cppvsdbg launch', () => {
		const result = translate({
			name: 'Windows',
			type: 'cppvsdbg',
			request: 'launch',
			program: 'C:\\build\\app.exe',
			console: 'integratedTerminal',
			symbolSearchPath: 'C:\\symbols',
			visualizerFile: 'types.natvis',
			stopAtEntry: true,
		}, 'win32');

		assert.deepStrictEqual(result, {
			configuration: {
				name: 'Windows',
				type: 'lldb',
				request: 'launch',
				program: 'C:\\build\\app.exe',
				preRunCommands: ['breakpoint set --one-shot true --name main --name wmain --name WinMain --name wWinMain'],
				terminal: 'integrated',
				initCommands: ['settings append target.debug-file-search-paths "C:\\\\symbols"'],
			},
			issues: [{ kind: 'ignoredProperty', property: 'visualizerFile' }],
		});
	});

	test('run without debugging with platform specific properties', () => {
		// The debug service applies the platform specific properties to the configuration before resolving it
		const result = translate({
			name: 'Run',
			type: 'cppvsdbg',
			request: 'launch',
			program: 'C:\\build\\app.exe',
			stopAtEntry: true,
			noDebug: true,
			console: 'newExternalWindow',
			windows: { console: 'newExternalWindow' },
		}, 'win32');

		assert.deepStrictEqual(result, {
			configuration: {
				name: 'Run',
				type: 'lldb',
				request: 'launch',
				program: 'C:\\build\\app.exe',
				noDebug: true,
				terminal: 'external',
			},
			issues: [],
		});
	});

	test('platform specific properties not applied by the debug service', () => {
		// Configurations passed to `vscode.debug.startDebugging` are resolved without applying them
		const result = translate({
			name: 'API',
			type: 'cppdbg',
			request: 'launch',
			program: 'app',
			linux: { program: 'app-linux', environment: [{ name: 'LINUX', value: '1' }] },
			windows: { program: 'app.exe' },
		}, 'linux');

		assert.deepStrictEqual(result.configuration, {
			name: 'API',
			type: 'lldb',
			request: 'launch',
			program: 'app-linux',
			env: { LINUX: '1' },
		});
	});

	test('pipeTransport is unsupported', () => {
		const result = translate({
			name: 'Remote',
			type: 'cppdbg',
			request: 'launch',
			program: 'app',
			pipeTransport: { pipeProgram: 'ssh' },
		}, 'linux');

		assert.deepStrictEqual(result.issues, [{ kind: 'unsupportedProperty', property: 'pipeTransport' }]);
	});
});
