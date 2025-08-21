/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { TerminalGroupService } from './terminalGroupService.js';

/**
 * Manages separate TerminalGroupService instances for each terminal view
 */
export class TerminalViewGroupService extends Disposable {
	private readonly _groupServices = new Map<string, TerminalGroupService>();

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
	}

	getGroupServiceForView(viewId: string): TerminalGroupService {
		let service = this._groupServices.get(viewId);
		if (!service) {
			// Create the service with proper DI - createInstance handles the decorator parameters
			// and we pass the extra parameter at the end
			service = this._instantiationService.invokeFunction(accessor => {
				return new TerminalGroupService(
					accessor.get(IContextKeyService),
					accessor.get(IInstantiationService),
					accessor.get(IViewsService),
					accessor.get(IViewDescriptorService),
					accessor.get(IQuickInputService),
					viewId
				);
			});
			this._groupServices.set(viewId, service);
			this._register(service);
		}
		return service;
	}

	getGroupServiceForTerminal(): TerminalGroupService {
		return this.getGroupServiceForView('terminal');
	}

	getGroupServiceForTerminal2(): TerminalGroupService {
		return this.getGroupServiceForView('terminal2');
	}

	getGroupServiceForTerminal3(): TerminalGroupService {
		return this.getGroupServiceForView('terminal3');
	}
}