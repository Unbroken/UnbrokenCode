/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../base/browser/dom.js';
import { renderStyledText } from '../../base/browser/ui/highlightedlabel/highlightedLabel.js';
import { CancellationToken, CancellationTokenSource } from '../../base/common/cancellation.js';
import { DisposableStore, IDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { splitLines } from '../../base/common/strings.js';
import { URI } from '../../base/common/uri.js';
import { FontInfo } from '../common/config/fontInfo.js';
import { CodeFragmentFormattingOptions, CodeFragmentKind, findQuotedCodeFragments } from '../common/languages/codeFragments.js';
import { ICodeFragmentService } from '../common/services/codeFragmentService.js';
import './codeFragmentRenderer.css';
import { applyFontInfo } from './config/domFontInfo.js';
import { FontMeasurements } from './config/fontMeasurements.js';
import { createBareFontInfoFromRawSettings } from '../common/config/fontInfoFromSettings.js';
import { IEditorOptions } from '../common/config/editorOptions.js';
import { PixelRatio } from '../../base/browser/pixelRatio.js';

/**
 * Sets an element's children, which can be too many to pass to dom.reset as arguments, as for a message of many lines.
 */
function resetChildren(element: HTMLElement, children: ReadonlyArray<HTMLElement | string>): void {
	dom.clearNode(element);
	for (const child of children) {
		element.append(child);
	}
}

/**
 * How a hover lays out the code it shows over lines.
 */
export interface ICodeFragmentHoverOptions {
	/**
	 * The font code is shown in, which sets how many columns fit the hover.
	 */
	readonly fontInfo: FontInfo;
	readonly tabSize: number;
	/**
	 * The window the code is shown in, whose width a hover can't be wider than. Otherwise the active window's.
	 */
	readonly targetWindow?: Window;
	/**
	 * The width, in pixels, of where code is shown, such as the message of a widget in an editor, rather than a hover's.
	 */
	readonly width?: number;
	/**
	 * The columns that come before the message on its first line, such as the file and position of related information,
	 * which count towards whether a line is too long for the width.
	 */
	readonly lineStartColumns?: number;
}

/**
 * The font of editors, which hovers outside editors show code in.
 */
export function readEditorFontInfo(targetWindow: Window, editorOptions: IEditorOptions | undefined): FontInfo {
	return FontMeasurements.readFontInfo(targetWindow, createBareFontInfoFromRawSettings(editorOptions ?? {}, PixelRatio.getInstance(targetWindow).value));
}

// The width code is laid out to fit: the maximum width of workbench hovers, from hover.css, which editor hovers grow to as
// well, wider than the 500 pixels of Markdown hovers, which codeFragmentRenderer.css lifts for the hovers that show code,
// so that long types take fewer lines. It includes the hover's border and the padding of its contents.
const hoverMaxWidth = 700;
const hoverChromeWidth = 2 + 16;
// The margin editor hovers keep from the edges of a window narrower than they would be
const hoverWindowMargin = 14;
// Code laid out over lines is indented below the line it is quoted in
const blockIndentColumns = 2;

function getFormattingOptions(options: ICodeFragmentHoverOptions): CodeFragmentFormattingOptions {
	// A block takes the columns of its indentation, and of the padding and border of its background. A hover is no wider
	// than the window, less the margin hovers keep from its edges.
	const windowWidth = (options.targetWindow ?? dom.getActiveWindow()).innerWidth;
	const hoverWidth = windowWidth > 0 ? Math.min(hoverMaxWidth, windowWidth - hoverWindowMargin) : hoverMaxWidth;
	const width = options.width ?? hoverWidth - hoverChromeWidth;
	const columns = Math.floor((width - 2 * (codePadding + 1)) / options.fontInfo.typicalHalfwidthCharacterWidth);
	return { maxColumns: Math.max(20, columns - blockIndentColumns), tabSize: options.tabSize, insertSpaces: true };
}

// The padding at the sides of the background of code, as the Markdown preview has it
const codePadding = 3;

/**
 * The fonts of code can be pixel fonts, which blur where their text doesn't start on a whole device pixel, as code
 * within a line of text in another font usually doesn't. Once the element shows, its code moves less than a pixel
 * to start on one.
 */
function alignToDevicePixels(element: HTMLElement, getCodeElements: () => readonly HTMLElement[], targetWindow: Window | undefined, token: CancellationToken): void {
	let frames = 0;
	let passes = 0;
	const align = () => {
		if (token.isCancellationRequested) {
			return;
		}
		// The hover shows the element after it is rendered, and can still move it once while laying itself out
		if (!element.isConnected || passes++ === 0) {
			if (++frames < 60) {
				dom.scheduleAtNextAnimationFrame(dom.getWindow(element), align);
			}
			return;
		}
		const codeElements = getCodeElements();
		for (const code of codeElements) {
			code.style.position = 'relative';
			code.style.left = '';
			code.style.top = '';
		}
		// A relative position doesn't move anything else, so all can be measured before any moves
		const devicePixelRatio = dom.getWindow(element).devicePixelRatio;
		const toWholePixel = (position: number) => (Math.ceil(position * devicePixelRatio - 0.01) - position * devicePixelRatio) / devicePixelRatio;
		const offsets = codeElements.map(code => {
			const bounds = code.getBoundingClientRect();
			return { left: toWholePixel(bounds.left), top: toWholePixel(bounds.top) };
		});
		codeElements.forEach((code, index) => {
			code.style.left = `${offsets[index].left}px`;
			code.style.top = `${offsets[index].top}px`;
		});
	};
	// In the window it shows in, whose frames run while it shows, unlike those of another that can be minimized
	dom.scheduleAtNextAnimationFrame(targetWindow ?? dom.getWindow(element), align);
}

function renderCodeBlock(codeFragmentService: ICodeFragmentService, code: string, resource: URI, options: ICodeFragmentHoverOptions): HTMLElement {
	const block = dom.$('div.code-fragment-block');
	applyFontInfo(block, options.fontInfo);
	// The lines of a block are as far apart as those of the message around it, so the fonts keep one rhythm, and the
	// block is set off from the text before and after it
	// lh, in line-height, is the parent's line height. A code font much larger than the message's keeps its own lines
	// apart.
	block.style.lineHeight = `max(1lh, ${Math.ceil(options.fontInfo.fontSize * 1.2)}px)`;
	block.style.margin = `${Math.round(options.fontInfo.lineHeight / 4)}px 0`;
	// A line the code can't be broken in, such as a long name, wraps rather than making the hover scroll
	block.style.whiteSpace = 'pre-wrap';
	// Indented, on the background of code, with padding as the Markdown preview has it around code, and no wider than
	// where it's shown, breaking a line that can't break otherwise
	const indent = Math.round(blockIndentColumns * options.fontInfo.typicalHalfwidthCharacterWidth);
	block.style.marginLeft = `${indent}px`;
	// The width given, as where the code is shown, such as the message of the problem peek, can be sized by lines that
	// don't wrap
	block.style.maxWidth = options.width !== undefined ? `${Math.max(0, options.width - indent)}px` : `calc(100% - ${indent}px)`;
	block.style.boxSizing = 'border-box';
	block.style.overflowWrap = 'anywhere';
	block.style.padding = `2px ${codePadding}px 1px`;
	dom.reset(block, ...renderStyledText(code, [], codeFragmentService.getStyles(code, resource, { kind: 'quoted' })));
	return block;
}

// The shortest quoted code that a line too long for a hover shows in a block of its own, rather than a word such as this
const minimumBlockColumns = 20;

function renderCodeSpan(codeFragmentService: ICodeFragmentService, code: string, resource: URI, options: ICodeFragmentHoverOptions): HTMLElement {
	// Code, on the background of inline code, which fits the font and sits in the middle of the line, as the Markdown
	// preview has it
	const span = dom.$('code.code-fragment-inline');
	applyFontInfo(span, options.fontInfo);
	span.style.lineHeight = `${options.fontInfo.fontSize}px`;
	span.style.verticalAlign = 'middle';
	span.style.padding = `2px ${codePadding}px 1px`;
	// A block within the line, whose line makes room for its padding and border, so the code of the lines before and
	// after doesn't cover it, which wraps within where it's shown
	span.style.display = 'inline-block';
	// Its box is as tall as the line, so it keeps apart from code above and below, as the text's own leading does
	span.style.margin = `${Math.max(2, Math.round(options.fontInfo.lineHeight / 8))}px 0`;
	span.style.maxWidth = '100%';
	span.style.boxSizing = 'border-box';
	span.style.overflowWrap = 'anywhere';
	dom.reset(span, ...renderStyledText(code, [], codeFragmentService.getStyles(code, resource, { kind: 'quoted' })));
	return span;
}

/**
 * The nodes of a message, its lines separated by line breaks, with the code it quotes colored. In a hover, the quoted
 * code shows without the quotes, in the font of code and as formatted, if it was: the code that was laid out over lines,
 * and the longer code of a line too long for the hover, in blocks of their own, and the rest within the line.
 */
function renderMessage(codeFragmentService: ICodeFragmentService, message: string, resource: URI, layouts?: { readonly formatted: ReadonlyMap<string, string>; readonly options: ICodeFragmentHoverOptions }): Array<HTMLElement | string> {
	const children: Array<HTMLElement | string> = [];
	let afterBlock = false;
	const addText = (text: string) => {
		if (text) {
			for (const node of renderStyledText(text, [], codeFragmentService.getQuotedCodeStyles(text, resource))) {
				children.push(node);
			}
			afterBlock = false;
		}
	};

	for (const [index, line] of splitLines(message).entries()) {
		// A block ends its line
		if (index > 0 && !afterBlock) {
			children.push(dom.$('br'));
		}
		afterBlock = false;

		let offset = 0;
		const lineTooLong = !!layouts && (index === 0 ? layouts.options.lineStartColumns ?? 0 : 0) + line.length > getFormattingOptions(layouts.options).maxColumns + blockIndentColumns;
		let afterBlockInLine = false;
		for (const fragment of layouts ? findQuotedCodeFragments(line) : []) {
			const code = line.substring(fragment.start, fragment.end);
			const formatted = layouts!.formatted.get(code);
			const before = line.substring(offset, fragment.start - 1);
			if (formatted?.includes('\n') || (lineTooLong && code.length >= minimumBlockColumns)) {
				addText(afterBlockInLine ? before.trim() : before.trimEnd());
				children.push(renderCodeBlock(codeFragmentService, formatted ?? code, resource, layouts!.options));
				afterBlock = afterBlockInLine = true;
			} else {
				addText(afterBlockInLine ? before.trimStart() : before);
				children.push(renderCodeSpan(codeFragmentService, formatted ?? code, resource, layouts!.options));
				afterBlock = afterBlockInLine = false;
			}
			offset = fragment.end + 1;
		}
		const after = line.substring(offset);
		addText(afterBlockInLine ? after.trimStart() : after);
	}
	return children;
}

function getCodeElements(children: readonly (HTMLElement | string)[]): HTMLElement[] {
	return children.filter((child): child is HTMLElement => typeof child !== 'string' && (child.classList.contains('code-fragment-block') || child.classList.contains('code-fragment-inline')));
}

function getQuotedCode(message: string): string[] {
	const fragments = new Set<string>();
	for (const line of splitLines(message)) {
		for (const fragment of findQuotedCodeFragments(line)) {
			fragments.add(line.substring(fragment.start, fragment.end));
		}
	}
	return [...fragments];
}

/**
 * The code a message quotes as the extension for the language formats it: laid out over lines when too long for the
 * width, and else on one line, written the way it writes code, so that code that fits is written like code that doesn't.
 */
async function formatQuotedCode(codeFragmentService: ICodeFragmentService, message: string, resource: URI, options: ICodeFragmentHoverOptions, token: CancellationToken): Promise<Map<string, string>> {
	const formattingOptions = getFormattingOptions(options);
	const fragments = codeFragmentService.canFormat(resource) ? getQuotedCode(message) : [];
	const formatted = new Map<string, string>();
	if (fragments.length) {
		const results = await codeFragmentService.format(fragments, resource, formattingOptions, token);
		fragments.forEach((fragment, index) => {
			const result = results[index];
			if (result !== undefined) {
				formatted.set(fragment, result);
			}
		});
	}
	return formatted;
}

/**
 * Renders a message, such as a compiler error, into an element, its lines separated by line breaks, coloring the code
 * it quotes as code of the language of the resource it is about, and again when the coloring changes. In a hover, the
 * quoted code is formatted by the extension that does that for the language, if any, laid out over lines where it is
 * too long for the hover, when it has, after which `onDidLayout` is called.
 */
export function renderMessageWithQuotedCode(codeFragmentService: ICodeFragmentService, element: HTMLElement, message: string, resource: URI, hover?: ICodeFragmentHoverOptions & { readonly onDidLayout?: () => void; readonly previousLayouts?: Map<string, string> }): IDisposable {
	const store = new DisposableStore();
	const cancellation = new CancellationTokenSource();
	store.add(toDisposable(() => cancellation.dispose(true)));
	let layouts: { formatted: ReadonlyMap<string, string>; options: ICodeFragmentHoverOptions } | undefined;
	let codeElements: HTMLElement[] = [];
	const render = () => {
		const children = renderMessage(codeFragmentService, message, resource, layouts);
		codeElements = getCodeElements(children);
		resetChildren(element, children);
		if (codeElements.length) {
			alignToDevicePixels(element, () => codeElements, hover?.targetWindow, cancellation.token);
		}
	};

	// Only the hovers of languages that extensions lay out code for show quoted code in blocks, which can change, as when
	// an extension activates. The layouts of the message's previous rendering, such as for another width, show until
	// those for this one arrive, rather than none.
	let request: CancellationTokenSource | undefined;
	store.add(toDisposable(() => request?.dispose(true)));
	const layOutAndRender = () => {
		const layOut = hover && codeFragmentService.canFormat(resource) ? hover : undefined;
		// Whether code is laid out changes the layout before any layouts arrive, as longer code goes in blocks
		const laidOut = !!layouts;
		layouts = layOut && { formatted: new Map(layouts?.formatted ?? layOut.previousLayouts ?? []), options: layOut };
		render();
		if (laidOut !== !!layOut) {
			hover?.onDidLayout?.();
		}
		// A newer request replaces the one before, whose layouts would be stale
		request?.dispose(true);
		request = undefined;
		if (!layOut) {
			return;
		}
		const current = request = new CancellationTokenSource(cancellation.token);
		formatQuotedCode(codeFragmentService, message, resource, layOut, current.token).then(formatted => {
			if (current.token.isCancellationRequested) {
				return;
			}
			const shown = layouts?.formatted;
			if (layOut.previousLayouts) {
				layOut.previousLayouts.clear();
				formatted.forEach((layout, code) => layOut.previousLayouts!.set(code, layout));
			}
			if (formatted.size || shown?.size) {
				layouts = { formatted, options: layOut };
				render();
				layOut.onDidLayout?.();
			}
		});
	};
	layOutAndRender();
	store.add(codeFragmentService.onDidChange(layOutAndRender));
	return store;
}

/**
 * The content of a hover that shows a message, such as a compiler error, with the code it quotes colored and formatted,
 * laid out over lines where it is too long for the hover, like {@link renderMessageWithQuotedCode}.
 */
export async function renderMessageHover(codeFragmentService: ICodeFragmentService, message: string, resource: URI, options: ICodeFragmentHoverOptions, token: CancellationToken): Promise<HTMLElement> {
	const formatted = await formatQuotedCode(codeFragmentService, message, resource, options, token);
	const element = dom.$('div.code-fragment-hover');
	element.style.whiteSpace = 'pre-wrap';
	const children = renderMessage(codeFragmentService, message, resource, { formatted, options });
	resetChildren(element, children);
	alignToDevicePixels(element, () => getCodeElements(children), options.targetWindow, token);
	return element;
}

/**
 * The content of a hover that shows a piece of code, such as the type of a debugger variable, colored, and formatted by
 * the extension that does that for the language, if any, laid out over lines when it is too long for the hover.
 */
export async function renderCodeHover(codeFragmentService: ICodeFragmentService, code: string, resource: URI, options: ICodeFragmentHoverOptions, token: CancellationToken, kind: CodeFragmentKind = 'type'): Promise<HTMLElement> {
	// The code isn't indented below a line, so it has the columns of the indentation too
	const formattingOptions = getFormattingOptions(options);
	const maxColumns = formattingOptions.maxColumns + blockIndentColumns;
	let formatted: string | undefined;
	// Formatted also when it fits, so it is written like code that doesn't. Code that's already on lines of its own, such
	// as a debugger's value, is shown as it is: fragments to format are on one line.
	if (!/[\r\n]/.test(code)) {
		[formatted] = await codeFragmentService.format([code], resource, { ...formattingOptions, maxColumns }, token);
	}
	const text = formatted ?? code;
	const element = dom.$('div.code-fragment-hover');
	applyFontInfo(element, options.fontInfo);
	// A line the code can't be broken in, such as a long name, wraps rather than making the hover scroll
	element.style.whiteSpace = 'pre-wrap';
	dom.reset(element, ...renderStyledText(text, [], codeFragmentService.getStyles(text, resource, { kind })));
	alignToDevicePixels(element, () => [element], options.targetWindow, token);
	return element;
}
