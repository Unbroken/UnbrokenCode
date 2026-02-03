/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Postinstall patch for @vscode/gulp-electron to support:
// 1. Unversioned asset names (e.g. `electron-win32-x64.zip` instead of
//    `electron-v39.2.7-win32-x64.zip`)
// 2. Optional auth token (public repos don't need a GITHUB_TOKEN)
// 3. Retry transient GitHub API and fetch transport failures

const fs = require('fs');
const path = require('path');

const downloadPath = path.join(
	__dirname, '..', '..', 'node_modules', '@vscode', 'gulp-electron', 'src', 'download.js'
);

if (!fs.existsSync(downloadPath)) {
	console.log('[gulp-electron-patch] Skipping patch: download.js not found');
	process.exit(0);
}

let content = fs.readFileSync(downloadPath, 'utf8');

// --- Patch 1: Try unversioned asset names as fallback ---

// The template strings below must use spaces (not tabs) to match the
// original indentation style inside download.js.
const assetOriginal =
	'const targetName = artifactSuffix ?\n' +
	'    `${artifactName}-${releaseVersion}-${platform}-${arch}-${artifactSuffix}.zip` :\n' +
	'    `${artifactName}-${releaseVersion}-${platform}-${arch}.zip`;\n' +
	'  const asset = assets.find((asset) => {\n' +
	'    return asset.name === targetName;\n' +
	'  });';

const assetReplacement =
	'// [patched] fallback to unversioned asset name\n' +
	'  const targetName = artifactSuffix ?\n' +
	'    `${artifactName}-${releaseVersion}-${platform}-${arch}-${artifactSuffix}.zip` :\n' +
	'    `${artifactName}-${releaseVersion}-${platform}-${arch}.zip`;\n' +
	'  const unversionedTargetName = artifactSuffix ?\n' +
	'    `${artifactName}-${platform}-${arch}-${artifactSuffix}.zip` :\n' +
	'    `${artifactName}-${platform}-${arch}.zip`;\n' +
	'  const asset = assets.find((asset) => {\n' +
	'    return asset.name === targetName;\n' +
	'  }) || assets.find((asset) => {\n' +
	'    return asset.name === unversionedTargetName;\n' +
	'  });';

if (!content.includes('// [patched] fallback to unversioned asset name') && !content.includes(assetOriginal)) {
	console.warn('[gulp-electron-patch] WARNING: Could not find asset name pattern in download.js -- patch may need updating');
	process.exit(0);
}

if (!content.includes('// [patched] fallback to unversioned asset name')) {
	content = content.replace(assetOriginal, assetReplacement);
}

// --- Patch 2: Make authorization header conditional on token ---

const authOriginal = '  headers.authorization = `token ${token}`;';
const authReplacement = '  if (token) { headers.authorization = `token ${token}`; }';

if (content.includes(authOriginal)) {
	content = content.replace(authOriginal, authReplacement);
} else if (!content.includes(authReplacement)) {
	console.warn('[gulp-electron-patch] WARNING: Could not find auth header pattern -- skipping auth patch');
}

// --- Patch 3: Extend the existing bounded retry loop's error filter ---
// Octokit wraps fetch failures (including "other side closed") as status 500.
// Fetch/Undici can also expose transport failures through nested causes.
const retryMarker = '// [patched] retry transient GitHub and fetch errors';
if (!content.includes(retryMarker)) {
	const retryOriginal = 'function isTransientNetworkError(err) {\n';
	const retryReplacement = retryOriginal +
		'  ' + retryMarker + '\n' +
		'  if (err && (err.status === 408 || err.status === 429 || (err.status >= 500 && err.status <= 599))) {\n' +
		'    return true;\n' +
		'  }\n' +
		'  if (err && ["UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(err.code)) {\n' +
		'    return true;\n' +
		'  }\n' +
		'  if (err && err.cause && isTransientNetworkError(err.cause)) {\n' +
		'    return true;\n' +
		'  }\n';
	if (!content.includes(retryOriginal)) {
		throw new Error('[gulp-electron-patch] Retry filter not found in download.js -- update the patch');
	}
	content = content.replace(retryOriginal, retryReplacement);
}

fs.writeFileSync(downloadPath, content, 'utf8');
console.log('[gulp-electron-patch] Patched download.js successfully');
