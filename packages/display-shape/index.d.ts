/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IWindowCornerRadii {

	/**
	 * The radius the window's corners normally have, in points. Zero in full screen.
	 */
	readonly radius: number;

	/**
	 * The radius of the window's bottom corners as macOS currently shapes them, in
	 * points. On displays with rounded corners, a window's corner grows to match the
	 * display's as the window nears the display's corner.
	 */
	readonly bottomLeft: number;
	readonly bottomRight: number;
}

/**
 * Where the camera cutout at the top of a display reaches into a window, in
 * points from the window's top left corner.
 */
export interface IWindowDisplayCutout {
	readonly left: number;
	readonly right: number;
	readonly bottom: number;

	/**
	 * Whether the cutout floats below the top edge of the display, like the
	 * Dynamic Island, rather than hanging from it, like a notch.
	 */
	readonly floats: boolean;
}

/**
 * Returns the corner radii of the window with the given native handle, as
 * `BrowserWindow.getNativeWindowHandle()` returns it. Always `undefined` outside
 * macOS, and when macOS does not know them.
 */
export function getWindowCornerRadii(nativeWindowHandle: Buffer): IWindowCornerRadii | undefined;

/**
 * Returns where the camera cutout of the display reaches into the window with the
 * given native handle, or `undefined` when the display has no cutout or the window
 * is clear of it, such as below the menu bar. Always `undefined` outside macOS.
 */
export function getWindowDisplayCutout(nativeWindowHandle: Buffer): IWindowDisplayCutout | undefined;

/**
 * Makes the window with the given native handle cover the menu bar when it is in
 * full screen on a display with a camera cutout, or stop doing so. macOS otherwise
 * keeps a black menu bar above full screen windows on such displays. The window
 * then gets the full height of the display, beside and below the cutout, and the
 * menu bar and the Dock only appear when the mouse reaches the cutout. On other
 * displays, full screen windows already get the whole display, so nothing changes
 * there. Takes effect the next time the window enters full screen. Returns whether
 * macOS lets the window cover the menu bar, which is never the case outside macOS.
 */
export function setCoversMenuBarInFullScreen(nativeWindowHandle: Buffer, enabled: boolean): boolean;

/**
 * Returns whether the window with the given native handle covers the menu bar in
 * the full screen it is in, which it decides on as it enters full screen. Always
 * `false` outside full screen and outside macOS.
 */
export function getWindowCoversMenuBar(nativeWindowHandle: Buffer): boolean;

/**
 * Tells the window with the given native handle that its level was just changed, such as by
 * pinning it on top, so that it keeps covering the menu bar in full screen and has that level
 * as it leaves full screen.
 */
export function windowLevelDidChange(nativeWindowHandle: Buffer): void;
