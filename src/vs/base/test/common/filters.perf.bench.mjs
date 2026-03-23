/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Standalone benchmark comparing fuzzyMatchPartialScore vs fuzzyScore.
// Requires compiled output (npm run watch or npm run compile).
// Run from repo root:
//   node src/vs/base/test/common/filters.perf.bench.mjs

import { fuzzyMatchPartialScore, fuzzyScore, FuzzyScoreOptions } from '../../../../../out/vs/base/common/filters.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const N_TRIES = 5;
const COL_NAME = 38;
const COL_NUM = 8;

function measure(name, nIterations, fn) {
	let sink;
	const times = [];
	for (let t = 0; t < N_TRIES; t++) {
		const start = performance.now();
		for (let i = 0; i < nIterations; i++) {
			sink = fn();
		}
		times.push(performance.now() - start);
	}
	const best = Math.min(...times);
	const avg = times.reduce((a, b) => a + b) / times.length;
	const usPerOp = (best * 1000 / nIterations).toFixed(2);
	console.log(`  ${name.padEnd(COL_NAME)} best=${best.toFixed(2).padStart(COL_NUM)}ms  avg=${avg.toFixed(2).padStart(COL_NUM)}ms  ${usPerOp.padStart(7)}us/op  (${nIterations} iters)  sink=${!!sink}`);
}

const defaultOpts = FuzzyScoreOptions.default;

function benchGroup(label, nIterations, query, candidate) {
	const queryLow = query.toLowerCase();
	const candidateLow = candidate.toLowerCase();
	measure(`${label} [fuzzyPartial]`, nIterations, () => fuzzyMatchPartialScore(query, candidate));
	measure(`${label} [fuzzyScore]`, nIterations, () => fuzzyScore(query, queryLow, 0, candidate, candidateLow, 0, defaultOpts));
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const N_SHORT = 100_000;
const N_MEDIUM = 50_000;
const N_LONG = 10_000;

console.log('\n=== Short strings ===\n');
benchGroup('ExactMatch', N_SHORT, 'hello', 'hello');
benchGroup('SubstringMatch', N_SHORT, 'world', 'hello world');
benchGroup('PartialMatch', N_SHORT, 'hllo wrd', 'hello world');
benchGroup('CaseInsensitive', N_SHORT, 'hello world', 'Hello World');
benchGroup('NoMatch', N_SHORT, 'xyz', 'abcdef');

console.log('\n=== Medium strings (file path) ===\n');
const mediumCandidate = '/opt/Source/Malterlib/Malterlib/String/Source/Malterlib_String_FuzzyMatch.cpp';
benchGroup('PathSubstring', N_MEDIUM, 'FuzzyMatch.cpp', mediumCandidate);
benchGroup('PathPartial', N_MEDIUM, 'strfzy', mediumCandidate);
benchGroup('PathNoMatch', N_MEDIUM, 'zzzzzzz', mediumCandidate);

console.log('\n=== Long strings (repeated path x20) ===\n');
const longCandidate = mediumCandidate.repeat(20);
const longQuery = 'Malterlib_String_FuzzyMatch'.repeat(5);
benchGroup('LongCandidateSubstring', N_LONG, 'FuzzyMatch.cpp', longCandidate);
benchGroup('LongCandidatePartial', N_LONG, 'strfzymtch', longCandidate);
benchGroup('LongBothStrings', N_LONG, longQuery, longCandidate);

console.log('\n=== Worst case ===\n');
const repeatedCandidate = 'a'.repeat(200);
const repeatedQuery = 'a'.repeat(20);
const overlappingCandidate = 'abab'.repeat(50);
benchGroup('RepeatedChars (200a vs 20a)', N_LONG, repeatedQuery, repeatedCandidate);
benchGroup('OverlappingPatterns', N_LONG, 'ababababab', overlappingCandidate);
