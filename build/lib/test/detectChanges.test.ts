/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { suite, test } from 'node:test';
import { detectChanges } from '../../../.github/actions/detect-changes/detect.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const coreTestOutputs = ['unit-tests', 'browser-integration', 'product-tests'];

/** The outputs of the changes that only Compile & Hygiene reads. */
const onlyCompileAndHygiene = {
	'cli': 'false',
	'copilot-shim': 'false',
	'copilot': 'false',
	'unit-tests': 'false',
	'browser-integration': 'false',
	'product-tests': 'false',
	'monaco-editor': 'false',
	'telemetry': 'false',
};

async function detect(files: readonly { filename: string; previous_filename?: string; status?: string; patch?: string }[], expectedCount = files.length, failure?: Error, mergeGroup?: { readonly base_ref: string; readonly head_sha: string }) {
	const outputs: Record<string, string> = {};
	await detectChanges({
		paginate: async (_method, parameters) => {
			assert.ok(!mergeGroup, 'a merge group lists the files of a comparison');
			assert.equal(parameters.per_page, 100);
			if (failure) {
				throw failure;
			}
			return files;
		},
		rest: {
			pulls: { listFiles: {} },
			repos: {
				compareCommitsWithBasehead: async parameters => {
					assert.equal(parameters.basehead, `main...${mergeGroup?.head_sha}`);
					if (failure) {
						throw failure;
					}
					return { data: { files } };
				},
			},
		},
	}, {
		repo: { owner: 'microsoft', repo: 'vscode' },
		issue: { number: 1 },
		payload: mergeGroup ? { merge_group: mergeGroup } : { pull_request: { changed_files: expectedCount } },
	}, {
		info: () => { },
		warning: () => { },
		setOutput: (name, value) => outputs[name] = value,
	});
	return outputs;
}

async function detectCoreTests(...filenames: string[]): Promise<string[]> {
	const outputs = await detect(filenames.map(filename => ({ filename })));
	return coreTestOutputs.map(output => outputs[output]);
}

