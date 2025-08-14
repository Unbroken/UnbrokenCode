/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import { Action2 } from '../../../platform/actions/common/actions.js';
import { ILocalizedString } from '../../../platform/action/common/action.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../platform/native/common/native.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { isCancellationError } from '../../../base/common/errors.js';

const shellCommandCategory: ILocalizedString = localize2('shellCommand', 'Shell Command');

export class InstallShellScriptAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.installCommandLine',
			title: localize2('install', "Install 'code' command in PATH"),
			category: shellCommandCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		const dialogService = accessor.get(IDialogService);

		try {
			await nativeHostService.installShellCommand();

			dialogService.info(localize('successIn', "Shell command 'code' successfully installed in PATH."));
		} catch (error) {
			if (isCancellationError(error)) {
				return;
			}

			dialogService.error(toErrorMessage(error));
		}
	}
}

export class UninstallShellScriptAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.uninstallCommandLine',
			title: localize2('uninstall', "Uninstall 'code' command from PATH"),
			category: shellCommandCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		const dialogService = accessor.get(IDialogService);

		try {
			await nativeHostService.uninstallShellCommand();

			dialogService.info(localize('successFrom', "Shell command 'code' successfully uninstalled from PATH."));
		} catch (error) {
			if (isCancellationError(error)) {
				return;
			}

			dialogService.error(toErrorMessage(error));
		}
	}
}
