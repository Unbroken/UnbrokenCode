/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../base/browser/dom.js';
import { renderStyledText } from '../../base/browser/ui/highlightedlabel/highlightedLabel.js';
import { IDisposable } from '../../base/common/lifecycle.js';
import { splitLines } from '../../base/common/strings.js';
import { URI } from '../../base/common/uri.js';
import { ICodeFragmentService } from '../common/services/codeFragmentService.js';

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
 * Renders a message, such as a compiler error, into an element, its lines separated by line breaks, coloring the code
 * it quotes as code of the language of the resource it is about, and again when the coloring changes.
 */
export function renderMessageWithQuotedCode(codeFragmentService: ICodeFragmentService, element: HTMLElement, message: string, resource: URI): IDisposable {
	const render = () => {
		const children: Array<HTMLElement | string> = [];
		for (const [index, line] of splitLines(message).entries()) {
			if (index > 0) {
				children.push(dom.$('br'));
			}
			for (const node of renderStyledText(line, [], codeFragmentService.getQuotedCodeStyles(line, resource))) {
				children.push(node);
			}
		}
		resetChildren(element, children);
	};
	render();
	return codeFragmentService.onDidChange(render);
}
