/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { importAMDNodeModule } from '../../../amdX.js';
import * as filters from '../../common/filters.js';
import { FileAccess } from '../../common/network.js';

const patterns = ['cci', 'ida', 'pos', 'CCI', 'enbled', 'callback', 'gGame', 'cons', 'zyx', 'aBc'];

const _enablePerf = false;

function perfSuite(name: string, callback: (this: Mocha.Suite) => void) {
	if (_enablePerf) {
		suite(name, callback);
	}
}

perfSuite('Performance - fuzzyMatch', async function () {

	const uri = FileAccess.asBrowserUri('vs/base/test/common/filters.perf.data').toString(true);
	const { data } = await importAMDNodeModule<typeof import('./filters.perf.data.js')>(uri, '');

	// suiteSetup(() => console.profile());
	// suiteTeardown(() => console.profileEnd());

	console.log(`Matching ${data.length} items against ${patterns.length} patterns (${data.length * patterns.length} operations) `);

	function perfTest(name: string, match: filters.FuzzyScorer) {
		test(name, () => {

			const t1 = Date.now();
			let count = 0;
			for (let i = 0; i < 2; i++) {
				for (const pattern of patterns) {
					const patternLow = pattern.toLowerCase();
					for (const item of data) {
						count += 1;
						match(pattern, patternLow, 0, item, item.toLowerCase(), 0);
					}
				}
			}
			const d = Date.now() - t1;
			console.log(name, `${d}ms, ${Math.round(count / d) * 15}/15ms, ${Math.round(count / d)}/1ms`);
		});
	}

	perfTest('fuzzyScore', filters.fuzzyScore);
	perfTest('fuzzyScoreGraceful', filters.fuzzyScoreGraceful);
	perfTest('fuzzyScoreGracefulAggressive', filters.fuzzyScoreGracefulAggressive);
});


perfSuite('Performance - IFilter', async function () {

	const uri = FileAccess.asBrowserUri('vs/base/test/common/filters.perf.data').toString(true);
	const { data } = await importAMDNodeModule<typeof import('./filters.perf.data.js')>(uri, '');

	function perfTest(name: string, match: filters.IFilter) {
		test(name, () => {

			const t1 = Date.now();
			let count = 0;
			for (let i = 0; i < 2; i++) {
				for (const pattern of patterns) {
					for (const item of data) {
						count += 1;
						match(pattern, item);
					}
				}
			}
			const d = Date.now() - t1;
			console.log(name, `${d}ms, ${Math.round(count / d) * 15}/15ms, ${Math.round(count / d)}/1ms`);
		});
	}

	perfTest('matchesFuzzy', filters.matchesFuzzy);
	perfTest('matchesFuzzy2', filters.matchesFuzzy2);
	perfTest('matchesPrefix', filters.matchesPrefix);
	perfTest('matchesContiguousSubString', filters.matchesContiguousSubString);
	perfTest('matchesCamelCase', filters.matchesCamelCase);
});


perfSuite('Performance - fuzzyMatchPartialScore', function () {

	const nTries = 5;
	const nIterationsShort = 100_000;
	const nIterationsMedium = 50_000;
	const nIterationsLong = 10_000;

	function measure(name: string, nIterations: number, fn: () => unknown) {
		test(name, () => {
			let sink: unknown;
			const times: number[] = [];
			for (let t = 0; t < nTries; t++) {
				const start = performance.now();
				for (let i = 0; i < nIterations; i++) {
					sink = fn();
				}
				times.push(performance.now() - start);
			}
			const best = Math.min(...times);
			const avg = times.reduce((a, b) => a + b) / times.length;
			console.log(`  ${name}: best=${best.toFixed(2)}ms avg=${avg.toFixed(2)}ms (${nIterations} iters, ${(best * 1000 / nIterations).toFixed(2)}µs/op) sink=${!!sink}`);
		});
	}

	// Short strings: typical filename/command matching
	suite('ShortStrings', () => {
		measure('ExactMatch', nIterationsShort, () => filters.fuzzyMatchPartialScore('hello', 'hello'));
		measure('SubstringMatch', nIterationsShort, () => filters.fuzzyMatchPartialScore('world', 'hello world'));
		measure('PartialMatch', nIterationsShort, () => filters.fuzzyMatchPartialScore('hllo wrd', 'hello world'));
		measure('CaseInsensitive', nIterationsShort, () => filters.fuzzyMatchPartialScore('hello world', 'Hello World'));
		measure('NoMatch', nIterationsShort, () => filters.fuzzyMatchPartialScore('xyz', 'abcdef'));
	});

	// Medium strings: typical file path matching
	suite('MediumStrings', () => {
		const candidate = '/opt/Source/Malterlib/Malterlib/String/Source/Malterlib_String_FuzzyMatch.cpp';
		measure('PathSubstring', nIterationsMedium, () => filters.fuzzyMatchPartialScore('FuzzyMatch.cpp', candidate));
		measure('PathPartial', nIterationsMedium, () => filters.fuzzyMatchPartialScore('strfzy', candidate));
		measure('PathNoMatch', nIterationsMedium, () => filters.fuzzyMatchPartialScore('zzzzzzz', candidate));
	});

	// Long strings: stress test with repeated patterns
	suite('LongStrings', () => {
		const longCandidate = '/opt/Source/Malterlib/Malterlib/String/Source/Malterlib_String_FuzzyMatch.cpp'.repeat(20);
		const longQuery = 'Malterlib_String_FuzzyMatch'.repeat(5);
		measure('LongCandidateSubstring', nIterationsLong, () => filters.fuzzyMatchPartialScore('FuzzyMatch.cpp', longCandidate));
		measure('LongCandidatePartial', nIterationsLong, () => filters.fuzzyMatchPartialScore('strfzymtch', longCandidate));
		measure('LongBothStrings', nIterationsLong, () => filters.fuzzyMatchPartialScore(longQuery, longCandidate));
	});

	// Worst case: many repeated characters causing lots of partial matches
	suite('WorstCase', () => {
		const repeatedCandidate = 'a'.repeat(200);
		const repeatedQuery = 'a'.repeat(20);
		const overlappingCandidate = 'abab'.repeat(50);
		measure('RepeatedCharacters', nIterationsLong, () => filters.fuzzyMatchPartialScore(repeatedQuery, repeatedCandidate));
		measure('OverlappingPatterns', nIterationsLong, () => filters.fuzzyMatchPartialScore('ababababab', overlappingCandidate));
	});
});
