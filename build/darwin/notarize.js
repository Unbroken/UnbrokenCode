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
function errorContains(error, patterns) {
    const stack = [error];
    const seen = new Set();
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
function isRetryableNotarizeError(error) {
    if (!error) {
        return false;
    }
    const retryableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENETDOWN', 'ENETUNREACH', 'ECONNABORTED', 'EPROTO']);
    const checkCode = (candidate) => {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }
        const code = candidate.code ?? candidate.errno;
        return typeof code === 'string' && retryableCodes.has(code);
    };
    if (checkCode(error) || checkCode(error?.cause)) {
        return true;
    }
    const statusCandidates = [error?.status, error?.statusCode, error?.response?.status];
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
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    const timeout = notarizeTimeout ? parseInt(notarizeTimeout, 10) : 3600000; // Default 1 hour
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const attemptStartTime = Date.now();
        const attemptLabel = `Attempt ${attempt}/${maxAttempts}`;
        if (attempt > 1) {
            console.log(`Retrying notarization (${attemptLabel})...`);
        }
        else {
            console.log(`Submitting notarization request (${attemptLabel})...`);
        }
        try {
            const notarizePromise = (0, notarize_1.notarize)(notarizeOptions);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Notarization timeout')), timeout);
            });
            await Promise.race([notarizePromise, timeoutPromise]);
            const elapsedTime = Date.now() - attemptStartTime;
            console.log(`Notarization completed successfully in ${Math.round(elapsedTime / 1000)} seconds`);
            await stapleApp(appPath);
            await verifyNotarization(appPath);
            return;
        }
        catch (error) {
            const elapsedTime = Date.now() - attemptStartTime;
            console.error(`Notarization failed after ${Math.round(elapsedTime / 1000)} seconds (${attemptLabel})`);
            console.error('Error details:', error);
            const shouldRetry = attempt < maxAttempts && isRetryableNotarizeError(error);
            if (!shouldRetry) {
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
            const delayMs = Math.min(30000 * Math.pow(2, attempt - 1), 180000);
            console.log(`Retryable notarization error detected. Waiting ${Math.round(delayMs / 1000)} seconds before retrying...`);
            await delay(delayMs);
        }
    }
}
if (require.main === module) {
    main(process.argv[2]).catch(err => {
        console.error('Notarization process failed:', err);
        process.exit(1);
    }).then(() => process.exit(0));
}
//# sourceMappingURL=notarize.js.map