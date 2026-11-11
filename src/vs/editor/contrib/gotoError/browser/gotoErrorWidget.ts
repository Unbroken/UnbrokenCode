/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import * as aria from '../../../../base/browser/ui/aria/aria.js';
import { ScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { isNonEmptyArray } from '../../../../base/common/arrays.js';
import { Color } from '../../../../base/common/color.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore, dispose, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { splitLines } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import './media/gotoErrorWidget.css';
import { renderMessageWithQuotedCode } from '../../../browser/codeFragmentRenderer.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { Range } from '../../../common/core/range.js';
import { ScrollType } from '../../../common/editorCommon.js';
import { ICodeFragmentService } from '../../../common/services/codeFragmentService.js';
import { peekViewTitleForeground, peekViewTitleInfoForeground, PeekViewWidget } from '../../peekView/browser/peekView.js';
import * as nls from '../../../../nls.js';
import { getFlatActionBarActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IMarker, IRelatedInformation, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { SeverityIcon } from '../../../../base/browser/ui/severityIcon/severityIcon.js';
import { contrastBorder, editorBackground, editorErrorBorder, editorErrorForeground, editorInfoBorder, editorInfoForeground, editorWarningBorder, editorWarningForeground, oneOf, registerColor, transparent } from '../../../../platform/theme/common/colorRegistry.js';
import { IColorTheme, IThemeService } from '../../../../platform/theme/common/themeService.js';

class MessageWidget {

	private _lines: number = 0;
	private _longestLineLength: number = 0;
	private _extraHeight: number = 0;

	private readonly _editor: ICodeEditor;
	private readonly _messageBlock: HTMLDivElement;
	private readonly _relatedBlock: HTMLDivElement;
	private readonly _scrollable: ScrollableElement;
	private readonly _relatedDiagnostics = new WeakMap<HTMLElement, IRelatedInformation>();
	private readonly _disposables: DisposableStore = new DisposableStore();
	private readonly _messageDisposables = new DisposableStore();
	private readonly _domNode: HTMLElement;
	private readonly _measurement = new MutableDisposable();
	private _width: number | undefined;
	private _marker: IMarker | undefined;
	private _layoutWidth: number | undefined;
	private _pendingScrollPosition: { scrollTop: number; scrollLeft: number } | undefined;
	private _laysOutCode = false;
	private _contentHeight = 0;
	// By message, the layouts of its code, which show while it is laid out for another width
	private readonly _layouts = new Map<string, Map<string, string>>();

	private _codeLink?: HTMLElement;

	constructor(
		parent: HTMLElement,
		editor: ICodeEditor,
		onRelatedInformation: (related: IRelatedInformation) => void,
		private readonly _openerService: IOpenerService,
		private readonly _labelService: ILabelService,
		private readonly _codeFragmentService: ICodeFragmentService,
		private readonly _onDidChangeHeight: () => void,
		private readonly _isHeightDragged: () => boolean
	) {
		this._editor = editor;
		this._disposables.add(this._messageDisposables);
		this._disposables.add(this._measurement);

		const domNode = this._domNode = document.createElement('div');
		domNode.className = 'descriptioncontainer';

		this._messageBlock = document.createElement('div');
		this._messageBlock.classList.add('message');
		this._messageBlock.setAttribute('aria-live', 'assertive');
		this._messageBlock.setAttribute('role', 'alert');
		domNode.appendChild(this._messageBlock);

		this._relatedBlock = document.createElement('div');
		domNode.appendChild(this._relatedBlock);
		this._disposables.add(dom.addStandardDisposableListener(this._relatedBlock, 'click', event => {
			event.preventDefault();
			const related = this._relatedDiagnostics.get(event.target);
			if (related) {
				onRelatedInformation(related);
			}
		}));

		this._scrollable = new ScrollableElement(domNode, {
			horizontal: ScrollbarVisibility.Auto,
			vertical: ScrollbarVisibility.Auto,
			useShadows: false,
			horizontalScrollbarSize: 6,
			verticalScrollbarSize: 6
		});
		parent.appendChild(this._scrollable.getDomNode());
		this._disposables.add(this._scrollable.onScroll(e => {
			domNode.style.left = `-${e.scrollLeft}px`;
			domNode.style.top = `-${e.scrollTop}px`;
		}));
		this._disposables.add(this._scrollable);
	}

	dispose(): void {
		dispose(this._disposables);
	}

	/**
	 * Renders a message, with the code it quotes colored, and laid out like in hovers, in blocks of its own where it is
	 * long, when extensions lay out the code of the resource's language.
	 */
	private _addMessage(element: HTMLElement, message: string, resource: URI, label = ''): void {
		// The widget measures what it shows when a message of the problem, its related information or a sub-problem, can
		// have code laid out in blocks, whose lines it doesn't count
		this._laysOutCode ||= this._codeFragmentService.canFormat(resource);
		const fontInfo = this._editor.getOption(EditorOption.fontInfo);
		// The message's container is padded 20 pixels at the start and 12 at the end, and a sub-problem is indented 16
		const width = (this._layoutWidth ?? this._editor.getLayoutInfo().contentWidth) - 48;
		this._messageDisposables.add(renderMessageWithQuotedCode(this._codeFragmentService, element, message, resource, {
			fontInfo,
			tabSize: this._editor.getModel()?.getOptions().tabSize ?? 4,
			width,
			targetWindow: dom.getWindow(this._editor.getDomNode()),
			// The label of related information or a sub-problem, its file and position, comes first on its line
			lineStartColumns: label.length,
			onDidLayout: () => {
				// An extension that lays out code can register after the message showed
				this._laysOutCode = true;
				this._measure();
			},
			previousLayouts: this._getLayouts(message),
		}));
	}

	private _getLayouts(message: string): Map<string, string> {
		let layouts = this._layouts.get(message);
		if (!layouts) {
			layouts = new Map();
			this._layouts.set(message, layouts);
		}
		return layouts;
	}

	/**
	 * Code laid out in blocks takes lines the message's lines don't count, so the widget takes the height and width of
	 * what it shows once that has been laid out.
	 */
	private _measure(): void {
		this._measurement.value = dom.scheduleAtNextAnimationFrame(dom.getWindow(this._domNode), () => {
			if (!this._domNode.isConnected) {
				return;
			}
			// The container holds the margins of the blocks of code, which can collapse through the elements around them,
			// and its own padding, which its content scrolls with
			const lineHeight = this._editor.getOption(EditorOption.lineHeight);
			const height = this._domNode.scrollHeight;
			const paddingTop = parseFloat(dom.getComputedStyle(this._domNode).paddingTop) || 0;
			const lines = Math.max(1, Math.ceil((height - paddingTop) / lineHeight));
			this._contentHeight = height;
			this._scrollable.setScrollDimensions({ scrollWidth: this._domNode.scrollWidth });
			this._updateScrollHeight();
			if (this._pendingScrollPosition) {
				this._scrollable.setScrollPosition(this._pendingScrollPosition);
				this._pendingScrollPosition = undefined;
			}
			if (lines !== this._lines || this._extraHeight) {
				this._lines = lines;
				this._extraHeight = 0;
				this._onDidChangeHeight();
			}
		});
	}

	update(marker: IMarker, announce = true): void {
		// Laying the code out again keeps where it is scrolled to, once the content's size is measured. Laid out again
		// before that, it keeps where it was scrolled to first, as the content can't be scrolled as far until measured.
		if (!announce && !this._pendingScrollPosition) {
			const { scrollTop, scrollLeft } = this._scrollable.getScrollPosition();
			this._pendingScrollPosition = { scrollTop, scrollLeft };
		}
		if (marker !== this._marker) {
			this._layouts.clear();
		}
		this._marker = marker;
		this._layoutWidth = this._width ?? this._editor.getLayoutInfo().contentWidth;
		this._laysOutCode = false;
		const { source, message, relatedInformation, subProblems, code } = marker;
		let sourceAndCodeLength = (source?.length || 0) + '()'.length;
		if (code) {
			if (typeof code === 'string') {
				sourceAndCodeLength += code.length;
			} else {
				sourceAndCodeLength += code.value.length;
			}
		}

		const lines = splitLines(message);
		this._messageDisposables.clear();
		this._lines = lines.length;
		this._longestLineLength = 0;
		this._extraHeight = 0;
		for (const line of lines) {
			this._longestLineLength = Math.max(line.length + sourceAndCodeLength, this._longestLineLength);
		}

		dom.clearNode(this._messageBlock);
		this._messageBlock.setAttribute('aria-label', this.getAriaLabel(marker));
		if (announce) {
			aria.status(this.getAriaLabel(marker));
		}
		this._editor.applyFontInfo(this._messageBlock);
		let lastLineElement = this._messageBlock;
		for (const line of lines) {
			lastLineElement = document.createElement('div');
			this._addMessage(dom.append(lastLineElement, dom.$('span')), line, marker.resource);
			if (line === '') {
				lastLineElement.style.height = this._messageBlock.style.lineHeight;
			}
			this._messageBlock.appendChild(lastLineElement);
		}
		if (source || code) {
			const detailsElement = document.createElement('span');
			detailsElement.classList.add('details');
			lastLineElement.appendChild(detailsElement);
			if (source) {
				const sourceElement = document.createElement('span');
				sourceElement.innerText = source;
				sourceElement.classList.add('source');
				detailsElement.appendChild(sourceElement);
			}
			if (code) {
				if (typeof code === 'string') {
					const codeElement = document.createElement('span');
					codeElement.innerText = `(${code})`;
					codeElement.classList.add('code');
					detailsElement.appendChild(codeElement);
				} else {
					this._codeLink = dom.$('a.code-link');
					this._codeLink.setAttribute('href', `${code.target.toString()}`);

					this._codeLink.onclick = (e) => {
						this._openerService.open(code.target);
						e.preventDefault();
						e.stopPropagation();
					};

					const codeElement = dom.append(this._codeLink, dom.$('span'));
					codeElement.innerText = code.value;
					detailsElement.appendChild(this._codeLink);
				}
			}
		}

		dom.clearNode(this._relatedBlock);
		this._editor.applyFontInfo(this._relatedBlock);
		if (isNonEmptyArray(relatedInformation)) {
			const relatedInformationNode = this._relatedBlock.appendChild(document.createElement('div'));
			relatedInformationNode.style.paddingTop = `${Math.floor(this._editor.getOption(EditorOption.lineHeight) * 0.66)}px`;
			this._lines += 1;

			for (const related of relatedInformation) {

				const container = document.createElement('div');

				const relatedResource = document.createElement('a');
				relatedResource.classList.add('filename');
				const relatedLabel = `${this._labelService.getUriBasenameLabel(related.resource)}(${related.startLineNumber}, ${related.startColumn}): `;
				relatedResource.innerText = relatedLabel;
				relatedResource.title = this._labelService.getUriLabel(related.resource);
				this._relatedDiagnostics.set(relatedResource, related);

				const relatedMessage = document.createElement('span');
				this._addMessage(relatedMessage, related.message, related.resource, relatedLabel);

				container.appendChild(relatedResource);
				container.appendChild(relatedMessage);

				this._lines += 1;
				relatedInformationNode.appendChild(container);
			}
		}

		// Display subProblems grouped by category
		if (subProblems && subProblems.length > 0) {
			const subProblemsNode = this._relatedBlock.appendChild(document.createElement('div'));
			const subProblemsPadding = Math.floor(this._editor.getOption(EditorOption.lineHeight) * 0.66);
			subProblemsNode.style.paddingTop = `${subProblemsPadding}px`;
			this._lines += 1;
			this._extraHeight += subProblemsPadding; // Account for the padding-top

			for (const categoryGroup of subProblems) {
				// Add category header
				const categoryHeader = document.createElement('div');
				categoryHeader.style.fontWeight = 'bold';
				categoryHeader.style.marginTop = '4px';
				categoryHeader.innerText = `${categoryGroup.category}:`;
				subProblemsNode.appendChild(categoryHeader);
				this._lines += 1;
				this._extraHeight += 4; // Account for the 4px margin-top

				// Add sub-problems under this category
				for (const resourceMarker of categoryGroup.problems) {
					const container = document.createElement('div');
					container.style.marginLeft = '16px'; // Indent sub-problems

					const fileLabel = `${this._labelService.getUriBasenameLabel(resourceMarker.resource)}(${resourceMarker.marker.startLineNumber}, ${resourceMarker.marker.startColumn}): `;
					const subResource = document.createElement('a');
					subResource.classList.add('filename');
					subResource.innerText = fileLabel;
					subResource.title = this._labelService.getUriLabel(resourceMarker.resource);

					// Create a related information object from the resource marker
					const relatedInfo: IRelatedInformation = {
						resource: resourceMarker.resource,
						message: resourceMarker.marker.message,
						startLineNumber: resourceMarker.marker.startLineNumber,
						startColumn: resourceMarker.marker.startColumn,
						endLineNumber: resourceMarker.marker.endLineNumber,
						endColumn: resourceMarker.marker.endColumn
					};
					this._relatedDiagnostics.set(subResource, relatedInfo);

					const subMessage = document.createElement('span');
					this._addMessage(subMessage, resourceMarker.marker.message, resourceMarker.resource, fileLabel);

					container.appendChild(subResource);
					container.appendChild(subMessage);

					// Count lines correctly for multi-line messages.
					// The first rendered line for this entry is the filename + first message line (already counted below as 1),
					// additional lines come from the remaining message lines.
					const messageLines = splitLines(resourceMarker.marker.message);
					const additionalLines = Math.max(0, messageLines.length - 1);
					this._lines += 1 + additionalLines;

					// Update longest line length to ensure horizontal scrolling accounts for these lines.
					const labelLength = fileLabel.length;
					if (messageLines.length > 0) {
						// first line includes label length
						this._longestLineLength = Math.max(this._longestLineLength, labelLength + messageLines[0].length);
						// remaining lines are just message content
						for (let i = 1; i < messageLines.length; i++) {
							this._longestLineLength = Math.max(this._longestLineLength, messageLines[i].length);
						}
					} else {
						this._longestLineLength = Math.max(this._longestLineLength, labelLength);
					}

					subProblemsNode.appendChild(container);
				}
			}
		}

		const fontInfo = this._editor.getOption(EditorOption.fontInfo);
		const scrollWidth = Math.ceil(fontInfo.typicalFullwidthCharacterWidth * this._longestLineLength * 0.75);
		const scrollHeight = fontInfo.lineHeight * this._lines + this._extraHeight;
		this._contentHeight = scrollHeight;
		this._scrollable.setScrollDimensions({ scrollWidth });
		this._updateScrollHeight();
		// Also when the widget was dragged to a height, which it only keeps when the content needs it, and the lines it
		// counts don't count all of related information that takes more than one
		if (this._laysOutCode || this._isHeightDragged()) {
			this._measure();
		}
	}

	layout(height: number, width: number): void {
		this._width = width;
		// The code of the messages is laid out again for a width a column or more away from the one it was laid out for
		const fontInfo = this._editor.getOption(EditorOption.fontInfo);
		if (this._marker && this._laysOutCode && Math.abs(width - (this._layoutWidth ?? 0)) >= fontInfo.typicalHalfwidthCharacterWidth) {
			this.update(this._marker, false);
		}
		this._scrollable.getDomNode().style.height = `${height}px`;
		this._scrollable.getDomNode().style.width = `${width}px`;
		this._scrollable.setScrollDimensions({ width, height });
		this._updateScrollHeight();
	}

	/**
	 * Content that scrolls has a line after it, which shows that it ends when it is scrolled to the end. Content that fits
	 * doesn't, as the line would make it scroll.
	 */
	private _updateScrollHeight(): void {
		const lineHeight = this._editor.getOption(EditorOption.lineHeight);
		// The height the lines of the content are estimated to take leaves out the container's padding, which what it
		// shows, once it does, has
		const contentHeight = Math.max(this._contentHeight, this._domNode.isConnected ? this._domNode.scrollHeight : 0);
		const overflows = contentHeight > this._scrollable.getScrollDimensions().height;
		this._scrollable.setScrollDimensions({ scrollHeight: overflows ? contentHeight + lineHeight : contentHeight });
	}

	getHeightInLines(): number {
		return Math.min(17, this._lines);
	}

	/**
	 * The lines of what the widget shows, however many that is.
	 */
	getContentHeightInLines(): number {
		// The lines are counted from the messages, whose related information can take more than one, so what the widget
		// shows, once it does, is measured
		if (!this._domNode.isConnected) {
			return this._lines;
		}
		const lineHeight = this._editor.getOption(EditorOption.lineHeight);
		const paddingTop = parseFloat(dom.getComputedStyle(this._domNode).paddingTop) || 0;
		return Math.max(this._lines, Math.ceil((this._domNode.scrollHeight - paddingTop) / lineHeight));
	}

	private getAriaLabel(marker: IMarker): string {
		let severityLabel = '';
		switch (marker.severity) {
			case MarkerSeverity.Error:
				severityLabel = nls.localize('Error', "Error");
				break;
			case MarkerSeverity.Warning:
				severityLabel = nls.localize('Warning', "Warning");
				break;
			case MarkerSeverity.Info:
				severityLabel = nls.localize('Info', "Info");
				break;
			case MarkerSeverity.Hint:
				severityLabel = nls.localize('Hint', "Hint");
				break;
		}

		let ariaLabel = nls.localize('marker aria', "{0}: {1} at {2}. ", severityLabel, marker.message, marker.startLineNumber + ':' + marker.startColumn);
		const model = this._editor.getModel();
		if (model && (marker.startLineNumber <= model.getLineCount()) && (marker.startLineNumber >= 1)) {
			const lineContent = model.getLineContent(marker.startLineNumber);
			ariaLabel = `${lineContent}, ${ariaLabel}`;
		}
		return ariaLabel;
	}
}

export class MarkerNavigationWidget extends PeekViewWidget {

	static readonly TitleMenu = new MenuId('gotoErrorTitleMenu');

	private _parentContainer!: HTMLElement;
	private _container!: HTMLElement;
	private _icon!: HTMLElement;
	private _message!: MessageWidget;
	private readonly _callOnDispose = new DisposableStore();
	private _severity: MarkerSeverity;
	private _backgroundColor?: Color;
	private readonly _onDidSelectRelatedInformation = new Emitter<IRelatedInformation>();
	private _heightInPixel!: number;
	private _heightInLines: number | undefined;
	private static readonly _minimumHeightInLines = 5;
	private static readonly _heightStorageKey = 'editor.problemPeek.heightInLines';

	readonly onDidSelectRelatedInformation: Event<IRelatedInformation> = this._onDidSelectRelatedInformation.event;

	constructor(
		editor: ICodeEditor,
		@IThemeService private readonly _themeService: IThemeService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IMenuService private readonly _menuService: IMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILabelService private readonly _labelService: ILabelService,
		@ICodeFragmentService private readonly _codeFragmentService: ICodeFragmentService,
		@IStorageService private readonly _storageService: IStorageService
	) {
		super(editor, { showArrow: true, showFrame: true, isAccessible: true, frameWidth: 1 }, instantiationService);
		this._severity = MarkerSeverity.Warning;
		this._backgroundColor = Color.white;

		this._applyTheme(_themeService.getColorTheme());
		this._callOnDispose.add(_themeService.onDidColorThemeChange(this._applyTheme.bind(this)));
		this._callOnDispose.add(this.editor.onDidLayoutChange(() => this._fitToEditor()));

		this.create();
	}

	private _applyTheme(theme: IColorTheme) {
		this._backgroundColor = theme.getColor(editorMarkerNavigationBackground);
		let colorId = editorMarkerNavigationError;
		let headerBackground = editorMarkerNavigationErrorHeader;

		if (this._severity === MarkerSeverity.Warning) {
			colorId = editorMarkerNavigationWarning;
			headerBackground = editorMarkerNavigationWarningHeader;
		} else if (this._severity === MarkerSeverity.Info) {
			colorId = editorMarkerNavigationInfo;
			headerBackground = editorMarkerNavigationInfoHeader;
		}

		const frameColor = theme.getColor(colorId);
		const headerBg = theme.getColor(headerBackground);

		this.style({
			arrowColor: frameColor,
			frameColor: frameColor,
			headerBackgroundColor: headerBg,
			primaryHeadingColor: theme.getColor(peekViewTitleForeground),
			secondaryHeadingColor: theme.getColor(peekViewTitleInfoForeground)
		}); // style() will trigger _applyStyles
	}

	protected override _applyStyles(): void {
		if (this._parentContainer) {
			this._parentContainer.style.backgroundColor = this._backgroundColor ? this._backgroundColor.toString() : '';
		}
		super._applyStyles();
	}

	override dispose(): void {
		this._callOnDispose.dispose();
		this._onDidSelectRelatedInformation.dispose();
		super.dispose();
	}

	focus(): void {
		this._parentContainer.focus();
	}

	protected override _fillHead(container: HTMLElement): void {
		super._fillHead(container);

		this._disposables.add(this._actionbarWidget!.actionRunner.onWillRun(e => this.editor.focus()));

		const menu = this._menuService.getMenuActions(MarkerNavigationWidget.TitleMenu, this._contextKeyService);
		const actions = getFlatActionBarActions(menu);
		this._actionbarWidget!.push(actions, { label: false, icon: true, index: 0 });
	}

	protected override _fillTitleIcon(container: HTMLElement): void {
		this._icon = dom.append(container, dom.$(''));
	}

	protected _fillBody(container: HTMLElement): void {
		this._parentContainer = container;
		container.classList.add('marker-widget');
		this._parentContainer.tabIndex = 0;
		this._parentContainer.setAttribute('role', 'tooltip');

		this._container = document.createElement('div');
		container.appendChild(this._container);

		this._message = new MessageWidget(this._container, this.editor, related => this._onDidSelectRelatedInformation.fire(related), this._openerService, this._labelService, this._codeFragmentService, () => this._relayout(), () => this._getDraggedHeightInLines() !== undefined);
		this._disposables.add(this._message);
	}

	override show(): void {
		throw new Error('call showAtMarker');
	}

	showAtMarker(marker: IMarker, markerIdx: number, markerCount: number): void {
		// update:
		// * title
		// * message
		this._container.classList.remove('stale');
		this._message.update(marker);

		// update frame color (only applied on 'show')
		this._severity = marker.severity;
		this._applyTheme(this._themeService.getColorTheme());

		// show
		const range = Range.lift(marker);
		const editorPosition = this.editor.getPosition();
		const position = editorPosition && range.containsPosition(editorPosition) ? editorPosition : range.getStartPosition();
		this._heightInLines = Math.min(this._getNeededHeightInLines(), this._getMaximumHeightInLines());
		super.show(position, this._heightInLines);

		const model = this.editor.getModel();
		if (model) {
			const detail = markerCount > 1
				? nls.localize('problems', "{0} of {1} problems", markerIdx, markerCount)
				: nls.localize('change', "{0} of {1} problem", markerIdx, markerCount);
			this.setTitle(basename(model.uri), detail);
		}
		this._icon.className = `codicon ${SeverityIcon.className(MarkerSeverity.toSeverity(this._severity))}`;

		this.editor.revealPositionInCenterIfOutsideViewport(position, ScrollType.Smooth);
		this.editor.focus();
	}

	updateMarker(marker: IMarker): void {
		this._container.classList.remove('stale');
		this._message.update(marker);
	}

	showStale() {
		this._container.classList.add('stale');
		this._relayout();
	}

	protected override _doLayoutBody(heightInPixel: number, widthInPixel: number): void {
		super._doLayoutBody(heightInPixel, widthInPixel);
		this._heightInPixel = heightInPixel;
		this._message.layout(heightInPixel, widthInPixel);
		this._container.style.height = `${heightInPixel}px`;
	}

	protected override _onWidth(widthInPixel: number): void {
		this._message.layout(this._heightInPixel, widthInPixel);
	}

	protected override _relayout(newHeightInLines?: number): void {
		// The height the sash is dragged to, which stays when the content changes, as the height the problem needs would
		// otherwise undo the drag, and for every problem after, in any editor, also after a restart
		if (newHeightInLines !== undefined) {
			this._heightInLines = newHeightInLines;
			this._storageService.store(MarkerNavigationWidget._heightStorageKey, newHeightInLines, StorageScope.PROFILE, StorageTarget.MACHINE);
			super._relayout(newHeightInLines);
		} else {
			this._heightInLines = Math.min(this._getNeededHeightInLines(), this._getMaximumHeightInLines());
			super._relayout(this._heightInLines);
		}
	}

	/**
	 * The height the sash was last dragged to, or less when the problem fits in less, or else the height the problem
	 * needs.
	 */
	private _getNeededHeightInLines(): number {
		const draggedHeightInLines = this._getDraggedHeightInLines();
		if (draggedHeightInLines === undefined) {
			return this.computeRequiredHeight();
		}
		return Math.max(MarkerNavigationWidget._minimumHeightInLines, Math.min(draggedHeightInLines, 3 + this._message.getContentHeightInLines()));
	}

	private _getDraggedHeightInLines(): number | undefined {
		const heightInLines = this._storageService.getNumber(MarkerNavigationWidget._heightStorageKey, StorageScope.PROFILE);
		return heightInLines !== undefined && heightInLines >= MarkerNavigationWidget._minimumHeightInLines ? heightInLines : undefined;
	}

	/**
	 * The widget can take two thirds of the editor's height, also when the sash is dragged.
	 */
	protected override _getMaximumHeightInLines(): number {
		const maximum = Math.floor(this.editor.getLayoutInfo().height * 0.66 / this.editor.getOption(EditorOption.lineHeight));
		return Math.max(MarkerNavigationWidget._minimumHeightInLines + 1, maximum);
	}

	protected override _getResizeBounds(): { readonly minLines: number; readonly maxLines: number } {
		// The sash moves only between the bounds, so the maximum itself is one more
		return { minLines: MarkerNavigationWidget._minimumHeightInLines, maxLines: this._getMaximumHeightInLines() + 1 };
	}

	/**
	 * The widget follows the editor's height: smaller with it when it would be taller than it can be, and back to the
	 * height it wants when the editor grows again.
	 */
	private _fitToEditor(): void {
		if (this._heightInLines !== undefined) {
			this._relayout();
		}
	}

	private computeRequiredHeight() {
		return 3 + this._message.getHeightInLines();
	}
}

// theming

const errorDefault = oneOf(editorErrorForeground, editorErrorBorder);
const warningDefault = oneOf(editorWarningForeground, editorWarningBorder);
const infoDefault = oneOf(editorInfoForeground, editorInfoBorder);

const editorMarkerNavigationError = registerColor('editorMarkerNavigationError.background', { dark: errorDefault, light: errorDefault, hcDark: contrastBorder, hcLight: contrastBorder }, nls.localize('editorMarkerNavigationError', 'Editor marker navigation widget error color.'));
const editorMarkerNavigationErrorHeader = registerColor('editorMarkerNavigationError.headerBackground', { dark: transparent(editorMarkerNavigationError, .1), light: transparent(editorMarkerNavigationError, .1), hcDark: null, hcLight: null }, nls.localize('editorMarkerNavigationErrorHeaderBackground', 'Editor marker navigation widget error heading background.'));

const editorMarkerNavigationWarning = registerColor('editorMarkerNavigationWarning.background', { dark: warningDefault, light: warningDefault, hcDark: contrastBorder, hcLight: contrastBorder }, nls.localize('editorMarkerNavigationWarning', 'Editor marker navigation widget warning color.'));
const editorMarkerNavigationWarningHeader = registerColor('editorMarkerNavigationWarning.headerBackground', { dark: transparent(editorMarkerNavigationWarning, .1), light: transparent(editorMarkerNavigationWarning, .1), hcDark: '#0C141F', hcLight: transparent(editorMarkerNavigationWarning, .2) }, nls.localize('editorMarkerNavigationWarningBackground', 'Editor marker navigation widget warning heading background.'));

const editorMarkerNavigationInfo = registerColor('editorMarkerNavigationInfo.background', { dark: infoDefault, light: infoDefault, hcDark: contrastBorder, hcLight: contrastBorder }, nls.localize('editorMarkerNavigationInfo', 'Editor marker navigation widget info color.'));
const editorMarkerNavigationInfoHeader = registerColor('editorMarkerNavigationInfo.headerBackground', { dark: transparent(editorMarkerNavigationInfo, .1), light: transparent(editorMarkerNavigationInfo, .1), hcDark: null, hcLight: null }, nls.localize('editorMarkerNavigationInfoHeaderBackground', 'Editor marker navigation widget info heading background.'));

const editorMarkerNavigationBackground = registerColor('editorMarkerNavigation.background', editorBackground, nls.localize('editorMarkerNavigationBackground', 'Editor marker navigation widget background.'));
