/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, IDomNodePagePosition } from '../../dom.js';
import { IView, IViewSize } from '../grid/grid.js';
import { IBoundarySashes, SashState } from '../sash/sash.js';
import { DistributeSizing, ISplitViewStyles, IView as ISplitViewView, Orientation, SplitView } from '../splitview/splitview.js';
import { Color } from '../../../common/color.js';
import { Event } from '../../../common/event.js';
import { DisposableStore, IDisposable } from '../../../common/lifecycle.js';
import { hasKey } from '../../../common/types.js';

export interface CenteredViewState {
	// width of the fixed centered layout
	targetWidth: number;
	// pixel offset from centered position (positive = more left margin, negative = less left margin)
	centeringOffset: number;
}

export interface CenteredViewEditorWidthConfig {
	rulers: number[];
	typicalCharWidth: number;
	contentLeft: number;
	useFixedWidth?: boolean;
	fixedWidth?: number;
	scrollbarWidth?: number;
	minimapWidth?: number;
	overscrollWidth?: number;
}

interface LegacyCenteredViewState {
	leftMarginRatio: number;
}

const defaultState: CenteredViewState = {
	targetWidth: 900,
	centeringOffset: 0,
};

const distributeSizing: DistributeSizing = { type: 'distribute' };

function createEmptyView(background: Color | undefined): ISplitViewView<{ top: number; left: number }> {
	const element = $('.centered-layout-margin');
	element.style.height = '100%';
	if (background) {
		element.style.backgroundColor = background.toString();
	}

	return {
		element,
		layout: () => undefined,
		minimumSize: 0,
		maximumSize: Number.POSITIVE_INFINITY,
		onDidChange: Event.None
	};
}

function toSplitViewView(view: IView, getHeight: () => number): ISplitViewView<{ top: number; left: number }> {
	return {
		element: view.element,
		get maximumSize() { return view.maximumWidth; },
		get minimumSize() { return view.minimumWidth; },
		onDidChange: Event.map(view.onDidChange, e => e && e.width),
		layout: (size, offset, ctx) => view.layout(size, getHeight(), ctx?.top ?? 0, (ctx?.left ?? 0) + offset)
	};
}

export interface ICenteredViewStyles extends ISplitViewStyles {
	background: Color;
}

export class CenteredViewLayout implements IDisposable {

	private splitView?: SplitView<{ top: number; left: number }>;
	private lastLayoutPosition: IDomNodePagePosition = { width: 0, height: 0, left: 0, top: 0 };
	private style!: ICenteredViewStyles;
	private didLayout = false;
	private leftMarginView: ISplitViewView<{ top: number; left: number }> | undefined;
	private rightMarginView: ISplitViewView<{ top: number; left: number }> | undefined;
	private readonly splitViewDisposables = new DisposableStore();
	private windowWidth: number = 0;
	private lastCenteredLeftMargin: number = 0;
	public state: CenteredViewState;

	constructor(
		private container: HTMLElement,
		private view: IView,
		state: CenteredViewState | LegacyCenteredViewState = { ...defaultState },
		private centeredLayoutFixedWidth: boolean = false,
		private getEditorWidthConfig: () => CenteredViewEditorWidthConfig,
		private getWindowWidth: () => number
	) {
		// Migrate old state format (leftMarginRatio) to new format (centeringOffset)
		if (hasKey(state, { leftMarginRatio: true }) || !hasKey(state, { centeringOffset: true })) {
			this.state = { ...defaultState };
		} else {
			this.state = state;
		}

		this.container.appendChild(this.view.element);
		// Make sure to hide the split view overflow like sashes #52892
		this.container.style.overflow = 'hidden';
	}

	get minimumWidth(): number { return this.splitView ? this.splitView.minimumSize : this.view.minimumWidth; }
	get maximumWidth(): number { return this.splitView ? this.splitView.maximumSize : this.view.maximumWidth; }
	get minimumHeight(): number { return this.view.minimumHeight; }
	get maximumHeight(): number { return this.view.maximumHeight; }
	get onDidChange(): Event<IViewSize | undefined> { return this.view.onDidChange; }

