/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { isMacintosh } from '../../../base/common/platform.js';
import { IFontSmoothingService } from '../common/fontSmoothingService.js';

export class FontSmoothingService implements IFontSmoothingService {
	declare readonly _serviceBrand: undefined;

	isSupported(): boolean {
		return isMacintosh;
	}

	async isFontSmoothingEnabled(): Promise<boolean> {
		if (!this.isSupported()) {
			return false;
		}

		return new Promise((resolve) => {
			const process = spawn('defaults', ['-currentHost', 'read', '-g', 'AppleFontSmoothing'], {
				stdio: ['ignore', 'pipe', 'pipe'] // Capture both stdout and stderr
			});

			let output = '';
			let combinedOutput = '';

			process.stdout.on('data', (data) => {
				const stringData = data.toString();
				output += stringData;
				combinedOutput += stringData;
			});

			process.stderr.on('data', (data) => {
				combinedOutput += data.toString();
			});

			process.on('close', (code) => {
				if (code === 0) {
					resolve(output.trim() !== '0');
				} else {
					if (!combinedOutput.trim().endsWith('does not exist')) {
						console.log('[FontSmoothingService] defaults read failed, assuming font smoothing is enabled: ', output, combinedOutput);
					}
					resolve(true);
				}
			});

			process.on('error', (error) => {
				console.error('[FontSmoothingService] Failed to spawn process:', error);
				resolve(false);
			});
		});
	}

	async disableFontSmoothing(): Promise<boolean> {
		if (!this.isSupported()) {
			return false;
		}

		return new Promise((resolve) => {
			const process = spawn('defaults', ['-currentHost', 'write', '-g', 'AppleFontSmoothing', '-int', '0'], {
				stdio: ['ignore', 'pipe', 'pipe'] // Capture both stdout and stderr
			});

			let output = '';

			process.stdout?.on('data', (data) => {
				output += data.toString();
			});

			process.stderr?.on('data', (data) => {
				output += data.toString();
			});

			process.on('close', (code) => {
				if (code !== 0) {
					console.log('[FontSmoothingService] defaults write exited with error code:', code, output);
				}
				resolve(code === 0);
			});

			process.on('error', (error) => {
				console.error('[FontSmoothingService] Failed to spawn process for disabling:', error);
				resolve(false);
			});
		});
	}

	async enableFontSmoothing(): Promise<boolean> {
		if (!this.isSupported()) {
			return false;
		}

		return new Promise((resolve) => {
			// Delete the AppleFontSmoothing key to restore macOS default (enabled)
			const process = spawn('defaults', ['-currentHost', 'delete', '-g', 'AppleFontSmoothing'], {
				stdio: ['ignore', 'pipe', 'pipe'] // Capture both stdout and stderr
			});

			let output = '';

			process.stdout?.on('data', (data) => {
				output += data.toString();
			});

			process.stderr?.on('data', (data) => {
				output += data.toString();
			});

			process.on('close', (code) => {
				if (code !== 0) {
					console.log('[FontSmoothingService] defaults delete exited with error code:', code, output);
				}
				// Code 0 means success, but even if it fails (e.g., key doesn't exist), 
				// that's actually fine since the default behavior is enabled
				resolve(true);
			});

			process.on('error', (error) => {
				console.error('[FontSmoothingService] Failed to spawn process for enabling:', error);
				resolve(false);
			});
		});
	}
}
