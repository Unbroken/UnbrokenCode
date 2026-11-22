/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IUpdate, IUpdateService, State } from '../../../../platform/update/common/update.js';
import { UpdateChannelClient } from '../../../../platform/update/common/updateIpc.js';
import { tryParseVersion } from '../common/updateUtils.js';

interface ISimulatedStateItem extends IQuickPickItem {
	readonly state: ((update: IUpdate) => State) | undefined;
}

/**
 * Sets the state of the update service of the window, which the update UI follows, when it's the
 * client of the update service in the main process, which lets the state be set. The service is
 * behind a proxy that forwards setting the state to it, so the type of the client can't be checked.
 */
function setState(updateService: IUpdateService, state: State): boolean {
	try {
		(updateService as Pick<UpdateChannelClient, 'state'>).state = state;
	} catch {
		return false;
	}
	return updateService.state === state;
}

const SIMULATED_DOWNLOAD_SIZE = 150 * 1024 * 1024;

/** The state of the update service before the simulation started, to go back to when it stops. */
let stateBeforeSimulation: State | undefined;
let lastSimulatedVersion: string | undefined;

/**
 * Shows the update UI as it is in each state of an update, such as the update indicator in the title
 * bar, its tooltip, the Manage menu and the release notes of the update, without an update. Builds
 * from sources can't update, and the actions of the update UI do nothing while simulating, since the
 * update service in the main process has no update. Only builds from sources simulate updates.
 */
class SimulateUpdateAction extends Action2 {
	constructor() {
		super({
			id: '_update.simulateUpdate',
			title: localize2('simulateUpdate', "Simulate Update..."),
			category: Categories.Developer,
			f1: true,
			// The update UI's actions use the real update service, so built products, which can have
			// a real update, don't simulate one
			precondition: IsDevelopmentContext,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const updateService = accessor.get(IUpdateService);
		const quickInputService = accessor.get(IQuickInputService);
		const productService = accessor.get(IProductService);
		const notificationService = accessor.get(INotificationService);

		// The precondition doesn't stop running the command directly, or in an extension development
		// host of a built product
		if (accessor.get(IEnvironmentService).isBuilt) {
			notificationService.warn(localize('simulateUpdate.builtProduct', "Updates can only be simulated in builds from sources."));
			return;
		}

		const now = Date.now();
		const items: ISimulatedStateItem[] = [
			{ label: localize('simulateUpdate.checking', "Checking for Updates"), state: () => State.CheckingForUpdates(true) },
			{ label: localize('simulateUpdate.available', "Available for Download"), state: update => State.AvailableForDownload(update, true) },
			{ label: localize('simulateUpdate.downloading', "Downloading"), description: localize('simulateUpdate.downloadingProgress', "40%"), state: update => State.Downloading(update, true, false, SIMULATED_DOWNLOAD_SIZE * 0.4, SIMULATED_DOWNLOAD_SIZE, now - 10_000) },
			{ label: localize('simulateUpdate.downloaded', "Downloaded"), state: update => State.Downloaded(update, true, false) },
			{ label: localize('simulateUpdate.updating', "Installing"), description: localize('simulateUpdate.updatingProgress', "60%"), state: update => State.Updating(update, true, 60, 100) },
			{ label: localize('simulateUpdate.ready', "Ready to Restart"), state: update => State.Ready(update, true, false) },
			{ label: localize('simulateUpdate.stop', "Stop Simulating"), state: undefined },
		];
		const item = await quickInputService.pick(items, { placeHolder: localize('simulateUpdate.pickState', "Select the state of the update to show") });
		if (!item) {
			return;
		}

		if (!item.state) {
			if (stateBeforeSimulation) {
				setState(updateService, stateBeforeSimulation);
				stateBeforeSimulation = undefined;
			}
			return;
		}

		const current = tryParseVersion(productService.version);
		const version = await quickInputService.input({
			prompt: localize('simulateUpdate.version', "The version of the update, which its release notes are shown for"),
			value: lastSimulatedVersion ?? (current ? `${current.major}.${current.minor}.${current.patch + 1}` : productService.version),
			validateInput: async value => tryParseVersion(value) ? undefined : localize('simulateUpdate.invalidVersion', "Enter a version like 1.2.3"),
		});
		if (!version) {
			return;
		}
		lastSimulatedVersion = version;

		const stateBefore = updateService.state;
		// Without a commit, which the update UI leaves out when it shows the version
		if (setState(updateService, item.state({ version: '', productVersion: version, timestamp: now }))) {
			stateBeforeSimulation ??= stateBefore;
		} else {
			notificationService.warn(localize('simulateUpdate.unsupported', "Updates can't be simulated in this window."));
		}
	}
}

registerAction2(SimulateUpdateAction);
