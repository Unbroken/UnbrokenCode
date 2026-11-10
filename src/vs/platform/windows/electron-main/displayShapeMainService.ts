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
import { IDisplayShape, IScreenCorner, IScreenCorners } from '../../native/common/native.js';

export const IDisplayShapeMainService = createDecorator<IDisplayShapeMainService>('displayShapeMainService');

/**
 * Fits windows to displays whose shape is not a plain rectangle, such as the
 * built-in display of recent MacBook Pros, with rounded bottom corners: macOS
 * grows a window's bottom corner to match the display's as the window nears
 * the display's corner.
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
}

/**
 * The native module that reads how macOS fits windows to the display.
 */
interface IDisplayShapeModule {
	getWindowCornerRadii(nativeWindowHandle: Buffer): IWindowCornerRadii | undefined;
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
export const NO_DISPLAY_SHAPE: IDisplayShape = NO_SCREEN_CORNERS;

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
	 * synchronously, so that windows know their shape as soon as they exist.
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
			return getScreenCorners(this.module.getWindowCornerRadii(window.getNativeWindowHandle()));
		} catch (error) {
			this.logService.warn('[display shape] Failed to read how the display reaches into a window', error);
			return NO_DISPLAY_SHAPE;
		}
	}
}
