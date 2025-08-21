/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalGroupServices, ITerminalGroupService } from './terminal.js';

export class TerminalGroupServices implements ITerminalGroupServices {
	lastSelectedGroupService: ITerminalGroupService | undefined;
	terminalGroupServices: ITerminalGroupService[] = [];

	constructor() {
	}
}
