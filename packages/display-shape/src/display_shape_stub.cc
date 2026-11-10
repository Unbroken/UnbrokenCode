/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

#include <node_api.h>

// Only macOS shapes windows to fit displays with rounded corners and camera cutouts.
static napi_value Undefined(napi_env env, napi_callback_info /* info */) {
	napi_value undefined;
	napi_get_undefined(env, &undefined);
	return undefined;
}

static napi_value False(napi_env env, napi_callback_info /* info */) {
	napi_value result;
	napi_get_boolean(env, false, &result);
	return result;
}

NAPI_MODULE_INIT() {
	struct { const char *name; napi_callback callback; } functions[] = {
		{ "getWindowCornerRadii", Undefined },
		{ "getWindowDisplayCutout", Undefined },
		{ "setCoversMenuBarInFullScreen", False },
		{ "getWindowCoversMenuBar", False },
		{ "windowLevelDidChange", Undefined },
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
