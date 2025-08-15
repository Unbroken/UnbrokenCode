"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const notarize_1 = require("@electron/notarize");
const cross_spawn_promise_1 = require("@malept/cross-spawn-promise");
const root = path_1.default.dirname(path_1.default.dirname(__dirname));
const product = JSON.parse(fs_1.default.readFileSync(path_1.default.join(root, 'product.json'), 'utf8'));
async function stapleApp(appPath) {
    console.log(`Stapling notarization ticket to ${appPath}`);
    await (0, cross_spawn_promise_1.spawn)('xcrun', ['stapler', 'staple', appPath]);
    console.log(`Successfully stapled ${appPath}`);
}
async function verifyNotarization(appPath) {
    console.log(`Verifying notarization of ${appPath}`);
    const result = await (0, cross_spawn_promise_1.spawn)('xcrun', ['stapler', 'validate', appPath]);
    console.log(`Notarization verification result:\n${result}`);
}
async function main(buildDir) {
    const arch = process.env['VSCODE_ARCH'];
    const keychainProfile = process.env['APPLE_KEYCHAIN_PROFILE'];
    const notarizeTimeout = process.env['VSCODE_NOTARIZE_TIMEOUT'];
    if (!buildDir) {
        throw new Error('$AGENT_BUILDDIRECTORY not set');
    }
    if (!keychainProfile) {
        throw new Error('$APPLE_KEYCHAIN_PROFILE not set');
    }
    const appRoot = path_1.default.join(buildDir, `VSCode-darwin-${arch}`);
    const appName = product.nameLong + '.app';
    const appPath = path_1.default.join(appRoot, appName);
    const appBundleId = product.darwinBundleIdentifier;
    if (!fs_1.default.existsSync(appPath)) {
        throw new Error(`Application not found at ${appPath}`);
    }
    console.log(`Starting notarization for ${appName} (${appBundleId})`);
    console.log(`Architecture: ${arch}`);
    console.log(`App path: ${appPath}`);
    console.log(`Using keychain profile: ${keychainProfile}`);
    const notarizeOptions = {
        appPath,
        keychainProfile,
    };
    const startTime = Date.now();
    const timeout = notarizeTimeout ? parseInt(notarizeTimeout, 10) : 3600000; // Default 1 hour
    try {
        const notarizePromise = (0, notarize_1.notarize)(notarizeOptions);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Notarization timeout')), timeout);
        });
        await Promise.race([notarizePromise, timeoutPromise]);
        const elapsedTime = Date.now() - startTime;
        console.log(`Notarization completed successfully in ${Math.round(elapsedTime / 1000)} seconds`);
        // Staple the notarization ticket to the app
        await stapleApp(appPath);
        // Verify the notarization
        await verifyNotarization(appPath);
    }
    catch (error) {
        const elapsedTime = Date.now() - startTime;
        console.error(`Notarization failed after ${Math.round(elapsedTime / 1000)} seconds`);
        // Log additional debugging information
        console.error('Error details:', error);
        // Check notarization history for more details
        try {
            console.log('Checking notarization history...');
            const history = await (0, cross_spawn_promise_1.spawn)('xcrun', [
                'notarytool',
                'history',
                '--keychain-profile', keychainProfile
            ]);
            console.log(`Recent notarization history:\n${history}`);
        }
        catch (historyError) {
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
//# sourceMappingURL=notarize.js.map