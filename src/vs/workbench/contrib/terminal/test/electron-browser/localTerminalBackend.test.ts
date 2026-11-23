/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { join } from '../../../../../base/common/path.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { INativeWorkbenchEnvironmentService } from '../../../../services/environment/electron-browser/environmentService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ExtensionIdentifier, type IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { EnvironmentVariableMutatorType, type ISerializableEnvironmentVariableCollections } from '../../../../../platform/terminal/common/environmentVariable.js';
import { ILocalPtyService, ITerminalChildProcess, ITerminalLogService, type ISerializedTerminalState } from '../../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IConfigurationResolverService } from '../../../../services/configurationResolver/common/configurationResolver.js';
import { IHistoryService } from '../../../../services/history/common/history.js';
import { IEnvironmentVariableService } from '../../common/environmentVariable.js';
import { EnvironmentVariableService } from '../../common/environmentVariableService.js';
import { ITerminalProfileResolverService } from '../../common/terminal.js';
import { TerminalStorageKeys } from '../../common/terminalStorageKeys.js';
import { TestContextService, TestHistoryService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { LocalPty } from '../../electron-browser/localPty.js';
import { isWindowsPosixShell, LocalTerminalBackend, withoutClaudeWrapperDirectories } from '../../electron-browser/localTerminalBackend.js';

class RecordingLogService extends NullLogService {
	readonly warnings: { message: string; args: unknown[] }[] = [];

	override warn(message: string, ...args: unknown[]): void {
		this.warnings.push({ message, args });
	}
}

suite('LocalTerminalBackend', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('isWindowsPosixShell gets the Claude Code wrapper only to POSIX shells such as Git Bash', () => {
		const shells = [
			'C:\\Program Files\\Git\\bin\\bash.exe',
			'C:\\msys64\\usr\\bin\\zsh.exe',
			'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
			'C:\\Program Files\\Git\\bin\\sh.exe',
			'C:\\Tools\\PortableGit\\bin\\sh.exe',
			'C:\\tools\\busybox\\sh.exe',
			'.\\bash.exe',
			'C:\\Windows\\System32\\bash.exe',
			'C:\\Windows\\System32\\.\\bash.exe',
			'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe',
			'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\MicrosoftCorporationII.WindowsSubsystemForLinux_8wekyb3d8bbwe\\bash.exe',
			'C:\\Windows\\System32\\wsl.exe',
			'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
			'powershell.exe',
			'C:\\Windows\\System32\\cmd.exe',
			'bash.exe',
			undefined
		];
		deepStrictEqual(shells.map(shell => isWindowsPosixShell(shell)), [true, true, true, true, true, false, false, false, false, false, false, false, false, false, false, false, false]);
	});

	test('withoutClaudeWrapperDirectories removes the Claude Code wrapper\'s directories of any install, however they are written', () => {
		deepStrictEqual(
			withoutClaudeWrapperDirectories('C:\\App\\BIN_COMPAT\\posix\\;C:\\App\\bin_compat;;C:/Other App/bin_compat/posix;C:\\App\\bin_compat\\posix\\.;C:\\App\\bin_compat\\posix.;C:\\App\\bin_compat.\\posix;.\\bin_compat\\posix;C:\\App\\bin_compat\\posix\\ ;\"C:\\Program Files\\App\\bin_compat\\posix\";C:\\Users\\me\\.local\\bin;C:\\tools\\posix'),
			'C:\\App\\bin_compat;;C:\\Users\\me\\.local\\bin;C:\\tools\\posix'
		);
	});

	test('attachToRevivedProcess only falls back to the original process when it still has the saved pid', async () => {
		const livePids = new Map([[1, 101], [2, 202], [3, 303]]);
		const revivedIds = new Map([[7, 1], [2, 2], [8, 5]]);
		const attachRequests: [id: number, pid: number | undefined][] = [];

		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(ITerminalLogService, new NullLogService());
		instantiationService.stub(ILocalPtyService, upcastPartial<ILocalPtyService>({
			onPtyHostExit: Event.None,
			onPtyHostStart: Event.None,
			onPtyHostUnresponsive: Event.None,
			onPtyHostResponsive: Event.None,
			onPtyHostRequestResolveVariables: Event.None,
			getRevivedPtyNewId: async (_workspaceId: string, id: number) => revivedIds.get(id),
			attachToProcess: async (id: number, pid?: number) => {
				attachRequests.push([id, pid]);
				const livePid = livePids.get(id);
				if (livePid === undefined) {
					throw new Error(`Could not find pty ${id} on pty host`);
				}
				if (pid !== undefined && pid !== livePid) {
					throw new Error(`Pty ${id} has pid ${livePid}, expected ${pid}`);
				}
			}
		}));
		const backend = store.add(instantiationService.createInstance(LocalTerminalBackend));
		// Treat the pty host as connected so requests go to the local pty service stub
		const connected = new DeferredPromise<void>();
		await connected.complete();
		Reflect.set(backend, '_directProxyClientEventually', connected);

		async function attach(attachToProcess: () => Promise<ITerminalChildProcess | undefined>) {
			attachRequests.length = 0;
			const pty = await attachToProcess();
			if (pty instanceof LocalPty) {
				store.add(pty);
			}
			return { attachedId: pty?.id, isRevived: pty?.isRevived, requests: [...attachRequests] };
		}

		deepStrictEqual({
			revivedWithNewId: await attach(() => backend.attachToRevivedProcess(7, 7007)),
			revivedWithSameId: await attach(() => backend.attachToRevivedProcess(2, 2002)),
			revivedButMissing: await attach(() => backend.attachToRevivedProcess(8, 8008)),
			originalWithSavedPid: await attach(() => backend.attachToRevivedProcess(3, 303)),
			originalWithOtherPid: await attach(() => backend.attachToRevivedProcess(3, 9009)),
			originalWithUnknownPid: await attach(() => backend.attachToRevivedProcess(3, 0)),
			originalWithNegativePid: await attach(() => backend.attachToRevivedProcess(3, -1)),
			originalMissing: await attach(() => backend.attachToRevivedProcess(4, 404)),
			attachById: await attach(() => backend.attachToProcess(3)),
		}, {
			revivedWithNewId: { attachedId: 1, isRevived: true, requests: [[1, undefined]] },
			revivedWithSameId: { attachedId: 2, isRevived: true, requests: [[2, undefined]] },
			revivedButMissing: { attachedId: undefined, isRevived: undefined, requests: [[5, undefined]] },
			originalWithSavedPid: { attachedId: 3, isRevived: false, requests: [[3, 303]] },
			originalWithOtherPid: { attachedId: undefined, isRevived: undefined, requests: [[3, 9009]] },
			originalWithUnknownPid: { attachedId: 3, isRevived: false, requests: [[3, undefined]] },
			originalWithNegativePid: { attachedId: 3, isRevived: false, requests: [[3, undefined]] },
			originalMissing: { attachedId: undefined, isRevived: undefined, requests: [[4, 404]] },
			attachById: { attachedId: 3, isRevived: false, requests: [[3, undefined]] },
		});
	});

	test('revival refreshes both the environment and collection options before sending persisted state to the pty host', async () => {
		let revivedState: ISerializedTerminalState[] | undefined;
		const instantiationService = store.add(new TestInstantiationService());
		const storageService = store.add(new TestStorageService());
		const logService = new RecordingLogService();
		const registeredExtensions: readonly IExtensionDescription[] = [
			upcastPartial<IExtensionDescription>({
				identifier: new ExtensionIdentifier('foreign.extension')
			})
		];
		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(ITerminalLogService, logService);
		instantiationService.stub(IStorageService, storageService);
		instantiationService.stub(INativeWorkbenchEnvironmentService, upcastPartial<INativeWorkbenchEnvironmentService>({ appRoot: '/app', isBuilt: false, userDataPath: '/user-data' }));
		instantiationService.stub(IExtensionService, upcastPartial<IExtensionService>({
			whenInstalledExtensionsRegistered: async () => true,
			onDidChangeExtensions: Event.None,
			extensions: registeredExtensions
		}));
		instantiationService.stub(IConfigurationService, new TestConfigurationService({ terminal: { integrated: { disableClaudeCodeWheelAcceleration: true } } }));
		instantiationService.stub(IConfigurationResolverService, upcastPartial<IConfigurationResolverService>({
			resolveWithEnvironment: async (_environment, _folder, value) => value
		}));
		instantiationService.stub(IHistoryService, new TestHistoryService());
		instantiationService.stub(IProductService, upcastPartial<IProductService>({ version: 'test' }));
		instantiationService.stub(ITerminalProfileResolverService, upcastPartial<ITerminalProfileResolverService>({
			getEnvironment: async () => ({ PATH: '/base/bin', UNBROKEN_CODE_CLAUDE_WHEEL_ACCELERATION: 'inherited' })
		}));
		const environmentVariableService = store.add(instantiationService.createInstance(EnvironmentVariableService));
		const foreignCollection = {
			remoteAuthority: 'ssh-remote+foreign-host',
			map: new Map([
				['foreign-path', { variable: 'PATH', value: '/foreign/bin:', type: EnvironmentVariableMutatorType.Prepend }],
				['shared-value', { variable: 'SHARED_VALUE', value: 'available', type: EnvironmentVariableMutatorType.Replace }]
			])
		};
		environmentVariableService.set('foreign.extension', { ...foreignCollection, persistent: false });
		instantiationService.stub(IEnvironmentVariableService, environmentVariableService);
		instantiationService.stub(ILocalPtyService, upcastPartial<ILocalPtyService>({
			getRevivedPtyNewId: async () => undefined,
			onPtyHostExit: Event.None,
			onPtyHostStart: Event.None,
			onPtyHostUnresponsive: Event.None,
			onPtyHostResponsive: Event.None,
			onPtyHostRequestResolveVariables: Event.None,
			getEnvironment: async () => ({ PATH: '/base/bin', UNBROKEN_CODE_CLAUDE_WHEEL_ACCELERATION: 'inherited' }),
			reviveTerminalProcesses: async (_workspaceId, state) => {
				revivedState = state;
			},
			getTerminalLayoutInfo: async () => undefined
		}));

		const staleOptions: ISerializableEnvironmentVariableCollections = [[
			'foreign.extension',
			[['foreign-path', { variable: 'PATH', value: '/foreign/bin:', type: EnvironmentVariableMutatorType.Prepend }]],
			[]
		]];
		storageService.store(TerminalStorageKeys.TerminalBufferState, JSON.stringify({
			version: 1,
			state: [{
				id: 1,
				shellLaunchConfig: {},
				processLaunchConfig: {
					env: { PATH: '/stale/bin:/foreign/bin' },
					executableEnv: {},
					options: {
						shellIntegration: { enabled: false, suggestEnabled: false, nonce: '' },
						windowsUseConptyDll: false,
						environmentVariableCollections: staleOptions,
						isScreenReaderOptimized: false
					}
				}
			}]
		}), StorageScope.WORKSPACE, StorageTarget.MACHINE);

		const backend = store.add(instantiationService.createInstance(LocalTerminalBackend));
		await backend.getTerminalLayoutInfo();
		deepStrictEqual({
			revivedStateLength: revivedState?.length,
			warnings: logService.warnings
		}, {
			revivedStateLength: 1,
			warnings: []
		});
		if (!revivedState) {
			throw new Error('Expected persisted terminal state to be revived');
		}

		deepStrictEqual({
			env: {
				PATH: revivedState[0].processLaunchConfig.env.PATH,
				SHARED_VALUE: revivedState[0].processLaunchConfig.env.SHARED_VALUE,
				UNBROKEN_CODE_CLAUDE_WHEEL_ACCELERATION: revivedState[0].processLaunchConfig.env.UNBROKEN_CODE_CLAUDE_WHEEL_ACCELERATION
			},
			collections: revivedState[0].processLaunchConfig.options.environmentVariableCollections
		}, {
			// Development builds also add the wrappers for macOS and Linux only
			env: {
				PATH: isWindows ? `${join('/app', 'bin_compat')};/base/bin` : `${join('/app', 'bin_compat', 'posix')}:${join('/app', 'bin_compat')}:/base/bin`,
				SHARED_VALUE: 'available',
				// The Claude Code wrapper's setting, replacing an inherited value
				UNBROKEN_CODE_CLAUDE_WHEEL_ACCELERATION: 'off'
			},
			collections: [[
				'foreign.extension',
				[['shared-value', { variable: 'SHARED_VALUE', value: 'available', type: EnvironmentVariableMutatorType.Replace }]],
				[]
			]]
		});
	});
});
