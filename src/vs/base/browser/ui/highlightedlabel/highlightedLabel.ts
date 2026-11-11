/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../dom.js';
import type { IManagedHover, IManagedHoverTooltipHTMLElement } from '../hover/hover.js';
import { IHoverDelegate } from '../hover/hoverDelegate.js';
import { getBaseLayerHoverDelegate } from '../hover/hoverDelegate2.js';
import { getDefaultHoverDelegate } from '../hover/hoverDelegateFactory.js';
import { renderLabelWithIcons } from '../iconLabel/iconLabels.js';
import { Disposable } from '../../../common/lifecycle.js';
import * as objects from '../../../common/objects.js';

/**
 * A range to be highlighted.
 */
export interface IHighlight {
	start: number;
	end: number;
	readonly extraClasses?: readonly string[];
}

/**
 * A range of a label that CSS classes style, such as the token classes that color code.
 */
export interface IStyledRange {
	readonly start: number;
	readonly end: number;
	readonly classNames: readonly string[];
}

/**
 * The nodes of a text with highlights and styled ranges, each sorted and without overlaps among their own kind. A
 * highlight that overlaps a styled range is styled too.
 */
export function renderStyledText(text: string, highlights: readonly IHighlight[], styles: readonly IStyledRange[]): Array<HTMLSpanElement | string> {
	const boundaries = new Set<number>([0, text.length]);
	for (const range of [...highlights, ...styles]) {
		boundaries.add(Math.max(0, Math.min(range.start, text.length)));
		boundaries.add(Math.max(0, Math.min(range.end, text.length)));
	}
	const offsets = [...boundaries].sort((a, b) => a - b);

	const children: Array<HTMLSpanElement | string> = [];
	let iHighlight = 0;
	let iStyle = 0;
	for (let i = 0; i + 1 < offsets.length; ++i) {
		const start = offsets[i];
		const end = offsets[i + 1];
		while (iHighlight < highlights.length && highlights[iHighlight].end <= start) {
			++iHighlight;
		}
		while (iStyle < styles.length && styles[iStyle].end <= start) {
			++iStyle;
		}
		const highlight = iHighlight < highlights.length && highlights[iHighlight].start <= start ? highlights[iHighlight] : undefined;
		const style = iStyle < styles.length && styles[iStyle].start <= start ? styles[iStyle] : undefined;
		const substring = text.substring(start, end);
		if (!highlight && !style) {
			children.push(substring);
			continue;
		}
		let element = dom.$(highlight ? 'span.highlight' : 'span', undefined, substring);
		if (highlight?.extraClasses) {
			element.classList.add(...highlight.extraClasses);
		}
		if (style) {
			// The highlight goes inside the styled range, so a highlight that unsets its color, as filter matches can,
			// takes the range's color
			element = highlight ? dom.$('span', undefined, element) : element;
			element.classList.add(...style.classNames);
		}
		children.push(element);
	}
	return children;
}

export interface IHighlightedLabelOptions {
	readonly hoverDelegate?: IHoverDelegate;
}

/**
 * A widget which can render a label with substring highlights, often
 * originating from a filter function like the fuzzy matcher.
 */
export class HighlightedLabel extends Disposable {

	private readonly domNode: HTMLElement;
	private text: string = '';
	private title: string | IManagedHoverTooltipHTMLElement = '';
	private highlights: readonly IHighlight[] = [];
	private styles: readonly IStyledRange[] = [];
	private didEverRender: boolean = false;
	private customHover: IManagedHover | undefined;

	/**
	 * Create a new {@link HighlightedLabel}.
	 *
	 * @param container The parent container to append to.
	 */
	constructor(container: HTMLElement, private readonly options?: IHighlightedLabelOptions) {
		super();

		this.domNode = dom.append(container, dom.$('span.monaco-highlighted-label'));
	}

	/**
	 * The label's DOM node.
	 */
	get element(): HTMLElement {
		return this.domNode;
	}

	/**
	 * Set the label and highlights.
	 *
	 * @param text The label to display.
	 * @param highlights The ranges to highlight.
	 * @param title An optional title for the hover tooltip, or the content of the hover, such as code laid out over lines.
	 * @param escapeNewLines Whether to escape new lines.
	 * @param supportIcons Whether to render icons, which leaves the styled ranges out.
	 * @param styles Ranges that CSS classes style, such as the token classes that color code. A label whose new lines
	 * are escaped leaves them out.
	 * @returns
	 */
	set(text: string | undefined, highlights: readonly IHighlight[] = [], title: string | IManagedHoverTooltipHTMLElement = '', escapeNewLines?: boolean, supportIcons?: boolean, styles: readonly IStyledRange[] = []) {
		if (!text) {
			text = '';
		}

		if (escapeNewLines) {
			// adjusts highlights inplace
			const escaped = HighlightedLabel.escapeNewLines(text, highlights);
			if (escaped !== text) {
				styles = [];
			}
			text = escaped;
		}

		if (this.didEverRender && this.text === text && this.title === title && objects.equals(this.highlights, highlights) && objects.equals(this.styles, styles)) {
			return;
		}

		this.text = text;
		this.title = title;
		this.highlights = highlights;
		this.styles = styles;
		this.render(supportIcons);
	}

	private render(supportIcons?: boolean): void {

		if (this.styles.length && !supportIcons) {
			dom.reset(this.domNode, ...renderStyledText(this.text, this.highlights, this.styles));
			this.renderHover();
			return;
		}

		const children: Array<HTMLSpanElement | string> = [];
		let pos = 0;

		for (const highlight of this.highlights) {
			if (highlight.end === highlight.start) {
				continue;
			}

			if (pos < highlight.start) {
				const substring = this.text.substring(pos, highlight.start);
				if (supportIcons) {
					children.push(...renderLabelWithIcons(substring, true));
				} else {
					children.push(substring);
				}
				pos = highlight.start;
			}

			const substring = this.text.substring(pos, highlight.end);
			const element = dom.$('span.highlight', undefined, ...supportIcons ? renderLabelWithIcons(substring, true) : [substring]);

			if (highlight.extraClasses) {
				element.classList.add(...highlight.extraClasses);
			}

			children.push(element);
			pos = highlight.end;
		}

		if (pos < this.text.length) {
			const substring = this.text.substring(pos,);
			if (supportIcons) {
				children.push(...renderLabelWithIcons(substring, true));
			} else {
				children.push(substring);
			}
		}

		dom.reset(this.domNode, ...children);
		this.renderHover();
	}

	private renderHover(): void {
		if (!this.customHover && this.title !== '') {
			const hoverDelegate = this.options?.hoverDelegate ?? getDefaultHoverDelegate('mouse');
			this.customHover = this._register(getBaseLayerHoverDelegate().setupManagedHover(hoverDelegate, this.domNode, this.title));
		} else if (this.customHover) {
			this.customHover.update(this.title);
		}

		this.didEverRender = true;
	}

	static escapeNewLines(text: string, highlights: readonly IHighlight[]): string {
		let total = 0;
		let extra = 0;

		return text.replace(/\r\n|\r|\n/g, (match, offset) => {
			extra = match === '\r\n' ? -1 : 0;
			offset += total;

			for (const highlight of highlights) {
				if (highlight.end <= offset) {
					continue;
				}
				if (highlight.start >= offset) {
					highlight.start += extra;
				}
				if (highlight.end >= offset) {
					highlight.end += extra;
				}
			}

			total += extra;
			return '\u23CE';
		});
	}
}