	private _boundarySashes: IBoundarySashes = {};
	get boundarySashes(): IBoundarySashes { return this._boundarySashes; }
	set boundarySashes(boundarySashes: IBoundarySashes) {
		this._boundarySashes = boundarySashes;

		if (!this.splitView) {
			return;
		}

		this.splitView.orthogonalStartSash = boundarySashes.top;
		this.splitView.orthogonalEndSash = boundarySashes.bottom;
	}

	layout(width: number, height: number, top: number, left: number): void {
		this.lastLayoutPosition = { width, height, top, left };
		this.windowWidth = this.getWindowWidth();

		if (this.splitView) {
			this.splitView.layout(width, this.lastLayoutPosition);
			this.resizeSplitViews();
		} else {
			this.view.layout(width, height, top, left);
		}

		this.didLayout = true;
	}

	private resizeSplitViews(): void {
		if (!this.splitView) {
			return;
		}

		let desiredCenterWidth: number;
		let desiredLeftMargin: number;
		let forceWidth = false;

		const editorWidthConfig = this.getEditorWidthConfig();

		const windowWidth = this.windowWidth > 0 ? this.windowWidth : this.lastLayoutPosition.width;
		let globalLeftMargin;

		if (editorWidthConfig.useFixedWidth && editorWidthConfig.fixedWidth || this.centeredLayoutFixedWidth) {
			if (this.centeredLayoutFixedWidth) {
				desiredCenterWidth = this.state.targetWidth;
			} else {
				desiredCenterWidth = editorWidthConfig.fixedWidth || 900;
			}
			forceWidth = true;

			globalLeftMargin = (windowWidth - desiredCenterWidth) / 2;

			const viewOffsetInWindow = this.lastLayoutPosition.left;
			desiredLeftMargin = globalLeftMargin - viewOffsetInWindow;
		} else {
			const rightmostRuler = editorWidthConfig.rulers.length > 0
				? Math.max(...editorWidthConfig.rulers)
				: 190;

			const textContentWidth = rightmostRuler * editorWidthConfig.typicalCharWidth;

			// Total width includes contentLeft (line numbers, etc.), scrollbar, minimap, and overscroll
			const scrollbarWidth = editorWidthConfig.scrollbarWidth || 0;
			const minimapWidth = editorWidthConfig.minimapWidth || 0;
			const overscrollChars = editorWidthConfig.overscrollWidth || 0;
			const overscrollWidth = overscrollChars * editorWidthConfig.typicalCharWidth;
			desiredCenterWidth = editorWidthConfig.contentLeft + textContentWidth + scrollbarWidth + minimapWidth + overscrollWidth;

			// Center based on window width and text content width only (excluding contentLeft, scrollbar, overscroll)
			globalLeftMargin = (windowWidth - textContentWidth) / 2 - editorWidthConfig.contentLeft;
		}

		// Convert from global window coordinates to local view coordinates
		const viewOffsetInWindow = this.lastLayoutPosition.left;
		const centeredLeftMargin = globalLeftMargin - viewOffsetInWindow;

		this.lastCenteredLeftMargin = Math.max(centeredLeftMargin, 0);

		// Apply user's centering offset (from dragging the splitter)
		desiredLeftMargin = centeredLeftMargin + this.state.centeringOffset;

		// If it doesn't fit, reduce left margin until it reaches 0
		if (desiredLeftMargin < 0) {
			desiredLeftMargin = 0;
		}

		// Make sure we don't exceed available width
		const availableWidth = this.lastLayoutPosition.width;
		if (desiredLeftMargin + desiredCenterWidth > availableWidth) {
			// If centered content doesn't fit, reduce left margin
			desiredLeftMargin = Math.max(0, availableWidth - desiredCenterWidth);
		}

		if (forceWidth && !this.rightMarginView) {
			const backgroundColor = this.style ? this.style.background : undefined;
			this.rightMarginView = createEmptyView(backgroundColor);
			this.splitView.addView(this.rightMarginView, distributeSizing, 2);
			this.splitView.sashes[1].state = SashState.Disabled;
		} else if (!forceWidth && this.rightMarginView) {
			this.splitView.removeView(2);
			this.rightMarginView = undefined;
		}

		if (forceWidth) {
			// 3-view layout: left margin + fixed-width content + right margin
			const actualCenterWidth = Math.min(this.lastLayoutPosition.width - desiredLeftMargin, desiredCenterWidth);
			const rightMargin = this.lastLayoutPosition.width - desiredLeftMargin - actualCenterWidth;

			this.splitView.resizeView(0, desiredLeftMargin);
			this.splitView.resizeView(1, actualCenterWidth);
			this.splitView.resizeView(2, rightMargin);
		} else {
			// 2-view layout: left margin + content (grows to fill)
			const centerWidth = this.lastLayoutPosition.width - desiredLeftMargin;
			this.splitView.resizeView(0, desiredLeftMargin);
			this.splitView.resizeView(1, centerWidth);
		}

		// Hide the left sash when left margin is too small (< 3px) to avoid interfering with other splitters
		if (this.splitView.sashes.length > 0) {
			const sash = this.splitView.sashes[0];
			sash.maxDragMargin = 3;

			if (desiredLeftMargin < 3) {
				sash.state = SashState.Disabled;
			} else {
				sash.state = SashState.Enabled;
			}
		}
	}

