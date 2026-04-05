/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { CharacterPair, IndentAction } from '../../../../common/languages/languageConfiguration.js';
import { OnEnterSupport } from '../../../../common/languages/supports/onEnter.js';
import { javascriptOnEnterRules } from './onEnterRules.js';
import { EditorAutoIndentStrategy } from '../../../../common/config/editorOptions.js';
import { StandardTokenType } from '../../../../common/encodedTokenAttributes.js';
import { IViewLineTokens } from '../../../../common/tokens/lineTokens.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

function createMockTokens(segments: { text: string; type: StandardTokenType }[]): IViewLineTokens {
	return {
		getCount: () => segments.length,
		getStandardTokenType: (i: number) => segments[i].type,
		getTokenText: (i: number) => segments[i].text,
		getLineContent: () => segments.map(s => s.text).join(''),
		forEach: (cb: (tokenIndex: number) => void) => { for (let i = 0; i < segments.length; i++) { cb(i); } },
		getEndOffset: (i: number) => segments.slice(0, i + 1).reduce((sum, s) => sum + s.text.length, 0),
		findTokenIndexAtOffset: () => 0,
		equals: () => false,
		getForeground: () => 0,
		getClassName: () => '',
		getInlineStyle: () => '',
		getPresentation: () => ({ foreground: 0, italic: false, bold: false, underline: false, strikethrough: false }),
		getMetadata: () => 0,
		getLanguageId: () => '',
		languageIdCodec: { encodeLanguageId: () => 0, decodeLanguageId: () => '' },
	} satisfies IViewLineTokens;
}

