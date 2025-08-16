/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IFontSmoothingService = createDecorator<IFontSmoothingService>('fontSmoothingService');

export interface IFontSmoothingService {
	readonly _serviceBrand: undefined;

	/**
	 * Check if font smoothing is currently enabled on the system
	 */
	isFontSmoothingEnabled(): Promise<boolean>;

	/**
	 * Disable font smoothing system-wide
	 */
	disableFontSmoothing(): Promise<boolean>;

	/**
	 * Enable font smoothing system-wide (restore to default)
	 */
	enableFontSmoothing(): Promise<boolean>;

	/**
	 * Check if the system supports font smoothing control
	 */
	isSupported(): boolean;
}
