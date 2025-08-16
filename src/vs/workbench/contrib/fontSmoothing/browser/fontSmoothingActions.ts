/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFontSmoothingService } from '../../../../platform/fontSmoothing/common/fontSmoothingService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { showRestartNotification } from './fontSmoothingUtils.js';

export class DisableFontSmoothingAction extends Action2 {
	constructor() {
		super({
			id: 'fontSmoothing.disable',
			title: localize2('fontSmoothing.disable', 'Disable Font Smoothing'),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fontSmoothingService = accessor.get(IFontSmoothingService);
		const notificationService = accessor.get(INotificationService);
		const nativeHostService = accessor.get(INativeHostService);

		if (!fontSmoothingService.isSupported()) {
			notificationService.info(localize('fontSmoothing.notSupported', 'Font smoothing control is only supported on macOS.'));
			return;
		}

		try {
			const success = await fontSmoothingService.disableFontSmoothing();
			if (success) {
				showRestartNotification(
					notificationService,
					nativeHostService,
					localize('fontSmoothing.disabledWithRestart', 'Font smoothing has been disabled. Restart the application to apply the changes.')
				);
			} else {
				notificationService.error(localize('fontSmoothing.disableFailed', 'Failed to disable font smoothing. You can manually disable it using: defaults -currentHost write -g AppleFontSmoothing -int 0'));
			}
		} catch (error) {
			notificationService.error(localize('fontSmoothing.disableError', 'An error occurred while disabling font smoothing: {0}', String(error)));
		}
	}
}

export class EnableFontSmoothingAction extends Action2 {
	constructor() {
		super({
			id: 'fontSmoothing.enable',
			title: localize2('fontSmoothing.enable', 'Enable Font Smoothing'),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fontSmoothingService = accessor.get(IFontSmoothingService);
		const notificationService = accessor.get(INotificationService);
		const nativeHostService = accessor.get(INativeHostService);

		if (!fontSmoothingService.isSupported()) {
			notificationService.info(localize('fontSmoothing.notSupported', 'Font smoothing control is only supported on macOS.'));
			return;
		}

		try {
			const success = await fontSmoothingService.enableFontSmoothing();
			if (success) {
				showRestartNotification(
					notificationService,
					nativeHostService,
					localize('fontSmoothing.enabledWithRestart', 'Font smoothing has been enabled. Restart the application to apply the changes.')
				);
			} else {
				notificationService.error(localize('fontSmoothing.enableFailed', 'Failed to enable font smoothing. You can manually enable it using: defaults -currentHost delete -g AppleFontSmoothing'));
			}
		} catch (error) {
			notificationService.error(localize('fontSmoothing.enableError', 'An error occurred while enabling font smoothing: {0}', String(error)));
		}
	}
}

export class ResetFontSmoothingWarningAction extends Action2 {
	constructor() {
		super({
			id: 'fontSmoothing.resetWarning',
			title: localize2('fontSmoothing.resetWarning', 'Reset Font Smoothing Warning'),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		const notificationService = accessor.get(INotificationService);

		// Remove the dismissed flag
		storageService.remove('fontSmoothing.warningDismissed', StorageScope.PROFILE);

		notificationService.info(localize('fontSmoothing.warningReset', 'Font smoothing warning has been reset. It will show again on next startup if font smoothing is enabled.'));
	}
}

export class RestartApplicationAction extends Action2 {
	constructor() {
		super({
			id: 'application.restart',
			title: localize2('application.restart', 'Restart Application'),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		await nativeHostService.relaunch();
	}
}

registerAction2(DisableFontSmoothingAction);
registerAction2(EnableFontSmoothingAction);
registerAction2(ResetFontSmoothingWarningAction);
registerAction2(RestartApplicationAction);
