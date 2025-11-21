/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { notarize, type NotarizeOptions } from '@electron/notarize';
import { spawn } from '@malept/cross-spawn-promise';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.dirname(path.dirname(__dirname));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

async function stapleApp(appPath: string): Promise<void> {
	console.log(`Stapling notarization ticket to ${appPath}`);
	await spawn('xcrun', ['stapler', 'staple', appPath]);
	console.log(`Successfully stapled ${appPath}`);
}

async function verifyNotarization(appPath: string): Promise<void> {
	console.log(`Verifying notarization of ${appPath}`);
	const result = await spawn('xcrun', ['stapler', 'validate', appPath]);
	console.log(`Notarization verification result:\n${result}`);
}

function errorContains(error: unknown, patterns: RegExp[]): boolean {
	const stack: unknown[] = [error];
	const seen = new Set<unknown>();

	while (stack.length) {
		const current = stack.pop();
		if (!current || seen.has(current)) {
			continue;
		}
		seen.add(current);

		if (typeof current === 'string') {
			if (patterns.some(pattern => pattern.test(current))) {
				return true;
			}
			continue;
		}

		if (current instanceof Error) {
			if (patterns.some(pattern => pattern.test(current.message))) {
				return true;
			}
			stack.push(current.cause);
		}

		if (typeof current === 'object') {
			for (const value of Object.values(current)) {
				stack.push(value);
			}
		}
	}

	return false;
}

function isRetryableNotarizeError(error: unknown): boolean {
	if (!error) {
		return false;
	}

	const retryableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENETDOWN', 'ENETUNREACH', 'ECONNABORTED', 'EPROTO']);
	const checkCode = (candidate: unknown): boolean => {
		if (!candidate || typeof candidate !== 'object') {
			return false;
		}
		const record = candidate as Record<string, unknown>;
		const code = record.code ?? record.errno;
		return typeof code === 'string' && retryableCodes.has(code);
	};

	const errorRecord = error as Record<string, unknown>;
	if (checkCode(error) || checkCode(errorRecord.cause)) {
		return true;
	}

	const responseRecord = errorRecord.response as Record<string, unknown> | undefined;
	const statusCandidates = [errorRecord.status, errorRecord.statusCode, responseRecord?.status];
	for (const status of statusCandidates) {
		if (typeof status === 'number' && (status === 408 || status >= 500)) {
			return true;
		}
	}

	if (errorContains(error, [/offline/i, /timed? ?out/i, /timeout/i, /temporarily unavailable/i, /network route/i])) {
		return true;
	}

	return false;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(buildDir?: string): Promise<void> {
	const arch = process.env['VSCODE_ARCH'];
	const keychainProfile = process.env['APPLE_KEYCHAIN_PROFILE'];
	const notarizeTimeout = process.env['VSCODE_NOTARIZE_TIMEOUT'];

	if (!buildDir) {
		throw new Error('$AGENT_BUILDDIRECTORY not set');
	}

	if (!keychainProfile) {
		throw new Error('$APPLE_KEYCHAIN_PROFILE not set');
	}

	const appRoot = path.join(buildDir, `VSCode-darwin-${arch}`);
	const appName = product.nameLong + '.app';
	const appPath = path.join(appRoot, appName);
	const appBundleId = product.darwinBundleIdentifier;

	if (!fs.existsSync(appPath)) {
		throw new Error(`Application not found at ${appPath}`);
	}

	console.log(`Starting notarization for ${appName} (${appBundleId})`);
	console.log(`Architecture: ${arch}`);
	console.log(`App path: ${appPath}`);
	console.log(`Using keychain profile: ${keychainProfile}`);

	const notarizeOptions: NotarizeOptions = {
		appPath,
		keychainProfile,
	};

	const timeout = notarizeTimeout ? parseInt(notarizeTimeout, 10) : 3600000; // Default 1 hour

	const maxAttempts = 3;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const attemptStartTime = Date.now();
		const attemptLabel = `Attempt ${attempt}/${maxAttempts}`;
		if (attempt > 1) {
			console.log(`Retrying notarization (${attemptLabel})...`);
		} else {
			console.log(`Submitting notarization request (${attemptLabel})...`);
		}

		try {
			const notarizePromise = notarize(notarizeOptions);
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error('Notarization timeout')), timeout);
			});

			await Promise.race([notarizePromise, timeoutPromise]);

			const elapsedTime = Date.now() - attemptStartTime;
			console.log(`Notarization completed successfully in ${Math.round(elapsedTime / 1000)} seconds`);

			await stapleApp(appPath);
			await verifyNotarization(appPath);
			return;
		} catch (error) {
			const elapsedTime = Date.now() - attemptStartTime;
			console.error(`Notarization failed after ${Math.round(elapsedTime / 1000)} seconds (${attemptLabel})`);
			console.error('Error details:', error);

			const shouldRetry = attempt < maxAttempts && isRetryableNotarizeError(error);
			if (!shouldRetry) {
				try {
					console.log('Checking notarization history...');
					const history = await spawn('xcrun', [
						'notarytool',
						'history',
						'--keychain-profile', keychainProfile
					]);
					console.log(`Recent notarization history:\n${history}`);
				} catch (historyError) {
					console.error('Failed to retrieve notarization history:', historyError);
				}

				throw error;
			}

			const delayMs = Math.min(30000 * Math.pow(2, attempt - 1), 180000);
			console.log(`Retryable notarization error detected. Waiting ${Math.round(delayMs / 1000)} seconds before retrying...`);
			await delay(delayMs);
		}
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv[2]).catch(err => {
		console.error('Notarization process failed:', err);
		process.exit(1);
	}).then(() => process.exit(0));
}
