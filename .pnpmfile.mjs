/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Native modules of this install root are built for Electron, as the `nativeBuild` field of
// package.json says. `pnpmfile` in pnpm-workspace.yaml selects this file. pnpm only loads
// JavaScript pnpmfiles; the hooks are in TypeScript. They pass that field as npm_config_* variables
// to every dependency install script, and pass the frozen lockfile of `pnpm ci` on to the separate
// install roots. See build/npm/pnpm/nativeBuildEnv.ts.
import { createNativeBuildHooks } from './build/npm/pnpm/nativeBuildEnv.ts';

const nativeBuildHooks = createNativeBuildHooks(import.meta.dirname, { exportFrozenLockfileOfCi: true });

export const hooks = {
	...nativeBuildHooks,
	// The xterm.js packages are tarballs that every machine builds from the packages/xterm.js
	// submodule (see setup.sh), so their integrity differs between machines. Leaving it out of the
	// lockfile keeps `pnpm install --frozen-lockfile` working with any build of the same commit.
	afterAllResolved(lockfile) {
		for (const snapshot of Object.values(lockfile.packages ?? {})) {
			if (snapshot.resolution?.tarball?.startsWith('file:packages/xterm.js/')) {
				delete snapshot.resolution.integrity;
			}
		}
		return lockfile;
	},
};