/** Names of the built-in extensions whose files the core tests import or read by repository path. */
function extensionsReadByCoreTests(): Map<string, string> {
	const extensionsRoot = path.join(repositoryRoot, 'extensions');
	const reference = /(?:from\s+['"](?<relative>(?:\.\.\/)+)|['"`])extensions\/(?<name>[a-z0-9-]+)\/(?<rest>[^'"`\s]+)/g;
	// git grep narrows thousands of test files down to the few that mention an extension path.
	const candidates = execFileSync('git', ['grep', '-l', '-E', 'extensions/[a-z0-9-]+/', '--', 'src/**/test/**', 'test/unit/**'], { cwd: repositoryRoot, encoding: 'utf8' })
		.split('\n')
		.filter(file => /\.(ts|js|mjs)$/.test(file));
	const result = new Map<string, string>();
	for (const candidate of candidates) {
		const file = path.join(repositoryRoot, candidate);
		for (const match of readFileSync(file, 'utf8').matchAll(reference)) {
			const { relative, name, rest } = match.groups!;
			const extensionPath = relative !== undefined
				? path.resolve(path.dirname(file), `${relative}extensions/${name}`)
				: path.join(extensionsRoot, name);
			// Skips imports such as `../../extensions/common/...` that resolve into the core sources.
			if (extensionPath !== path.join(extensionsRoot, name) || !existsSync(extensionPath)) {
				continue;
			}
			// Template literals name a file only at runtime.
			if (rest.includes('${') || existsSync(path.join(extensionPath, rest))) {
				result.set(name, candidate);
			}
		}
	}
	return result;
}

suite('Detect Changes', () => {
	test('core test jobs run unless every change is one they cannot read', async () => {
		const cases: [string, string[]][] = [
			['src/vs/base/common/async.ts', ['true', 'true', 'true']],
			['src/vs/workbench/contrib/chat/README.md', ['true', 'true', 'true']],
			['test/smoke/README.md', ['true', 'true', 'true']],
			['README.md', ['false', 'false', 'false']],
			['.github/skills/unit-tests/SKILL.md', ['false', 'false', 'false']],
			['cli/src/commands/tunnels.rs', ['false', 'false', 'false']],
			['copilot_shim/src/main.rs', ['false', 'false', 'false']],
			['extensions/copilot/src/extension/extension.ts', ['false', 'false', 'true']],
			['extensions/git/src/repository.ts', ['false', 'true', 'true']],
			['extensions/markdown-language-features/test-workspace/a.md', ['false', 'true', 'true']],
			['extensions/theme-defaults/themes/dark_modern.json', ['true', 'true', 'true']],
			['extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json', ['true', 'true', 'true']],
			['extensions/package.json', ['true', 'true', 'true']],
			['.github/workflows/pr.yml', ['true', 'true', 'true']],
			['.github/workflows/pr-linux-test.yml', ['true', 'true', 'true']],
			['.github/actions/detect-changes/detect.ts', ['true', 'true', 'true']],
			['build/gulpfile.ts', ['true', 'true', 'true']],
			['build/azure-pipelines/product-build.yml', ['false', 'false', 'false']],
			['build/azure-pipelines/win32/steps/product-build-win32-test.yml', ['false', 'false', 'false']],
			['build/azure-pipelines/linux/setup-env.sh', ['true', 'true', 'true']],
			['build/azure-pipelines/common/computeBuiltInDepsCacheKey.ts', ['true', 'true', 'true']],
			['.vscode/settings.json', ['false', 'false', 'false']],
			['.vscode/extensions/vscode-selfhost-test-provider/src/extension.ts', ['false', 'false', 'false']],
			['.vscode/extensions/vscode-pr-pinger/package.json', ['false', 'false', 'false']],
			['extensions/vscode-api-tests/testWorkspace/.vscode/settings.json', ['false', 'true', 'true']],
			['eslint.config.js', ['false', 'false', 'false']],
			['.eslint-plugin-local/code-no-any-casts.ts', ['false', 'false', 'false']],
			['test/sanity/src/cli.test.ts', ['false', 'false', 'false']],
			['.github/rulesets/main-merge-queue.json', ['false', 'false', 'false']],
			['test/smoke/src/main.ts', ['true', 'true', 'true']],
			['package.json', ['true', 'true', 'true']],
		];
		const results: [string, string[]][] = [];
		for (const [filename] of cases) {
			results.push([filename, await detectCoreTests(filename)]);
		}
		assert.deepStrictEqual(results, cases);
	});

	test('every changed path must be one the tests cannot read', async () => {
		assert.deepStrictEqual([
			await detectCoreTests('extensions/copilot/package.json', 'README.md', 'cli/Cargo.toml'),
			await detectCoreTests('extensions/copilot/package.json', 'extensions/git/package.json'),
			await detectCoreTests('extensions/copilot/package.json', 'src/vs/base/common/async.ts'),
			await detectCoreTests('build/azure-pipelines/product-build.yml', 'README.md'),
			await detectCoreTests('build/azure-pipelines/product-build.yml', 'build/azure-pipelines/win32/exec.ps1'),
		], [
			['false', 'false', 'true'],
			['false', 'true', 'true'],
			['true', 'true', 'true'],
			['false', 'false', 'false'],
			['true', 'true', 'true'],
		]);
	});

	test('a change to the workspace configuration, the ESLint configuration or the sanity tests runs only Compile & Hygiene, and the Copilot checks lint with the ESLint configuration', async () => {
		assert.deepStrictEqual({
			workspaceConfiguration: await detect([
				{ filename: '.vscode/settings.json' },
				{ filename: '.vscode/launch.json' },
				{ filename: '.vscode/tasks.json' },
				{ filename: '.vscode/extensions/vscode-selfhost-test-provider/src/extension.ts' },
				{ filename: '.vscode/extensions/vscode-pr-pinger/package.json' },
			]),
			eslintConfiguration: await detect([
				{ filename: 'eslint.config.js' },
				{ filename: '.eslint-ignore' },
				{ filename: '.eslint-allowed-javascript-files' },
				{ filename: '.eslint-allowed-bracket-notation-files' },
				{ filename: '.eslint-plugin-local/code-no-any-casts.ts' },
			]),
			sanityTests: await detect([
				{ filename: 'test/sanity/src/cli.test.ts' },
				{ filename: 'test/sanity/package.json' },
			]),
		}, {
			workspaceConfiguration: onlyCompileAndHygiene,
			eslintConfiguration: { ...onlyCompileAndHygiene, 'copilot': 'true' },
			sanityTests: onlyCompileAndHygiene,
		});
	});

	test('a change that only updates the distro commit in package.json runs only Compile & Hygiene', async () => {
		// The line of package.json that `npm run update-distro` rewrites, so that the test fails when its format changes.
		const distroLine = readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8').split('\n').find(line => line.includes('"distro"'));
		const packageJsonChange = (...changedLines: string[]) => ({
			filename: 'package.json',
			status: 'modified',
			patch: ['@@ -1,7 +1,7 @@', ' {', '   "name": "code-oss-dev",', ...changedLines, '   "author": {'].join('\n'),
		});
		const distroUpdate = packageJsonChange(`-${distroLine}`, `+  "distro": "${'0'.repeat(40)}",`);
		const everyCheck = { ...onlyCompileAndHygiene, 'cli': 'true', 'copilot': 'true', 'unit-tests': 'true', 'browser-integration': 'true', 'product-tests': 'true', 'monaco-editor': 'true', 'telemetry': 'true' };
		assert.deepStrictEqual({
			distroUpdate: await detect([distroUpdate]),
			withAzurePipelinesDefinition: await detect([distroUpdate, { filename: 'build/azure-pipelines/product-build.yml' }]),
			withSources: await detect([distroUpdate, { filename: 'src/vs/base/common/async.ts' }]),
			withOtherField: await detect([packageJsonChange(`-${distroLine}`, '-  "version": "1.0.0",', `+  "distro": "${'0'.repeat(40)}",`, '+  "version": "1.1.0",')]),
			// GitHub omits the patch of large diffs.
			withoutPatch: await detect([{ filename: 'package.json', status: 'modified' }]),
		}, {
			distroUpdate: onlyCompileAndHygiene,
			withAzurePipelinesDefinition: onlyCompileAndHygiene,
			withSources: { ...everyCheck, 'cli': 'false', 'copilot': 'false' },
			withOtherField: everyCheck,
			withoutPatch: everyCheck,
		});
	});

	test('both sides of a rename participate in selection', async () => {
		const outputs = await detect([{ filename: 'docs/async.md', previous_filename: 'src/vs/base/common/async.ts' }]);
		assert.deepStrictEqual(coreTestOutputs.map(output => outputs[output]), ['true', 'true', 'true']);
	});

	test('failed, incomplete and empty changed-file lookups run the core tests', async () => {
		const [failed, incomplete, empty] = await Promise.all([
			detect([], 0, new Error('lookup unavailable')),
			detect([], 1),
			detect([]),
		]);
		for (const outputs of [failed, incomplete]) {
			assert.ok(Object.values(outputs).every(value => value === 'true'), JSON.stringify(outputs));
		}
		assert.deepStrictEqual(coreTestOutputs.map(output => empty[output]), ['true', 'true', 'true']);
	});

	test('in the merge queue, the checks compare the merge group with where it forks from the base branch, and all run when GitHub lists only part of its files', async () => {
		const mergeGroup = { base_ref: 'refs/heads/main', head_sha: 'h'.repeat(40) };
		const [documentation, sources, truncated] = await Promise.all([
			detect([{ filename: 'README.md' }], undefined, undefined, mergeGroup),
			detect([{ filename: 'src/vs/base/common/async.ts' }], undefined, undefined, mergeGroup),
			// GitHub lists at most 300 files of a comparison.
			detect(Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md` })), undefined, undefined, mergeGroup),
		]);
		assert.deepStrictEqual({
			documentation: coreTestOutputs.map(output => documentation[output]),
			sources: coreTestOutputs.map(output => sources[output]),
			truncated: Object.values(truncated).every(value => value === 'true'),
		}, {
			documentation: ['false', 'false', 'false'],
			sources: ['true', 'true', 'true'],
			truncated: true,
		});
	});

	test('the unit tests run for every built-in extension whose files the core tests read', async () => {
		const extensions = extensionsReadByCoreTests();
		assert.ok(extensions.has('theme-defaults'), 'the scan should find the component fixture themes');
		const skipped: string[] = [];
		for (const [name, reader] of extensions) {
			const [unitTests] = await detectCoreTests(`extensions/${name}/package.json`);
			if (unitTests !== 'true') {
				skipped.push(`extensions/${name}/ (read by ${reader})`);
			}
		}
		assert.deepStrictEqual(skipped, [], 'add these extensions to extensionsReadByUnitTests in .github/actions/detect-changes/detect.ts');
	});

});
