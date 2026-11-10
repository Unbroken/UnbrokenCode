/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import electron from 'electron';
import { createRequire } from 'module';
import { RunOnceScheduler } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IDisplayCutout, IDisplayShape, IScreenCorner, IScreenCorners } from '../../native/common/native.js';

export const IDisplayShapeMainService = createDecorator<IDisplayShapeMainService>('displayShapeMainService');

/**
 * Fits windows to displays whose shape is not a plain rectangle, such as the
 * built-in display of recent MacBook Pros, with rounded bottom corners and a
 * camera cutout at the top: macOS grows a window's bottom corner to match the
 * display's as the window nears the display's corner, and windows can cover
 * the menu bar beside the cutout in full screen.
 */
export interface IDisplayShapeMainService {

	readonly _serviceBrand: undefined;

	/**
	 * Fires when the display shape of windows may have changed without the
	 * windows moving or resizing, such as when the displays change.
	 */
	readonly onDidChange: Event<void>;

	/**
	 * Returns how the shape of the display the given window is on reaches into
	 * the window.
	 */
	getWindowDisplayShape(window: electron.BrowserWindow): IDisplayShape;

	/**
	 * Makes the given window cover the menu bar when it is in native full screen
	 * on a display with a camera cutout, or stop doing so, from the next time it
	 * enters full screen. Covering, the window reaches beside and below the cutout
	 * rather than leave the menu bar's band black, and the menu bar only appears
	 * when the mouse reaches the cutout. Only for windows that show their own
	 * title bar in full screen, which can then flow around the cutout.
	 */
	setCoversMenuBarInFullScreen(window: electron.BrowserWindow, covers: boolean): void;

	/**
	 * Tells the given window's full screen that its level was just changed, such as by pinning
	 * it on top, which it keeps covering the menu bar with, and has as it leaves full screen.
	 */
	windowLevelDidChange(window: electron.BrowserWindow): void;
}

/**
 * The native module that reads and adapts how macOS fits windows to the display.
 */
interface IDisplayShapeModule {
	getWindowCornerRadii(nativeWindowHandle: Buffer): IWindowCornerRadii | undefined;
	getWindowDisplayCutout(nativeWindowHandle: Buffer): IDisplayCutout | undefined;
	setCoversMenuBarInFullScreen(nativeWindowHandle: Buffer, enabled: boolean): boolean;
	getWindowCoversMenuBar(nativeWindowHandle: Buffer): boolean;
	windowLevelDidChange(nativeWindowHandle: Buffer): void;
}

/**
 * The corner radii of a window, as the native module reads them.
 */
interface IWindowCornerRadii {
	readonly radius: number;
	readonly bottomLeft: number;
	readonly bottomRight: number;
}

const NO_SCREEN_CORNER: IScreenCorner = { radius: 0, reach: 0, baseRadius: 0 };
const NO_SCREEN_CORNERS: IScreenCorners = { bottomLeft: NO_SCREEN_CORNER, bottomRight: NO_SCREEN_CORNER };
export const NO_DISPLAY_SHAPE: IDisplayShape = { ...NO_SCREEN_CORNERS, cutout: undefined, coversMenuBar: false };

/**
 * macOS rounds corners with continuous curves: a circular arc of the corner's
 * radius in the middle, joined to the straight edges by transitions that start
 * bending this many radii from the corner. Measured on a 37pt display corner,
 * the arc matched a circle of that radius, and the transitions started dimming
 * a 1pt line along the edge about 54pt from the corner.
 */
const CONTINUOUS_CORNER_REACH = 1.528665;

/**
 * A hundredth of a point is finer than any display shows, and keeps moving
 * windows from reporting changes that make no difference.
 */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Returns the bottom corners of a window as macOS rounds them, given the
 * window's corner radii.
 */
export function getScreenCorners(radii: IWindowCornerRadii | undefined): IScreenCorners {
	if (!radii) {
		return NO_SCREEN_CORNERS;
	}

	return {
		bottomLeft: getScreenCorner(radii.bottomLeft, radii.radius),
		bottomRight: getScreenCorner(radii.bottomRight, radii.radius)
	};
}

function getScreenCorner(radius: number, baseRadius: number): IScreenCorner {
	if (!(radius > 0)) {
		return NO_SCREEN_CORNER; // a square corner, such as in full screen away from a rounded display corner
	}

	return { radius: round(radius), reach: round(radius * CONTINUOUS_CORNER_REACH), baseRadius: round(baseRadius) };
}

/**
 * Returns the display shape of a window, given its corner radii, where the
 * display's camera cutout reaches into it, and whether it covers the menu bar.
 */
export function getDisplayShape(radii: IWindowCornerRadii | undefined, cutout: IDisplayCutout | undefined, coversMenuBar: boolean): IDisplayShape {
	return {
		...getScreenCorners(radii),
		cutout: cutout ? { left: round(cutout.left), right: round(cutout.right), bottom: round(cutout.bottom), floats: cutout.floats } : undefined,
		coversMenuBar
	};
}

export class DisplayShapeMainService extends Disposable implements IDisplayShapeMainService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly displayChangeScheduler = this._register(new RunOnceScheduler(() => this._onDidChange.fire(), 100));

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();

		if (isMacintosh) {
			this._register(Event.any(
				Event.fromNodeEventEmitter(electron.screen, 'display-added'),
				Event.fromNodeEventEmitter(electron.screen, 'display-removed'),
				Event.fromNodeEventEmitter(electron.screen, 'display-metrics-changed')
			)(() => this.displayChangeScheduler.schedule()));
		}
	}

	private moduleLoaded = false;
	private _module: IDisplayShapeModule | undefined;

	/**
	 * The native module, loaded on first use rather than at startup. It loads
	 * synchronously, because a window restored to full screen enters it right
	 * after it is created, and has to cover the menu bar by then.
	 */
	private get module(): IDisplayShapeModule | undefined {
		if (!this.moduleLoaded && isMacintosh) {
			this.moduleLoaded = true;
			try {
				this._module = createRequire(import.meta.url)('@unbroken/display-shape');
			} catch (error) {
				this.logService.warn('[display shape] Failed to load the native module that fits windows to the display', error);
			}
		}

		return this._module;
	}

	getWindowDisplayShape(window: electron.BrowserWindow): IDisplayShape {
		if (!this.module || window.isDestroyed()) {
			return NO_DISPLAY_SHAPE;
		}

		try {
			const handle = window.getNativeWindowHandle();

			return getDisplayShape(this.module.getWindowCornerRadii(handle), this.module.getWindowDisplayCutout(handle), this.module.getWindowCoversMenuBar(handle));
		} catch (error) {
			this.logService.warn('[display shape] Failed to read how the display reaches into a window', error);
			return NO_DISPLAY_SHAPE;
		}
	}

	setCoversMenuBarInFullScreen(window: electron.BrowserWindow, covers: boolean): void {
		if (!this.module || window.isDestroyed()) {
			return;
		}

		try {
			if (!this.module.setCoversMenuBarInFullScreen(window.getNativeWindowHandle(), covers)) {
				this.logService.trace('[display shape] macOS does not let windows cover the menu bar in full screen');
			}
		} catch (error) {
			this.logService.warn('[display shape] Failed to change whether a window covers the menu bar in full screen', error);
		}
	}

	windowLevelDidChange(window: electron.BrowserWindow): void {
		if (!this.module || window.isDestroyed()) {
			return;
		}

		try {
			this.module.windowLevelDidChange(window.getNativeWindowHandle());
		} catch (error) {
			this.logService.warn('[display shape] Failed to follow a change of a window\'s level', error);
		}
	}
}
