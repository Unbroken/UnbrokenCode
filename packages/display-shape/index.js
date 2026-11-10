/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const binding = require('./build/Release/display_shape.node');

exports.getWindowCornerRadii = function (nativeWindowHandle) {
	return binding.getWindowCornerRadii(nativeWindowHandle);
};

exports.getWindowDisplayCutout = function (nativeWindowHandle) {
	return binding.getWindowDisplayCutout(nativeWindowHandle);
};

exports.setCoversMenuBarInFullScreen = function (nativeWindowHandle, enabled) {
	return binding.setCoversMenuBarInFullScreen(nativeWindowHandle, enabled);
};

exports.getWindowCoversMenuBar = function (nativeWindowHandle) {
	return binding.getWindowCoversMenuBar(nativeWindowHandle);
};

exports.windowLevelDidChange = function (nativeWindowHandle) {
	binding.windowLevelDidChange(nativeWindowHandle);
};
