/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { computeCodeFragmentTokens, findQuotedCodeFragments } from '../../../common/languages/codeFragments.js';

suite('Code fragments', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function tokens(text: string, ...ruleSets: { regex: string; tokenType: string }[][]): string[] {
		return computeCodeFragmentTokens(text, ruleSets.map(rules => ({ rules }))).map(token => `${text.substring(token.start, token.end)}:${token.tokenType}`);
	}

	test('rules match whole words, the first rule that matches winning', () => {
		const rules = [
			{ regex: 'int', tokenType: 'keyword' },
			{ regex: 'this', tokenType: 'keyword' },
			{ regex: 'm_[binpfro]?[A-Z][A-Za-z0-9_]*', tokenType: 'member' },
			{ regex: 'N[A-Z][A-Za-z0-9_]*', tokenType: 'namespace' },
			{ regex: 'TC[A-Z][A-Za-z0-9_]*', tokenType: 'templateType' },
			{ regex: '[A-Z][A-Za-z0-9_]*', tokenType: 'variable' },
			{ regex: '\\[\\[', tokenType: 'attribute' },
		];
		assert.deepStrictEqual(tokens('NMib::NStr::TCStr<int32, int> this->m_pData mNot [[x]] Atomic0', rules), [
			'NMib:namespace',
			'NStr:namespace',
			'TCStr:templateType',
			'int:keyword',
			'this:keyword',
			'm_pData:member',
			'[[:attribute',
			'Atomic0:variable',
		]);
	});

	test('rules match the alternative that ends a word', () => {
		const rules = [{ regex: 'in|int', tokenType: 'keyword' }, { regex: 'f_[a-z]+?', tokenType: 'function' }];
		assert.deepStrictEqual(tokens('int in f_get', rules), ['int:keyword', 'in:keyword', 'f_get:function']);
	});

	test('words of letters outside the Basic Multilingual Plane are whole', () => {
		const rules = [{ regex: 'int', tokenType: 'keyword' }];
		assert.deepStrictEqual(tokens('\u{1D6C2}int int\u{1D6C2} int', rules), ['int:keyword']);
	});

	test('earlier rule sets win, and invalid rules match nothing', () => {
		assert.deepStrictEqual(tokens('Foo', [{ regex: '(', tokenType: 'invalid' }, { regex: 'F\\w*', tokenType: 'first' }], [{ regex: 'Foo', tokenType: 'second' }]), ['Foo:first']);
		assert.deepStrictEqual(tokens('Foo'), []);
	});

	test('rules apply to the kinds of fragments they are for', () => {
		const rules = { rules: [{ regex: '[A-Z]\\w*', tokenType: 'variable', kinds: ['name' as const, 'quoted' as const] }, { regex: 'm_\\w+', tokenType: 'member' }] };
		const tokens = (kind: 'name' | 'value' | undefined) => computeCodeFragmentTokens('Start m_Foo', [rules], kind).map(token => token.tokenType);
		assert.deepStrictEqual({ name: tokens('name'), value: tokens('value'), any: tokens(undefined) }, {
			name: ['variable', 'member'],
			value: ['member'],
			any: ['variable', 'member'],
		});
	});

	test('quoted code', () => {
		const message = 'no known conversion from \'TCMap<A, B>\' to `C` for ‘D’; couldn\'t infer \'T\' (aka \'E\') or \'\' and \'unclosed';
		assert.deepStrictEqual(findQuotedCodeFragments(message).map(range => message.substring(range.start, range.end)), ['TCMap<A, B>', 'C', 'D', 'T', 'E']);

		const literals = 'in instantiation of \'TCFoo<A>::fp_Set<(signed char)\'\\x02\', char \'a\', TCBar<\'\\\'\'> *&>\' requested here, see \'operator<\' and \'X\'';
		assert.deepStrictEqual(findQuotedCodeFragments(literals).map(range => literals.substring(range.start, range.end)), ['TCFoo<A>::fp_Set<(signed char)\'\\x02\', char \'a\', TCBar<\'\\\'\'> *&>', 'operator<', 'X']);

		const expression = 'requirement \'X::Value == \'a\' || X::Other == L\'b\'\'; \'L\' or \'u8\', expected \'=\' before \'x\', because \'Check("foo\' \\"bar")\' failed';
		assert.deepStrictEqual(findQuotedCodeFragments(expression).map(range => expression.substring(range.start, range.end)), ['X::Value == \'a\' || X::Other == L\'b\'', 'L', 'u8', '=', 'x', 'Check("foo\' \\"bar")']);
	});
});