suite('OnEnter', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses brackets', () => {
		const brackets: CharacterPair[] = [
			['(', ')'],
			['begin', 'end']
		];
		const support = new OnEnterSupport({
			brackets: brackets
		});
		const testIndentAction = (beforeText: string, afterText: string, expected: IndentAction) => {
			const actual = support.onEnter(EditorAutoIndentStrategy.Advanced, '', beforeText, afterText);
			if (expected === IndentAction.None) {
				assert.strictEqual(actual, null);
			} else {
				assert.strictEqual(actual!.indentAction, expected);
			}
		};

		testIndentAction('a', '', IndentAction.None);
		testIndentAction('', 'b', IndentAction.None);
		testIndentAction('(', 'b', IndentAction.Indent);
		testIndentAction('a', ')', IndentAction.None);
		testIndentAction('begin', 'ending', IndentAction.Indent);
		testIndentAction('abegin', 'end', IndentAction.None);
		testIndentAction('begin', ')', IndentAction.Indent);
		testIndentAction('begin', 'end', IndentAction.IndentOutdent);
		testIndentAction('begin ', ' end', IndentAction.IndentOutdent);
		testIndentAction(' begin', 'end//as', IndentAction.IndentOutdent);
		testIndentAction('(', ')', IndentAction.IndentOutdent);
		testIndentAction('( ', ')', IndentAction.IndentOutdent);
		testIndentAction('a(', ')b', IndentAction.IndentOutdent);

		testIndentAction('(', '', IndentAction.Indent);
		testIndentAction('(', 'foo', IndentAction.Indent);
		testIndentAction('begin', 'foo', IndentAction.Indent);
		testIndentAction('begin', '', IndentAction.Indent);
	});


	test('Issue #121125: onEnterRules with global modifier', () => {
		const support = new OnEnterSupport({
			onEnterRules: [
				{
					action: {
						appendText: '/// ',
						indentAction: IndentAction.Outdent
					},
					beforeText: /^\s*\/{3}.*$/gm
				}
			]
		});

		const testIndentAction = (previousLineText: string, beforeText: string, afterText: string, expectedIndentAction: IndentAction | null, expectedAppendText: string | null, removeText: number = 0) => {
			const actual = support.onEnter(EditorAutoIndentStrategy.Advanced, previousLineText, beforeText, afterText);
			if (expectedIndentAction === null) {
				assert.strictEqual(actual, null, 'isNull:' + beforeText);
			} else {
				assert.strictEqual(actual !== null, true, 'isNotNull:' + beforeText);
				assert.strictEqual(actual!.indentAction, expectedIndentAction, 'indentAction:' + beforeText);
				if (expectedAppendText !== null) {
					assert.strictEqual(actual!.appendText, expectedAppendText, 'appendText:' + beforeText);
				}
				if (removeText !== 0) {
					assert.strictEqual(actual!.removeText, removeText, 'removeText:' + beforeText);
				}
			}
		};

		testIndentAction('/// line', '/// line', '', IndentAction.Outdent, '/// ');
		testIndentAction('/// line', '/// line', '', IndentAction.Outdent, '/// ');
	});

	test('uses regExpRules', () => {
		const support = new OnEnterSupport({
			onEnterRules: javascriptOnEnterRules
		});
		const testIndentAction = (previousLineText: string, beforeText: string, afterText: string, expectedIndentAction: IndentAction | null, expectedAppendText: string | null, removeText: number = 0) => {
			const actual = support.onEnter(EditorAutoIndentStrategy.Advanced, previousLineText, beforeText, afterText);
			if (expectedIndentAction === null) {
				assert.strictEqual(actual, null, 'isNull:' + beforeText);
			} else {
				assert.strictEqual(actual !== null, true, 'isNotNull:' + beforeText);
				assert.strictEqual(actual!.indentAction, expectedIndentAction, 'indentAction:' + beforeText);
				if (expectedAppendText !== null) {
					assert.strictEqual(actual!.appendText, expectedAppendText, 'appendText:' + beforeText);
				}
				if (removeText !== 0) {
					assert.strictEqual(actual!.removeText, removeText, 'removeText:' + beforeText);
				}
			}
		};

		testIndentAction('', '\t/**', ' */', IndentAction.IndentOutdent, ' * ');
		testIndentAction('', '\t/**', '', IndentAction.None, ' * ');
		testIndentAction('', '\t/** * / * / * /', '', IndentAction.None, ' * ');
		testIndentAction('', '\t/** /*', '', IndentAction.None, ' * ');
		testIndentAction('', '/**', '', IndentAction.None, ' * ');
		testIndentAction('', '\t/**/', '', null, null);
		testIndentAction('', '\t/***/', '', null, null);
		testIndentAction('', '\t/*******/', '', null, null);
		testIndentAction('', '\t/** * * * * */', '', null, null);
		testIndentAction('', '\t/** */', '', null, null);
		testIndentAction('', '\t/** asdfg */', '', null, null);
		testIndentAction('', '\t/* asdfg */', '', null, null);
		testIndentAction('', '\t/* asdfg */', '', null, null);
		testIndentAction('', '\t/** asdfg */', '', null, null);
		testIndentAction('', '*/', '', null, null);
		testIndentAction('', '\t/*', '', null, null);
		testIndentAction('', '\t*', '', null, null);

		testIndentAction('\t/**', '\t *', '', IndentAction.None, '* ');
		testIndentAction('\t * something', '\t *', '', IndentAction.None, '* ');
		testIndentAction('\t *', '\t *', '', IndentAction.None, '* ');

		testIndentAction('', '\t */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t * */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t * * / * / * / */', '', null, null);

		testIndentAction('\t/**', '\t * ', '', IndentAction.None, '* ');
		testIndentAction('\t * something', '\t * ', '', IndentAction.None, '* ');
		testIndentAction('\t *', '\t * ', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * ', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * ', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * asdfsfagadfg * * * ', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * asdfsfagadfg * * * ', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg * * * ', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * /*', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * /*', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * /*', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * asdfsfagadfg * / * / * /', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * asdfsfagadfg * / * / * /', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg * / * / * /', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * asdfsfagadfg * / * / * /*', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * asdfsfagadfg * / * / * /*', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg * / * / * /*', '', IndentAction.None, '* ');

		testIndentAction('', ' */', '', IndentAction.None, null, 1);
		testIndentAction(' */', ' * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('', '\t */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t\t */', '', IndentAction.None, null, 1);
		testIndentAction('', '   */', '', IndentAction.None, null, 1);
		testIndentAction('', '     */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t     */', '', IndentAction.None, null, 1);
		testIndentAction('', ' *--------------------------------------------------------------------------------------------*/', '', IndentAction.None, null, 1);

		// issue #43469
		testIndentAction('class A {', '    * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('', '    * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('    ', '    * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('class A {', '  * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('', '  * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('  ', '  * test() {', '', IndentAction.Indent, null, 0);
	});

	test('beforeTextTokenTypes filters beforeText by token type', () => {
		const support = new OnEnterSupport({
			onEnterRules: [{
				beforeText: /\/\/.*/,
				afterText: /^(?!\s*$).+/,
				beforeTextTokenTypes: [StandardTokenType.Comment],
				action: { indentAction: IndentAction.None, appendText: '// ' }
			}]
		});

		// beforeText is all comment tokens -> regex matches "// hello"
		const commentTokens = createMockTokens([
			{ text: '// hello', type: StandardTokenType.Comment }
		]);
		const commentResult = support.onEnter(EditorAutoIndentStrategy.Advanced, '', '// hello', 'world', commentTokens);
		assert.strictEqual(commentResult?.appendText, '// ');

		// beforeText has "//" inside a string token -> comment text is empty -> no match
		const stringTokens = createMockTokens([
			{ text: '"//"', type: StandardTokenType.String },
			{ text: ' ', type: StandardTokenType.Other }
		]);
		const stringResult = support.onEnter(EditorAutoIndentStrategy.Advanced, '', '"//" ', 'world', stringTokens);
		assert.strictEqual(stringResult, null);

		// beforeText has "//" in string then "/" in comment -> comment text is only "/" -> no match
		const mixedTokens = createMockTokens([
			{ text: '"//"', type: StandardTokenType.String },
			{ text: ' ', type: StandardTokenType.Other },
			{ text: '/', type: StandardTokenType.Comment }
		]);
		const mixedResult = support.onEnter(EditorAutoIndentStrategy.Advanced, '', '"//" /', '/ x', mixedTokens);
		assert.strictEqual(mixedResult, null);

		// No tokens provided -> falls back to full beforeText (backwards compatibility)
		const noTokenResult = support.onEnter(EditorAutoIndentStrategy.Advanced, '', '// hello', 'world');
		assert.strictEqual(noTokenResult?.appendText, '// ');
	});

	test('inTokenTypes filters by cursor token type', () => {
		const support = new OnEnterSupport({
			onEnterRules: [{
				beforeText: /\/\/.*/,
				inTokenTypes: [StandardTokenType.Comment],
				action: { indentAction: IndentAction.None, appendText: '// ' }
			}]
		});

		// Cursor in comment -> rule fires
		const result1 = support.onEnter(EditorAutoIndentStrategy.Advanced, '', '// hello', '', undefined, undefined, undefined, StandardTokenType.Comment);
		assert.strictEqual(result1?.appendText, '// ');

		// Cursor in string -> rule skipped
		const result2 = support.onEnter(EditorAutoIndentStrategy.Advanced, '', '// hello', '', undefined, undefined, undefined, StandardTokenType.String);
		assert.strictEqual(result2, null);

		// No cursor token type -> rule fires (backwards compatibility)
		const result3 = support.onEnter(EditorAutoIndentStrategy.Advanced, '', '// hello', '');
		assert.strictEqual(result3?.appendText, '// ');
	});

	test('issue #141816', () => {
		const support = new OnEnterSupport({
			onEnterRules: javascriptOnEnterRules
		});
		const testIndentAction = (beforeText: string, afterText: string, expected: IndentAction) => {
			const actual = support.onEnter(EditorAutoIndentStrategy.Advanced, '', beforeText, afterText);
			if (expected === IndentAction.None) {
				assert.strictEqual(actual, null);
			} else {
				assert.strictEqual(actual!.indentAction, expected);
			}
		};

		testIndentAction('const r = /{/;', '', IndentAction.None);
		testIndentAction('const r = /{[0-9]/;', '', IndentAction.None);
		testIndentAction('const r = /[a-zA-Z]{/;', '', IndentAction.None);
	});
});
