/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFontSmoothingService } from '../common/fontSmoothingService.js';

export class FontSmoothingService implements IFontSmoothingService {
	declare readonly _serviceBrand: undefined;

	isSupported(): boolean {
		// Browser/renderer process cannot directly access system preferences
		return false;
	}

	async isFontSmoothingEnabled(): Promise<boolean> {
		return false;
	}

	async disableFontSmoothing(): Promise<boolean> {
		return false;
	}

	async enableFontSmoothing(): Promise<boolean> {
		return false;
	}
}
