/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';

/**
 * A package that the root `package.json` depends on by a `file:` path. npm copies it into
 * `node_modules` (see `install-links` in `.npmrc`) and builds it there, rather than downloading
 * a published version, so neither its version nor the lock file tell whether the copy is
 * current: only its own files do.
 */
export interface ILocalPackage {
	readonly name: string;

	/**
	 * The package's directory, `/`-separated and relative to the root.
	 */
	readonly dir: string;
}

/**
 * Directories inside a local package that building it produces, rather than it being built from.
 */
const generatedDirs = new Set(['build', 'node_modules']);

/**
 * Returns whether npm publishes, and so copies, the given file of a package, `/`-separated and
 * relative to the package: its manifest always, and with a `files` list, only what it lists.
 */
function isPublished(file: string, publishedFiles: readonly string[] | undefined): boolean {
	if (file === 'package.json' || !publishedFiles) {
		return true;
	}
	return publishedFiles.some(entry => {
		const published = path.posix.normalize(entry).replace(/\/$/, '');
		return file === published || file.startsWith(published + '/');
	});
}

/**
 * Returns the packages that the `package.json` in the given root depends on by a `file:` path.
 */
export function getLocalPackages(root: string): ILocalPackage[] {
	const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const localPackages: ILocalPackage[] = [];
	for (const dependencies of [packageJson.dependencies, packageJson.devDependencies, packageJson.optionalDependencies]) {
		for (const [name, spec] of Object.entries<string>(dependencies ?? {})) {
			if (spec.startsWith('file:')) {
				localPackages.push({ name, dir: path.posix.normalize(spec.slice('file:'.length)) });
			}
		}
	}
	return localPackages;
}

/**
 * Returns the files the given local package is built from, `/`-separated, relative to the root
 * and sorted: the files of the package's directory that npm publishes, but for what building
 * it produces, or its packed file. None for a packed package that is not built yet.
 */
export function getLocalPackageFiles(root: string, localPackage: ILocalPackage): string[] {
	const packagePath = path.join(root, localPackage.dir);
	if (!fs.existsSync(packagePath)) {
		return [];
	}
	if (!fs.statSync(packagePath).isDirectory()) {
		return [localPackage.dir]; // a packed package
	}

	const publishedFiles: string[] | undefined = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8')).files;
	const files: string[] = [];
	const collect = (dir: string) => {
		for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
			const relativePath = path.posix.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!generatedDirs.has(entry.name)) {
					collect(relativePath);
				}
			} else if (entry.isFile() && isPublished(path.posix.relative(localPackage.dir, relativePath), publishedFiles)) {
				files.push(relativePath);
			}
		}
	};
	collect(localPackage.dir);
	return files.sort();
}
