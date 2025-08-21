/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IDefaultTerminalGroupService, ITerminalGroupServices } from './terminal.js';

export function setupTerminalCommands(): void {
	registerOpenTerminalAtIndexCommands();
}

function registerOpenTerminalAtIndexCommands(): void {
	for (let i = 0; i < 9; i++) {
		const terminalIndex = i;
		const visibleIndex = i + 1;

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: `workbench.action.terminal.focusAtIndex${visibleIndex}`,
			weight: KeybindingWeight.WorkbenchContrib,
			when: undefined,
			primary: 0,
			handler: accessor => {
				const groupServices = accessor.get(ITerminalGroupServices);
				const terminlGroupService = groupServices.lastSelectedGroupService ?? accessor.get(IDefaultTerminalGroupService);

				terminlGroupService.setActiveInstanceByIndex(terminalIndex);
				return terminlGroupService.showPanel(true);
			}
		});
	}
}

