/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { IFontSmoothingService } from '../../../../platform/fontSmoothing/common/fontSmoothingService.js';

registerMainProcessRemoteService(IFontSmoothingService, 'fontSmoothing');