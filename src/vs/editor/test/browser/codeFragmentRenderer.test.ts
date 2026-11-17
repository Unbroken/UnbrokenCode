/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { renderCodeHover, renderMessageHover, renderMessageLabel } from '../../browser/codeFragmentRenderer.js';
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

	formats = true;

	canFormat(): boolean {
		return this.formats;
	}

	private readonly formatted = new Map<string, string | undefined>();

	async format(fragments: readonly string[], _resource: URI, options: CodeFragmentFormattingOptions): Promise<(string | undefined)[]> {
		this.requests.push({ fragments, maxColumns: options.maxColumns });
		// Long code is laid out over lines, and code that fits is written with a space before its *
		const results = fragments.map(fragment => fragment.startsWith('TCLong') ? 'TCLong\n<\n    A\n>' : fragment.endsWith('*') ? `${fragment.slice(0, -1)} *` : undefined);
		fragments.forEach((fragment, index) => this.formatted.set(`${options.maxColumns}\n${fragment}`, results[index]));
		return results;
	}

	getFormatted(fragments: readonly string[], _resource: URI, options: CodeFragmentFormattingOptions): ReadonlyMap<string, string | undefined> {
		const result = new Map<string, string | undefined>();
		for (const fragment of fragments) {
			const key = `${options.maxColumns}\n${fragment}`;
			if (this.formatted.has(key)) {
				result.set(fragment, this.formatted.get(key));
			}
		}
		return result;
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

	test('message labels show the quoted code on a line, as formatted once it is', async () => {
		const service = new TestCodeFragmentService();
		const describeLabel = (element: HTMLElement) => [...element.childNodes].map(node => node instanceof HTMLElement && node.classList.contains('code-fragment-label')
			? `{${node.textContent}}${node.classList.contains('code-fragment-updated') ? '!' : ''}`
			: node.textContent ?? '');
		const options = { getFontInfo: () => fontInfo, tabSize: 4 };
		const first = document.createElement('span');
		const second = document.createElement('span');
		const store = new DisposableStore();
		store.add(renderMessageLabel(service, first, 'no conversion from \'TCShort*\' to \'bool\'', resource, options));
		store.add(renderMessageLabel(service, second, 'candidate \'TCOther*\'', resource, options));
		const asQuoted = [describeLabel(first), describeLabel(second)];
		await timeout(0);
		const formatted = [describeLabel(first), describeLabel(second)];

		// Code shows as code where no extension formats it, too
		const colored = new TestCodeFragmentService();
		colored.formats = false;
		const unformatted = document.createElement('span');
		store.add(renderMessageLabel(colored, unformatted, 'candidate \'TCOther*\'', resource, options));
		await timeout(0);

		// Code that the length of the label cuts shows as code too, also when it is all the code there is
		const cut = document.createElement('span');
		store.add(renderMessageLabel(service, cut, 'candidate \'TCOther<int, bool>*\' declared here', resource, { ...options, maxLength: 14 }));

		// The layouts that are known show at once, without asking again
		const later = document.createElement('span');
		store.add(renderMessageLabel(service, later, 'again \'TCShort*\'', resource, options));
		const known = describeLabel(later);
		await timeout(0);
		store.dispose();

		assert.deepStrictEqual({ requests: service.requests, asQuoted, formatted, known, cut: describeLabel(cut), unformatted: { requests: colored.requests, rendered: describeLabel(unformatted) } }, {
			requests: [{ fragments: ['TCShort*', 'bool', 'TCOther*'], maxColumns: 100000 }],
			asQuoted: [['no conversion from ', '{TCShort*}', ' to ', '{bool}'], ['candidate ', '{TCOther*}']],
			formatted: [['no conversion from ', '{TCShort *}!', ' to ', '{bool}'], ['candidate ', '{TCOther *}!']],
			known: ['again ', '{TCShort *}'],
			cut: ['candidate ', '{TCOther}', '...'],
			unformatted: { requests: [], rendered: ['candidate ', '{TCOther*}'] },
		});
	});
});
