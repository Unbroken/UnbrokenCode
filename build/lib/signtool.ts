/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import cp from 'child_process';
import fs from 'fs';
import path from 'path';

let cachedSigntoolPath: string | null | undefined;

/**
 * Resolves signtool.exe from PATH or the newest installed Windows SDK.
 * Azure Pipelines agents expose signtool on PATH, but GitHub-hosted runners
 * only ship it inside the Windows Kits install.
 */
function locateSigntool(): string | null {
	if (cachedSigntoolPath !== undefined) {
		return cachedSigntoolPath;
	}

	const candidates: string[] = [];
	for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
		if (dir) {
			candidates.push(path.join(dir, 'signtool.exe'));
		}
	}

	const kitsBinDir = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
	if (fs.existsSync(kitsBinDir)) {
		const hostArch = process.arch === 'arm64' ? 'arm64' : 'x64';
		const versions = fs.readdirSync(kitsBinDir)
			.filter(entry => /^\d+(\.\d+)*$/.test(entry))
			.sort((a, b) => {
				const aParts = a.split('.').map(Number);
				const bParts = b.split('.').map(Number);
				for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
					const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0);
					if (diff) {
						return diff;
					}
				}
				return 0;
			});
		candidates.push(...versions.map(version => path.join(kitsBinDir, version, hostArch, 'signtool.exe')));
	}

	cachedSigntoolPath = candidates.find(candidate => fs.existsSync(candidate)) ?? null;
	if (!cachedSigntoolPath) {
		console.warn('signtool.exe not found on PATH or in a Windows SDK; Authenticode signatures invalidated by rcedit will not be stripped.');
	}
	return cachedSigntoolPath;
}

function hasAuthenticodeSignature(signtool: string, filePath: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const proc = cp.spawn(signtool, ['verify', '/pa', filePath]);
		proc.on('error', reject);
		proc.on('exit', code => resolve(code === 0));
	});
}

export async function stripAuthenticodeSignature(filePath: string): Promise<void> {
	// ESRP's `signtool /as` (append) fails with 0x800700C1 on PEs whose existing
	// Authenticode signature was invalidated by rcedit. Strip cleanly first so
	// rcedit operates on an unsigned PE.
	const signtool = locateSigntool();
	if (!signtool || !await hasAuthenticodeSignature(signtool, filePath)) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const proc = cp.spawn(signtool, ['remove', '/s', filePath]);
		let out = '';
		proc.stdout?.on('data', chunk => out += chunk.toString());
		proc.stderr?.on('data', chunk => out += chunk.toString());
		proc.on('error', reject);
		proc.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				process.stderr.write(out);
				reject(new Error(`signtool remove /s failed for ${filePath} (exit ${code})`));
			}
		});
	});
}
