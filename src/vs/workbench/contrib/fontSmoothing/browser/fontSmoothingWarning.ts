/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IFontSmoothingService } from '../../../../platform/fontSmoothing/common/fontSmoothingService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { Action } from '../../../../base/common/actions.js';
import { showRestartNotification } from './fontSmoothingUtils.js';

const FONT_SMOOTHING_WARNING_DISMISSED_KEY = 'fontSmoothing.warningDismissed';

export class FontSmoothingWarningContribution {
	static readonly ID = 'workbench.contrib.fontSmoothingWarning';

	constructor(
		@IFontSmoothingService private readonly fontSmoothingService: IFontSmoothingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@INativeHostService private readonly nativeHostService: INativeHostService
	) {
		this.checkFontSmoothingStatus();
	}

	private async checkFontSmoothingStatus(): Promise<void> {
		// Only check on macOS and if warning hasn't been dismissed
		if (!this.fontSmoothingService.isSupported()) {
			return;
		}

		const warningDismissed = this.storageService.getBoolean(FONT_SMOOTHING_WARNING_DISMISSED_KEY, StorageScope.PROFILE, false);
		if (warningDismissed) {
			return;
		}

		try {
			const fontSmoothingEnabled = await this.fontSmoothingService.isFontSmoothingEnabled();
			if (fontSmoothingEnabled) {
				this.showFontSmoothingWarning();
			}
		} catch (error) {
			// Silently ignore errors in detection
		}
	}

	private showFontSmoothingWarning(): void {
		const message = localize('fontSmoothingWarning.message', 'Font smoothing is enabled, which may make text appear blurry. For the best experience with Unbroken Code\'s crisp font rendering, consider disabling it.');

		const disableFontSmoothingAction = new Action(
			'fontSmoothing.disable',
			localize('fontSmoothingWarning.disable', 'Disable Font Smoothing'),
			undefined,
			true,
			async () => {
				const success = await this.fontSmoothingService.disableFontSmoothing();
				if (success) {
					showRestartNotification(
						this.notificationService,
						this.nativeHostService,
						localize('fontSmoothingWarning.restartMessage', 'Font smoothing has been disabled. Restart the application to apply the changes.')
					);
				} else {
					this.notificationService.error(localize('fontSmoothingWarning.disableFailed', 'Failed to disable font smoothing. You can manually disable it using: defaults -currentHost write -g AppleFontSmoothing -int 0'));
				}
			}
		);

		const dontShowAgainAction = new Action(
			'fontSmoothing.dontShowAgain',
			localize('fontSmoothingWarning.dontShowAgain', "Don't Show Again"),
			undefined,
			true,
			async () => {
				this.storageService.store(FONT_SMOOTHING_WARNING_DISMISSED_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
			}
		);

		this.notificationService.notify({
			severity: Severity.Info,
			message,
			actions: {
				primary: [disableFontSmoothingAction, dontShowAgainAction]
			}
		});
	}
}
