/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

// Defaults of the settings of extensions Unbroken Code ships that differ from the extensions' own defaults, which are
// the defaults in VS Code. Prefer changing an extension's default when it's right in both editors.

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		// Unbroken Code merges the Malterlib extension's semantic tokens with clangd's, while in VS Code they replace them
		'malterlib.enableSemanticColoring': true,
	},
}]);
