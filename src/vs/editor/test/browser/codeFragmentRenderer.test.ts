/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { renderCodeHover, renderMessageHover } from '../../browser/codeFragmentRenderer.js';
import { EditorFontLigatures, EditorFontVariations } from '../../common/config/editorOptions.js';
import { FontInfo } from '../../common/config/fontInfo.js';
import { CodeFragmentFormattingOptions } from '../../common/languages/codeFragments.js';
import { ICodeFragmentService, ICodeFragmentStyle } from '../../common/services/codeFragmentService.js';

class TestCodeFragmentService implements ICodeFragmentService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChange = Event.None;
	readonly requests: { fragments: readonly string[]; maxColumns: number }[] = [];

	getStyles(): readonly ICodeFragmentStyle[] {
		return [];
	}

	getQuotedCodeStyles(): readonly ICodeFragmentStyle[] {
		return [];
	}

	canColor(): boolean {
		return true;
	}

	canFormat(): boolean {
		return true;
	}

	async format(fragments: readonly string[], _resource: URI, options: CodeFragmentFormattingOptions): Promise<(string | undefined)[]> {
		this.requests.push({ fragments, maxColumns: options.maxColumns });
		// Long code is laid out over lines, and code that fits is written with a space before its *
		return fragments.map(fragment => fragment.startsWith('TCLong') ? 'TCLong\n<\n    A\n>' : fragment.endsWith('*') ? `${fragment.slice(0, -1)} *` : undefined);
	}
}

suite('Code fragment renderer', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// 10 pixels per column, so 68 columns fit a hover, 67 of them beside the padding and border of code
	const fontInfo = new FontInfo({
		pixelRatio: 1,
		fontFamily: 'mockFont',
		fontWeight: 'normal',
		fontSize: 14,
		fontFeatureSettings: EditorFontLigatures.OFF,
		fontVariationSettings: EditorFontVariations.OFF,
		lineHeight: 19,
		letterSpacing: 0,
		disableFontHinting: false,
		isMonospace: true,
		typicalHalfwidthCharacterWidth: 10,
		typicalFullwidthCharacterWidth: 20,
		canUseHalfwidthRightwardsArrow: true,
		spaceWidth: 10,
		middotWidth: 10,
		wsmiddotWidth: 10,
		maxDigitWidth: 10,
	}, true);
	const resource = URI.file('/test.cpp');

	function describe(element: HTMLElement): string[] {
		return [...element.childNodes].map(node => {
			if (!(node instanceof HTMLElement)) {
				return node.textContent ?? '';
			}
			if (node.classList.contains('code-fragment-block')) {
				return `[${node.textContent}]`;
			}
			return node.classList.contains('code-fragment-inline') ? `{${node.textContent}}` : `<${node.tagName.toLowerCase()}>`;
		});
	}

	test('message hovers lay out the quoted code too long for them in blocks, and show the rest as formatted', async () => {
		const service = new TestCodeFragmentService();
		const long = `TCLong<${'A'.repeat(80)}>`;
		const element = await renderMessageHover(service, `no conversion from '${long}' to 'TCShort*'\nnote: '${long}'`, resource, { fontInfo, tabSize: 4 }, CancellationToken.None);
		assert.deepStrictEqual({ requests: service.requests, rendered: describe(element) }, {
			requests: [{ fragments: [long, 'TCShort*'], maxColumns: 65 }],
			rendered: ['no conversion from', '[TCLong\n<\n    A\n>]', 'to ', '{TCShort *}', '<br>', 'note:', '[TCLong\n<\n    A\n>]'],
		});
	});

	test('message hovers show the longer quoted code of lines too long for them in blocks', async () => {
		const service = new TestCodeFragmentService();
		const medium = `TCMedium<${'B'.repeat(30)}>`;
		const element = await renderMessageHover(service, `candidate function not viable: 'this' argument has type '${medium}', but method is not marked const\nshort '${medium}'`, resource, { fontInfo, tabSize: 4 }, CancellationToken.None);
		assert.deepStrictEqual({ requests: service.requests, rendered: describe(element) }, {
			requests: [{ fragments: ['this', medium], maxColumns: 65 }],
			rendered: ['candidate function not viable: ', '{this}', ' argument has type', `[${medium}]`, ', but method is not marked const', '<br>', 'short ', `{${medium}}`],
		});
	});

	test('code hovers format code, laying out code too long for them', async () => {
		const service = new TestCodeFragmentService();
		const short = await renderCodeHover(service, 'TCShort*', resource, { fontInfo, tabSize: 4 }, CancellationToken.None);
		const long = await renderCodeHover(service, `TCLong<${'A'.repeat(80)}>`, resource, { fontInfo, tabSize: 4 }, CancellationToken.None);
		assert.deepStrictEqual({ requests: service.requests.length, short: short.textContent, long: long.textContent }, {
			requests: 2,
			short: 'TCShort *',
			long: 'TCLong\n<\n    A\n>',
		});
	});
});
