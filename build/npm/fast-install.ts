/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from 'child_process';
import * as fs from 'fs';
import path from 'path';
import { ensureElectronTypes } from './electronTypes.ts';
import { root, isUpToDate, forceInstallMessage, readSavedState, computeState } from './installStateHash.ts';
import { getLocalPackageFiles, getLocalPackages } from './localPackages.ts';
import { finishCloudSandbox } from './cloudSandbox.ts';

if (!process.argv.includes('--force') && isUpToDate()) {
	// Mirror postinstall.ts, which restores the
	// Electron typings even when dependencies are
	// up to date.
	await ensureElectronTypes();
	finishCloudSandbox();

	console.log(`\x1b[32mAll dependencies up to date.\x1b[0m ${forceInstallMessage}`);
	process.exit(0);
}

// npm only copies a local package into node_modules when it is missing there, whatever changed in
// it since, so remove the copies of those that changed to have npm copy and build them again
const savedFileHashes = readSavedState()?.fileHashes ?? {};
const currentFileHashes = computeState().fileHashes;
for (const localPackage of getLocalPackages(root)) {
	const dir = path.relative(root, path.join(root, localPackage.dir)); // as the state names files
	const files = getLocalPackageFiles(root, localPackage).map(file => path.relative(root, path.join(root, file)));
	const savedFiles = Object.keys(savedFileHashes).filter(file => file === dir || file.startsWith(dir + path.sep));
	const changed = files.length !== savedFiles.length || files.some(file => savedFileHashes[file] !== currentFileHashes[file]);
	if (changed || process.argv.includes('--force')) {
		fs.rmSync(path.join(root, 'node_modules', localPackage.name), { recursive: true, force: true });
	}
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = child_process.spawnSync(npm, ['install'], {
	cwd: root,
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, VSCODE_FORCE_INSTALL: '1' },
});

process.exit(result.status ?? 1);
