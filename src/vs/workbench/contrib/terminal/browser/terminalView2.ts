/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalViewPane, ITerminalViewPaneOptions } from './terminalView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { ITerminalService, ITerminalConfigurationService, ITerminalGroupService, ITerminalInstanceService } from './terminal.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { ITerminalProfileService, ITerminalProfileResolverService } from '../common/terminal.js';
import { TerminalGroupService } from './terminalGroupService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

/**
 * Terminal 2 View Pane with its own independent group service
 */
export class TerminalView2Pane extends TerminalViewPane {
	constructor(
		options: ITerminalViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITerminalService terminalService: ITerminalService,
		@ITerminalConfigurationService terminalConfigurationService: ITerminalConfigurationService,
		@ITerminalGroupService defaultTerminalGroupService: ITerminalGroupService, // Only used as fallback
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@INotificationService notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@IMenuService menuService: IMenuService,
		@ITerminalProfileService terminalProfileService: ITerminalProfileService,
		@ITerminalProfileResolverService terminalProfileResolverService: ITerminalProfileResolverService,
		@ITerminalInstanceService terminalInstanceService: ITerminalInstanceService,
		@IViewsService viewsService: IViewsService,
		@IQuickInputService quickInputService: IQuickInputService,
	) {
		// Create a local group service for this view
		// Pass the services first, then the terminalViewId at the end
		const localGroupService = new TerminalGroupService(
			contextKeyService,
			instantiationService,
			viewsService,
			viewDescriptorService,
			quickInputService,
			options.id
		);
		
		// Add the local group service to options
		const terminalOptions: ITerminalViewPaneOptions = {
			...options,
			terminalGroupService: localGroupService
		};
		
		// Call parent constructor with the enhanced options
		super(
			terminalOptions,
			keybindingService,
			contextKeyService,
			viewDescriptorService,
			configurationService,
			contextMenuService,
			instantiationService,
			terminalService,
			terminalConfigurationService,
			defaultTerminalGroupService, // Pass as fallback, but will be overridden by options
			themeService,
			hoverService,
			notificationService,
			keybindingService,
			openerService,
			menuService,
			terminalProfileService,
			terminalProfileResolverService,
			terminalInstanceService
		);
		
		this._register(localGroupService);
	}
}