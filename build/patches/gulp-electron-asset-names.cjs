/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Postinstall patch for @vscode/gulp-electron to support:
// 1. Unversioned asset names (e.g. `electron-win32-x64.zip` instead of
//    `electron-v39.2.7-win32-x64.zip`)
// 2. Optional auth token (public repos don't need a GITHUB_TOKEN)

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

// Only patch once -- check for our marker comment
if (content.includes('// [patched] fallback to unversioned asset name')) {
	console.log('[gulp-electron-patch] Already patched, skipping');
	process.exit(0);
}

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

if (!content.includes(assetOriginal)) {
	console.warn('[gulp-electron-patch] WARNING: Could not find asset name pattern in download.js -- patch may need updating');
	process.exit(0);
}

content = content.replace(assetOriginal, assetReplacement);

// --- Patch 2: Make authorization header conditional on token ---

const authOriginal = '  headers.authorization = `token ${token}`;';
const authReplacement = '  if (token) { headers.authorization = `token ${token}`; }';

if (content.includes(authOriginal)) {
	content = content.replace(authOriginal, authReplacement);
} else {
	console.warn('[gulp-electron-patch] WARNING: Could not find auth header pattern -- skipping auth patch');
}

fs.writeFileSync(downloadPath, content, 'utf8');
console.log('[gulp-electron-patch] Patched download.js successfully');
