/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

#import <AppKit/AppKit.h>
#include <node_api.h>
#include <objc/message.h>

static bool GetDouble(id target, NSString *selectorName, double *value) {
	SEL selector = NSSelectorFromString(selectorName);
	if (target == nil || ![target respondsToSelector:selector]) {
		return false;
	}
	*value = ((double (*)(id, SEL))objc_msgSend)(target, selector);
	return true;
}

static id GetObject(id target, NSString *selectorName) {
	SEL selector = NSSelectorFromString(selectorName);
	if (target == nil || ![target respondsToSelector:selector]) {
		return nil;
	}
	return ((id (*)(id, SEL))objc_msgSend)(target, selector);
}

// Returns the window that contains the `NSView` whose pointer is in the given
// buffer, as `BrowserWindow.getNativeWindowHandle()` returns it.
static NSWindow *GetWindow(napi_env env, napi_value handle) {
	bool isBuffer = false;
	void *data = nullptr;
	size_t length = 0;
	if (napi_is_buffer(env, handle, &isBuffer) != napi_ok || !isBuffer ||
		napi_get_buffer_info(env, handle, &data, &length) != napi_ok || length < sizeof(void *)) {
		return nil;
	}

	NSView *view = *reinterpret_cast<NSView * __unsafe_unretained *>(data);
	return [view isKindOfClass:[NSView class]] ? view.window : nil;
}

static bool SetNumber(napi_env env, napi_value object, const char *name, double value) {
	napi_value number;
	return napi_create_double(env, value, &number) == napi_ok && napi_set_named_property(env, object, name, number) == napi_ok;
}

//#region Corner radii

// Reads the corner radii of the given window. There is no public API for them,
// so this asks `NSWindow` for its private `_cornerRadius`, the radius the window
// normally has, and `_cornerRadii`, the radius of each corner as macOS currently
// shapes it: on displays with rounded corners, a window's corner grows to match
// the display's as the window nears the display's corner. Returns `undefined`
// when macOS does not know them.
static napi_value GetWindowCornerRadii(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_value undefined;
	napi_get_undefined(env, &undefined);
	if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) {
		return undefined;
	}

	@autoreleasepool {
		NSWindow *window = GetWindow(env, argv[0]);
		id cornerRadii = GetObject(window, @"_cornerRadii");

		double radius, bottomLeft, bottomRight;
		if (!GetDouble(window, @"_cornerRadius", &radius) || !GetDouble(cornerRadii, @"bottomLeft", &bottomLeft) || !GetDouble(cornerRadii, @"bottomRight", &bottomRight)) {
			return undefined;
		}

		napi_value result;
		if (napi_create_object(env, &result) != napi_ok ||
			!SetNumber(env, result, "radius", radius) ||
			!SetNumber(env, result, "bottomLeft", bottomLeft) ||
			!SetNumber(env, result, "bottomRight", bottomRight)) {
			return undefined;
		}
		return result;
	}
}

//#endregion

NAPI_MODULE_INIT() {
	struct { const char *name; napi_callback callback; } functions[] = {
		{ "getWindowCornerRadii", GetWindowCornerRadii },
	};
	for (const auto &function : functions) {
		napi_value value;
		if (napi_create_function(env, function.name, NAPI_AUTO_LENGTH, function.callback, nullptr, &value) != napi_ok ||
			napi_set_named_property(env, exports, function.name, value) != napi_ok) {
			return nullptr;
		}
	}
	return exports;
}
