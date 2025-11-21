/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ConfigurationOverrideManager } from './configurationOverrideManager.js';

// Contribution to initialize the manager on startup
class ConfigurationOverrideManagerContribution extends Disposable {
	static readonly ID = 'workbench.contrib.configurationOverrideManager';

	constructor(
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILifecycleService lifecycleService: ILifecycleService
	) {
		super();
		// Initialize the singleton manager immediately
		ConfigurationOverrideManager.getInstance(storageService, configurationService, lifecycleService);
	}
}

// Register the configuration override manager contribution (runs first to restore config)
registerWorkbenchContribution2(
	ConfigurationOverrideManagerContribution.ID,
	ConfigurationOverrideManagerContribution,
	WorkbenchPhase.BlockRestore
);
