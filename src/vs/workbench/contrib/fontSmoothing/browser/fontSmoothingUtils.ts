/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Action } from '../../../../base/common/actions.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';

/**
 * Shared function to show restart notification with action buttons
 */
export function showRestartNotification(notificationService: INotificationService, nativeHostService: INativeHostService, message: string): void {
	const restartAction = new Action(
		'fontSmoothing.restartNow',
		localize('fontSmoothing.restartNow', 'Restart Now'),
		undefined,
		true,
		async () => {
			await nativeHostService.relaunch();
		}
	);

	const laterAction = new Action(
		'fontSmoothing.restartLater',
		localize('fontSmoothing.restartLater', 'Later'),
		undefined,
		true,
		() => Promise.resolve()
	);

	notificationService.notify({
		severity: Severity.Info,
		message,
		actions: {
			primary: [restartAction, laterAction]
		}
	});
}