	setFixedWidth(option: boolean) {
		this.centeredLayoutFixedWidth = option;
		if (!!this.splitView) {
			this.updateState();
			this.resizeSplitViews();
		}
	}

	private updateState() {
		if (!this.splitView) {
			return;
		}

		const actualLeftMargin = this.splitView.getViewSize(0);

		this.state.centeringOffset = actualLeftMargin - this.lastCenteredLeftMargin;
		this.state.targetWidth = this.splitView.getViewSize(1);
	}

	isActive(): boolean {
		return !!this.splitView;
	}

	styles(style: ICenteredViewStyles): void {
		this.style = style;
		if (this.splitView) {
			this.splitView.style(this.style);
			if (this.leftMarginView) {
				this.leftMarginView.element.style.backgroundColor = this.style.background.toString();
			}
			if (this.rightMarginView) {
				this.rightMarginView.element.style.backgroundColor = this.style.background.toString();
			}
		}
	}

	activate(active: boolean): void {
		if (active === this.isActive()) {
			return;
		}

		if (active) {
			this.view.element.remove();
			this.splitView = new SplitView(this.container, {
				inverseAltBehavior: true,
				orientation: Orientation.HORIZONTAL,
				styles: this.style
			});
			this.splitView.orthogonalStartSash = this.boundarySashes.top;
			this.splitView.orthogonalEndSash = this.boundarySashes.bottom;

			this.splitViewDisposables.add(this.splitView.onDidSashChange(() => {
				if (!!this.splitView) {
					this.updateState();
				}
			}));
			this.splitViewDisposables.add(this.splitView.onDidSashReset(() => {
				this.resetToCenter();
			}));

			this.splitView.layout(this.lastLayoutPosition.width, this.lastLayoutPosition);
			const backgroundColor = this.style ? this.style.background : undefined;
			this.leftMarginView = createEmptyView(backgroundColor);

			this.splitView.addView(this.leftMarginView, distributeSizing, 0);
			this.splitView.addView(toSplitViewView(this.view, () => this.lastLayoutPosition.height), distributeSizing, 1);

			this.resizeSplitViews();
		} else {
			this.splitView?.el.remove();
			this.splitViewDisposables.clear();
			this.splitView?.dispose();
			this.splitView = undefined;
			this.leftMarginView = undefined;
			this.rightMarginView = undefined;
			this.container.appendChild(this.view.element);
			this.view.layout(this.lastLayoutPosition.width, this.lastLayoutPosition.height, this.lastLayoutPosition.top, this.lastLayoutPosition.left);
		}
	}

	isDefault(state: CenteredViewState): boolean {
		if (this.centeredLayoutFixedWidth) {
			return state.targetWidth === defaultState.targetWidth;
		} else {
			return state.centeringOffset === defaultState.centeringOffset;
		}
	}

	private resetToCenter(): void {
		// Reset to default centered position
		this.state = { ...defaultState };
		this.resizeSplitViews();
	}

	/**
	 * Force a recalculation of the centered layout.
	 * Call this when the active editor changes to update ruler/font metrics.
	 */
	recalculate(): void {
		if (this.splitView && this.didLayout) {
			this.resizeSplitViews();
		}
	}

	dispose(): void {
		this.splitViewDisposables.dispose();

		if (this.splitView) {
			this.splitView.dispose();
			this.splitView = undefined;
		}
	}
}
