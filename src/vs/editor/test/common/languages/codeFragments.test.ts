/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { computeCodeFragmentTokens, findQuotedCodeFragments, getMessageLabelParts } from '../../../common/languages/codeFragments.js';

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

	test('the parts of a message on a line are its quoted code, as laid out, and the text between', () => {
		const describe = (message: string, layouts: [string, string | undefined][], ranges: [number, number][], maxLength?: number) =>
			getMessageLabelParts(message, new Map(layouts), ranges.map(([start, end]) => ({ start, end })), maxLength)
				.map(part => `${part.isCode ? `{${part.text}}` : part.text}${part.ranges.map(range => `[${part.text.substring(range.start, range.end)}]`).join('')}`);

		const message = 'no conversion from \'const TCAuto<int,bool>*\' to \'bool\', sorry';
		assert.deepStrictEqual({
			asQuoted: describe(message, [], [[3, 13], [20, 25], [49, 53]]),
			// A layout that spaces the code differently, or moves code, has the ranges where their characters are, and
			// one that parts the characters of a range has one range, of all of it
			spaced: describe(message, [['const TCAuto<int,bool>*', 'const TCAuto<int, bool> *'], ['bool', undefined]], [[26, 42]]),
			moved: describe(message, [['const TCAuto<int,bool>*', 'TCAuto<int, bool> const *']], [[20, 25], [33, 41]]),
			parted: describe(message, [['const TCAuto<int,bool>*', 'TCAuto<int, bool> const *']], [[20, 32]]),
			// Code laid out over lines stays as quoted
			overLines: describe('\'int a; int b\'', [['int a; int b', 'int a;\nint b']], []),
			// A message longer than shown is cut, in code after the name it is cut in
			cutInText: describe(message, [], [], 10),
			cutInCode: describe(message, [['const TCAuto<int,bool>*', 'TCAuto<int, bool> const *']], [[26, 60]], 29),
			cutAtQuote: describe(message, [], [], 19),
		}, {
			asQuoted: ['no conversion from [conversion]', '{const TCAuto<int,bool>*}[const]', ' to ', '{bool}[bool]', ', sorry'],
			spaced: ['no conversion from ', '{const TCAuto<int, bool> *}[TCAuto<int, bool>]', ' to ', '{bool}', ', sorry'],
			moved: ['no conversion from ', '{TCAuto<int, bool> const *}[int, bool][const]', ' to ', '{bool}', ', sorry'],
			parted: ['no conversion from ', '{TCAuto<int, bool> const *}[TCAuto<int, bool> const *]', ' to ', '{bool}', ', sorry'],
			overLines: ['{int a; int b}'],
			cutInText: ['no convers', '...'],
			cutInCode: ['no conversion from ', '{const TCAuto}[TCAuto]', '...'],
			cutAtQuote: ['no conversion from ', '...'],
		});
	});
});
