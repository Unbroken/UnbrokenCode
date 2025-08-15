/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { notarize, NotarizeOptions } from '@electron/notarize';
import { spawn } from '@malept/cross-spawn-promise';

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

	const startTime = Date.now();
	const timeout = notarizeTimeout ? parseInt(notarizeTimeout, 10) : 3600000; // Default 1 hour

	try {
		const notarizePromise = notarize(notarizeOptions);
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error('Notarization timeout')), timeout);
		});

		await Promise.race([notarizePromise, timeoutPromise]);

		const elapsedTime = Date.now() - startTime;
		console.log(`Notarization completed successfully in ${Math.round(elapsedTime / 1000)} seconds`);

		// Staple the notarization ticket to the app
		await stapleApp(appPath);

		// Verify the notarization
		await verifyNotarization(appPath);

	} catch (error) {
		const elapsedTime = Date.now() - startTime;
		console.error(`Notarization failed after ${Math.round(elapsedTime / 1000)} seconds`);

		// Log additional debugging information
		console.error('Error details:', error);

		// Check notarization history for more details
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
}

if (require.main === module) {
	main(process.argv[2]).catch(err => {
		console.error('Notarization process failed:', err);
		process.exit(1);
	}).then(() => process.exit(0));
}
