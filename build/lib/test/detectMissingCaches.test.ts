/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { suite, test } from 'node:test';
import { FAILSAFE_SCHEMA, load } from 'js-yaml';
import { cacheWarmingJobs, detectMissingCaches, getCaches } from '../../../.github/actions/detect-missing-caches/detect.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

interface IStep {
	readonly name?: string;
	readonly uses?: string;
	readonly run?: string;
	readonly shell?: string;
	readonly 'working-directory'?: string;
	readonly with?: Record<string, string>;
}

/**
 * Loads a workflow or action with all values as strings.
 */
function loadYaml<T>(relativePath: string): T {
	return load(readFileSync(path.join(repositoryRoot, relativePath), 'utf8'), { schema: FAILSAFE_SCHEMA }) as T;
}

function readRepositoryFile(relativePath: string): Buffer {
	return readFileSync(path.join(repositoryRoot, relativePath));
}

suite('Detect missing caches', () => {

	test('the cache paths have no `..` segments', () => {
		// actions/cache/save only warns about such a path and saves nothing, so its cache stays missing.
		const files = [
			...readdirSync(path.join(repositoryRoot, '.github/workflows')).filter(name => name.endsWith('.yml')).map(name => `.github/workflows/${name}`),
			...readdirSync(path.join(repositoryRoot, '.github/actions')).map(name => `.github/actions/${name}/action.yml`),
		];
		const cachePaths = files.flatMap(file => {
			const { jobs, runs } = loadYaml<{ jobs?: Record<string, { steps?: IStep[] }>; runs?: { steps?: IStep[] } }>(file);
			return [...Object.values(jobs ?? {}).flatMap(job => job.steps ?? []), ...runs?.steps ?? []]
				.filter(step => step.uses?.startsWith('actions/cache'))
				.flatMap(step => step.with?.path?.split('\n').map(line => line.trim()).filter(line => line) ?? []);
		});
		assert.deepStrictEqual({
			pnpmStore: cachePaths.includes('.build/pnpm-store'),
			withParentSegments: cachePaths.filter(cachePath => cachePath.split(/[\\/]/).includes('..')),
		}, { pnpmStore: true, withParentSegments: [] });
	});

	test('jobs run when one of their caches is missing, has another version or cannot be listed', async () => {
		const [missing, incompatible] = [getCaches(cacheWarmingJobs.windows, readRepositoryFile)[1], getCaches(cacheWarmingJobs.linux, readRepositoryFile)[1]];
		const existing = Object.values(cacheWarmingJobs)
			.flatMap(job => getCaches(job, readRepositoryFile))
			.filter(cache => cache.key !== missing.key)
			.map(cache => cache.key === incompatible.key ? { ...cache, version: 'other' } : cache);
		// Listing by key prefix also returns longer keys.
		const list = (caches: readonly { key: string; version: string }[], key: string) => caches.filter(cache => cache.key.startsWith(key)).concat({ key: `${key}-other`, version: 'other' });

		const detect = async (ref: string, listCaches: (key: string, ref: string) => { key: string; version: string }[]) => {
			const outputs: Record<string, string> = {};
			const listedRefs = new Set<string>();
			await detectMissingCaches({
				rest: {
					actions: {
						getActionsCacheList: async parameters => {
							assert.equal(parameters.per_page, 100);
							listedRefs.add(parameters.ref);
							return { data: { actions_caches: listCaches(parameters.key, parameters.ref) } };
						},
					},
				},
			}, {
				repo: { owner: 'microsoft', repo: 'vscode' },
				ref,
				payload: { repository: { default_branch: 'main' } },
			}, {
				info: () => { },
				warning: () => { },
				setOutput: (name, value) => outputs[name] = value,
			}, { lf: readRepositoryFile, crlf: readRepositoryFile });
			return { listedRefs: [...listedRefs], outputs };
		};

		const missingOrIncompatible = { 'compile': 'false', 'linux': 'true', 'windows': 'true', 'copilot-linux': 'false', 'copilot-windows': 'false' };
		assert.deepStrictEqual(await Promise.all([
			detect('refs/heads/main', (key, ref) => ref === 'refs/heads/main' ? list(existing, key) : []),
			// A release branch also restores the caches of main, without saving a copy.
			detect('refs/heads/release/1.200', (key, ref) => list(existing.filter((_cache, index) => (index % 2 === 0) === (ref === 'refs/heads/main')), key)),
			detect('refs/heads/main', () => { throw new Error('Not available'); }),
		]), [
			{ listedRefs: ['refs/heads/main'], outputs: missingOrIncompatible },
			{ listedRefs: ['refs/heads/release/1.200', 'refs/heads/main'], outputs: missingOrIncompatible },
			{ listedRefs: ['refs/heads/main'], outputs: { 'compile': 'true', 'linux': 'true', 'windows': 'true', 'copilot-linux': 'true', 'copilot-windows': 'true' } },
		]);
	});
});
