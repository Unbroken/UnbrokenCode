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
 * Returns the corner radii of the window with the given native handle, as
 * `BrowserWindow.getNativeWindowHandle()` returns it. Always `undefined` outside
 * macOS, and when macOS does not know them.
 */
export function getWindowCornerRadii(nativeWindowHandle: Buffer): IWindowCornerRadii | undefined;
