/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, type IDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService, NeverShowAgainScope, Severity } from '../../../../../platform/notification/common/notification.js';
import { registerWorkbenchContribution2, WorkbenchPhase, type IWorkbenchContribution } from '../../../../common/contributions.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';

export class TerminalClaudeBellRecommendationContribution extends Disposable implements IWorkbenchContribution {
	static ID = 'terminalClaudeBellRecommendation';

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@IFileService fileService: IFileService,
		@INotificationService notificationService: INotificationService,
		@ITerminalService terminalService: ITerminalService,
	) {
		super();

		let listener: IDisposable | undefined = terminalService.onDidCreateInstance(async instance => {
			if (instance.shellLaunchConfig.name !== 'Claude Code') {
				return;
			}

			// Only show once per session
			listener?.dispose();
			listener = undefined;

			try {
				const claudeConfigUri = environmentService.userHome.with({
					path: environmentService.userHome.path + '/.claude.json'
				});
				const content = await fileService.readFile(claudeConfigUri);
				const config = JSON.parse(content.value.toString());
				if (config.preferredNotifChannel === 'terminal_bell') {
					return;
				}
			} catch {
				// File doesn't exist or can't be parsed - show the warning
			}

			notificationService.prompt(
				Severity.Warning,
				localize('claudeBellNotification.title', "Claude Code is not configured to use terminal bell notifications. Run `/config` in Claude Code and set Notifications to \"Terminal Bell\" to receive desktop notifications when Claude needs your attention."),
				[],
				{
					neverShowAgain: { id: 'terminal/claudeBellRecommendationIgnore', scope: NeverShowAgainScope.APPLICATION },
				}
			);
		});
	}
}

registerWorkbenchContribution2(TerminalClaudeBellRecommendationContribution.ID, TerminalClaudeBellRecommendationContribution, WorkbenchPhase.Eventually);
