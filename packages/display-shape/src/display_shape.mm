/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

#import <AppKit/AppKit.h>
#include <node_api.h>
#include <objc/message.h>
#include <objc/runtime.h>

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

//#region Display cutout

// Returns the camera cutout at the top of the given display, in screen
// coordinates, or an empty rectangle when it has none. macOS describes the
// cutout by the areas of the menu bar beside it, which leave out the full height
// of the menu bar under the cutout, so the cutout is taken to reach that far down.
static NSRect GetCutout(NSScreen *screen) {
	if (screen == nil || ![screen respondsToSelector:@selector(auxiliaryTopLeftArea)]) {
		return NSZeroRect;
	}

	NSRect leftArea = screen.auxiliaryTopLeftArea;
	NSRect rightArea = screen.auxiliaryTopRightArea;
	if (NSIsEmptyRect(leftArea) || NSIsEmptyRect(rightArea) || NSMinX(rightArea) <= NSMaxX(leftArea)) {
		return NSZeroRect;
	}

	double bottom = MIN(NSMinY(leftArea), NSMinY(rightArea));
	return NSMakeRect(NSMaxX(leftArea), bottom, NSMinX(rightArea) - NSMaxX(leftArea), NSMaxY(screen.frame) - bottom);
}

// Returns whether the given cutout of the given display floats below the top
// edge of the display, like the Dynamic Island, rather than hanging from it,
// like a notch. macOS describes the outline of the display by the screen's
// private `bezelPath`, in which a floating cutout is a shape of its own.
static bool CutoutFloats(NSScreen *screen, NSRect cutout) {
	id bezelPath = GetObject(screen, @"bezelPath");
	if (![bezelPath isKindOfClass:[NSBezierPath class]]) {
		return false;
	}

	NSBezierPath *path = bezelPath;
	NSRect frame = screen.frame;
	NSRect localCutout = NSOffsetRect(cutout, -NSMinX(frame), -NSMinY(frame)); // the outline starts at the screen's corner
	double top = NSHeight(frame);

	// Each shape starts by moving to a point; the outline of the display comes first
	double minX = INFINITY, maxX = -INFINITY, maxY = -INFINITY;
	auto isFloatingCutout = [&]() {
		return minX >= NSMinX(localCutout) - 0.5 && maxX <= NSMaxX(localCutout) + 0.5 && maxY < top - 0.5;
	};
	for (NSInteger index = 0; index < path.elementCount; index++) {
		NSPoint points[3];
		NSBezierPathElement element = [path elementAtIndex:index associatedPoints:points];
		NSInteger pointCount = element == NSBezierPathElementCurveTo ? 3 : element == NSBezierPathElementClosePath ? 0 : 1;
		if (element == NSBezierPathElementMoveTo) {
			if (maxY > -INFINITY && isFloatingCutout()) {
				return true;
			}
			minX = INFINITY, maxX = -INFINITY, maxY = -INFINITY;
		}
		for (NSInteger point = 0; point < pointCount; point++) {
			minX = MIN(minX, points[point].x);
			maxX = MAX(maxX, points[point].x);
			maxY = MAX(maxY, points[point].y);
		}
	}
	return maxY > -INFINITY && isFloatingCutout();
}

// Returns where the camera cutout at the top of the given window's display
// reaches into the window, in points from the window's top left corner, and
// whether it floats below the top edge of the display, or `undefined` when it
// does not reach into the window.
static napi_value GetWindowDisplayCutout(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_value undefined;
	napi_get_undefined(env, &undefined);
	if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) {
		return undefined;
	}

	@autoreleasepool {
		NSWindow *window = GetWindow(env, argv[0]);
		NSRect cutout = GetCutout(window.screen);
		NSRect frame = window.frame;
		if (NSIsEmptyRect(cutout) || NSMaxY(frame) <= NSMinY(cutout) || NSMaxX(frame) <= NSMinX(cutout) || NSMinX(frame) >= NSMaxX(cutout)) {
			return undefined; // no cutout, or the window is clear of it
		}

		napi_value result;
		if (napi_create_object(env, &result) != napi_ok ||
			!SetNumber(env, result, "left", NSMinX(cutout) - NSMinX(frame)) ||
			!SetNumber(env, result, "right", NSMaxX(cutout) - NSMinX(frame)) ||
			!SetNumber(env, result, "bottom", NSMaxY(frame) - NSMinY(cutout))) {
			return undefined;
		}

		napi_value floats;
		if (napi_get_boolean(env, CutoutFloats(window.screen, cutout), &floats) != napi_ok || napi_set_named_property(env, result, "floats", floats) != napi_ok) {
			return undefined;
		}
		return result;
	}
}

//#endregion

//#region Covering the menu bar in full screen

// On displays with a camera cutout, macOS keeps the menu bar in full screen:
// it places full screen windows below the menu bar, and draws the menu bar's
// black backdrop over the band it leaves, whatever presentation options the
// app asks for. Windows that cover the menu bar instead get the full height of
// the display, ask to hide the menu bar and the Dock rather than reveal them on
// hover, and are raised above the menu bar's backdrop while in full screen.
// The menu bar also holds what the cutout shows, such as Now Playing, so it
// still appears when the mouse reaches the cutout.

static char CoversMenuBarKey;
static char MenuBarObserverKey;
static IMP OriginalReservesSpaceForMenuBar = nullptr;

// Whether the window is to cover the menu bar in full screen, on whichever display.
static bool WantsToCoverMenuBar(NSWindow *window) {
	return window != nil && [objc_getAssociatedObject(window, &CoversMenuBarKey) boolValue];
}

// Only on displays with a camera cutout: elsewhere, full screen windows already
// get the whole display, with the menu bar and the Dock appearing on hover.
static bool CoversMenuBar(NSWindow *window) {
	return WantsToCoverMenuBar(window) && !NSIsEmptyRect(GetCutout(window.screen));
}

// Replaces `-[_NSFullScreenSpace alwaysReservesSpaceForMenuBarInFullScreen]`,
// which makes full screen windows leave room for the menu bar whenever the
// display has a camera cutout.
static BOOL ReservesSpaceForMenuBar(id space, SEL selector) {
	if (CoversMenuBar(GetObject(GetObject(space, @"contentController"), @"window"))) {
		return NO;
	}
	return ((BOOL (*)(id, SEL))OriginalReservesSpaceForMenuBar)(space, selector);
}

static bool InstallReservesSpaceForMenuBarHook() {
	static bool installed = false;
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		Class spaceClass = NSClassFromString(@"_NSFullScreenSpace");
		Method method = spaceClass != nil ? class_getInstanceMethod(spaceClass, NSSelectorFromString(@"alwaysReservesSpaceForMenuBarInFullScreen")) : nullptr;
		if (method == nullptr || method_getNumberOfArguments(method) != 2 || ![spaceClass instancesRespondToSelector:NSSelectorFromString(@"contentController")]) {
			return; // macOS changed, so leave it be
		}

		char returnType[8];
		method_getReturnType(method, returnType, sizeof(returnType));
		if (strcmp(returnType, @encode(BOOL)) == 0) {
			OriginalReservesSpaceForMenuBar = method_setImplementation(method, (IMP)ReservesSpaceForMenuBar);
			installed = true;
		}
	});
	return installed;
}

static NSApplicationPresentationOptions WithHiddenMenuBar(NSApplicationPresentationOptions options) {
	return (options & ~(NSApplicationPresentationAutoHideMenuBar | NSApplicationPresentationAutoHideDock)) | NSApplicationPresentationHideMenuBar | NSApplicationPresentationHideDock;
}

static NSApplicationPresentationOptions WithAutoHiddenMenuBar(NSApplicationPresentationOptions options) {
	return (options & ~(NSApplicationPresentationHideMenuBar | NSApplicationPresentationHideDock)) | NSApplicationPresentationAutoHideMenuBar | NSApplicationPresentationAutoHideDock;
}

static void SetPresentationOptions(NSApplicationPresentationOptions options) {
	@try {
		NSApp.presentationOptions = options;
	} @catch (NSException *) {
		// macOS rejects combinations it does not support, which leaves the options as they were
	}
}

static NSApplicationPresentationOptions HideMenuBar(NSWindow *window, NSApplicationPresentationOptions proposed) {
	return CoversMenuBar(window) ? WithHiddenMenuBar(proposed) : proposed;
}

// The `window:willUseFullScreenPresentationOptions:` that each hooked window
// delegate class had before, its own or inherited, if any.
static NSMutableDictionary<NSString *, NSValue *> *OriginalWillUsePresentationOptions = [NSMutableDictionary dictionary];

static NSApplicationPresentationOptions WillUseFullScreenPresentationOptions(id delegate, SEL selector, NSWindow *window, NSApplicationPresentationOptions proposed) {
	for (Class delegateClass = [delegate class]; delegateClass != nil; delegateClass = class_getSuperclass(delegateClass)) {
		NSValue *original = OriginalWillUsePresentationOptions[NSStringFromClass(delegateClass)];
		if (original != nil) {
			if (original.pointerValue != nullptr) {
				proposed = ((NSApplicationPresentationOptions (*)(id, SEL, NSWindow *, NSApplicationPresentationOptions))original.pointerValue)(delegate, selector, window, proposed);
			}
			break;
		}
	}
	return HideMenuBar(window, proposed);
}

static void InstallWillUsePresentationOptionsHook(Class delegateClass) {
	NSString *className = NSStringFromClass(delegateClass);
	if (OriginalWillUsePresentationOptions[className] != nil) {
		return;
	}

	SEL selector = @selector(window:willUseFullScreenPresentationOptions:);
	Method existing = class_getInstanceMethod(delegateClass, selector);
	IMP original = existing != nullptr ? method_getImplementation(existing) : nullptr;
	if (original == (IMP)WillUseFullScreenPresentationOptions) {
		return; // inherited from a class that is hooked already
	}
	if (!class_addMethod(delegateClass, selector, (IMP)WillUseFullScreenPresentationOptions, "Q32@0:8@16Q24")) {
		original = method_setImplementation(existing, (IMP)WillUseFullScreenPresentationOptions); // the class has its own
	}
	OriginalWillUsePresentationOptions[className] = [NSValue valueWithPointer:(const void *)original];
}

// Follows a window that covers the menu bar into and out of full screen: notes
// whether it covers the menu bar in this full screen, which it decided on as it
// entered, and raises it above the menu bar's backdrop while it is in full screen
// on a display with a camera cutout, also as the cutout moves or the window moves
// to another display, restoring its level as it leaves. It is only raised while
// its Space is the active one or it shows, such as as its Space slides in: macOS
// does not switch to the Space of a window above the normal level as its app is
// activated, such as from the Dock or an app switcher. While raised, the mouse reaching the cutout reveals the menu bar, with
// what the cutout shows, until macOS hides the menu bar again. Stops observing
// when the window goes away.
@interface UnbrokenMenuBarObserver : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic) BOOL coversMenuBar;
@property(nonatomic, strong) NSNumber *levelBeforeFullScreen;
@property(nonatomic) NSWindowLevel levelSet; // the level last given to the window here
@property(nonatomic) NSRect cutout; // in screen coordinates
@property(nonatomic, strong) NSArray *mouseMonitors;
@property(nonatomic, strong) NSTimer *revealedMenuBarTimer;
@property(nonatomic) double revealedChromeBottom; // in screen coordinates
@end

@implementation UnbrokenMenuBarObserver

- (instancetype)initWithWindow:(NSWindow *)window {
	if ((self = [super init])) {
		_window = window;
		NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
		[center addObserver:self selector:@selector(willEnterFullScreen:) name:NSWindowWillEnterFullScreenNotification object:window];
		[center addObserver:self selector:@selector(didEnterFullScreen:) name:NSWindowDidEnterFullScreenNotification object:window];
		[center addObserver:self selector:@selector(willExitFullScreen:) name:NSWindowWillExitFullScreenNotification object:window];
		[center addObserver:self selector:@selector(willExitFullScreen:) name:NSWindowWillCloseNotification object:window];
		[center addObserver:self selector:@selector(screenDidChange:) name:NSApplicationDidChangeScreenParametersNotification object:nil];
		[center addObserver:self selector:@selector(screenDidChange:) name:NSWindowDidChangeScreenNotification object:window];
		[center addObserver:self selector:@selector(spaceVisibilityDidChange:) name:NSWindowDidChangeOcclusionStateNotification object:window];
		[[NSWorkspace sharedWorkspace].notificationCenter addObserver:self selector:@selector(spaceVisibilityDidChange:) name:NSWorkspaceActiveSpaceDidChangeNotification object:nil];
	}
	return self;
}

- (void)dealloc {
	[[NSNotificationCenter defaultCenter] removeObserver:self];
	[[NSWorkspace sharedWorkspace].notificationCenter removeObserver:self];
	[self stopWatchingCutout];
}

- (void)willEnterFullScreen:(NSNotification *)notification {
	self.coversMenuBar = WantsToCoverMenuBar(self.window); // whichever display it ends up on
}

- (void)didEnterFullScreen:(NSNotification *)notification {
	[self followCutout];
}

// The cutout moves when the display's resolution changes, which it can in full screen, and
// comes and goes as the window moves to another display, such as with its Space
- (void)screenDidChange:(NSNotification *)notification {
	if (self.coversMenuBar && (self.window.styleMask & NSWindowStyleMaskFullScreen) != 0) {
		[self followCutout];
	}
}

// Covers the menu bar of the display the window is on: on a display with a cutout, keeps
// the window above the menu bar's backdrop and watches the mouse reach the cutout, and on
// other displays, lets the menu bar appear as it does over other full screen windows
- (void)followCutout {
	NSWindow *window = self.window;
	NSRect cutout = self.coversMenuBar ? GetCutout(window.screen) : NSZeroRect;
	if (NSIsEmptyRect(cutout)) {
		if (self.levelBeforeFullScreen != nil) {
			[self stopCoveringMenuBar];
			if ([self presentsFullScreen]) {
				SetPresentationOptions(WithAutoHiddenMenuBar(NSApp.presentationOptions));
			}
		}
		return;
	}

	self.cutout = cutout;
	NSWindowLevel aboveMenuBar = NSMainMenuWindowLevel + 1;
	if (self.levelBeforeFullScreen == nil && window.level < aboveMenuBar) {
		if ([self presentsFullScreen]) {
			SetPresentationOptions(WithHiddenMenuBar(NSApp.presentationOptions)); // already so as the window entered full screen on this display
		}
		self.levelBeforeFullScreen = @(window.level);
		[self updateLevel];
	}
	if (self.levelBeforeFullScreen != nil && self.mouseMonitors == nil) {
		[self watchCutout];
	}
}

- (void)stopCoveringMenuBar {
	[self followLevelChange];
	[self stopWatchingCutout];
	if (self.levelBeforeFullScreen != nil) {
		[self setWindowLevel:self.levelBeforeFullScreen.integerValue];
		self.levelBeforeFullScreen = nil;
	}
}

// Keeps a level the window was given meanwhile, such as by pinning it on top, as the one to
// restore, rather than the one it had as it entered full screen
- (void)followLevelChange {
	if (self.levelBeforeFullScreen == nil) {
		return;
	}
	if (self.window.level != self.levelSet) {
		self.levelBeforeFullScreen = @(self.window.level);
	}
}

// Above the menu bar's backdrop, or higher if the window was asked to be
- (NSWindowLevel)coveringLevel {
	return MAX(NSMainMenuWindowLevel + 1, self.levelBeforeFullScreen.integerValue);
}

- (void)setWindowLevel:(NSWindowLevel)level {
	self.levelSet = level;
	self.window.level = level;
}

// Covers the menu bar while the window's Space is the active one or the window shows, unless
// the menu bar is revealed, and has the level it had before full screen otherwise. The window
// shows as soon as its Space starts to slide in, such as with the trackpad, while its Space
// only becomes the active one once it is all in.
- (void)updateLevel {
	NSWindow *window = self.window;
	BOOL shows = (window.occlusionState & NSWindowOcclusionStateVisible) != 0;
	BOOL covers = self.revealedMenuBarTimer == nil && (window.isOnActiveSpace || shows);
	[self setWindowLevel:covers ? [self coveringLevel] : self.levelBeforeFullScreen.integerValue];
}

// macOS only switches to the window's Space when it is at the level it had before full screen
- (void)spaceVisibilityDidChange:(NSNotification *)notification {
	if (self.levelBeforeFullScreen == nil) {
		return;
	}
	[self followLevelChange];
	[self updateLevel];
}

// Follows a level the window was just given elsewhere, such as by pinning it on top, which
// would drop it below the menu bar's backdrop: restores that level as it leaves full screen,
// and keeps it covering until then, unless the menu bar is revealed or the window's Space
// is not the active one
- (void)windowLevelDidChange {
	if (self.levelBeforeFullScreen == nil) {
		return;
	}
	[self followLevelChange];
	[self updateLevel];
}

- (void)willExitFullScreen:(NSNotification *)notification {
	self.coversMenuBar = NO;
	[self stopCoveringMenuBar];
}

// The cutout belongs to the menu bar, which another process draws, so the mouse
// is watched as it moves over other processes' windows too.
- (void)watchCutout {
	__weak UnbrokenMenuBarObserver *weakSelf = self;
	void (^onMouseMoved)(void) = ^{
		UnbrokenMenuBarObserver *strongSelf = weakSelf;
		if (strongSelf != nil && strongSelf.revealedMenuBarTimer == nil && [strongSelf presentsFullScreen] && NSPointInRect([NSEvent mouseLocation], strongSelf.cutout)) {
			[strongSelf revealMenuBar];
		}
	};
	id localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved handler:^NSEvent *(NSEvent *event) {
		onMouseMoved();
		return event;
	}];
	id globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskMouseMoved handler:^(NSEvent *) {
		onMouseMoved();
	}];
	self.mouseMonitors = [NSArray arrayWithObjects:localMonitor, globalMonitor, nil];
}

- (void)stopWatchingCutout {
	for (id monitor in self.mouseMonitors) {
		[NSEvent removeMonitor:monitor];
	}
	self.mouseMonitors = nil;
	[self.revealedMenuBarTimer invalidate];
	self.revealedMenuBarTimer = nil;
}

// Lets the menu bar appear as it does over other full screen windows: macOS
// reveals it while the mouse is at the top of the screen, which it is.
- (void)revealMenuBar {
	[self followLevelChange];
	SetPresentationOptions(WithAutoHiddenMenuBar(NSApp.presentationOptions));
	[self setWindowLevel:self.levelBeforeFullScreen.integerValue];

	// The strip with the window's buttons comes down below the menu bar, but its
	// frame does not follow it there, so only its height tells where it ends
	NSWindow *window = self.window;
	double stripHeight = 0;
	Class stripClass = NSClassFromString(@"NSToolbarFullScreenWindow");
	for (NSWindow *other in NSApp.windows) {
		if (stripClass != nil && [other isKindOfClass:stripClass] && other.screen == window.screen) {
			stripHeight = MAX(stripHeight, NSHeight(other.frame));
		}
	}
	self.revealedChromeBottom = MIN(NSMinY(self.cutout), NSMaxY(window.screen.frame) - NSApp.mainMenu.menuBarHeight - stripHeight);

	__weak UnbrokenMenuBarObserver *weakSelf = self;
	self.revealedMenuBarTimer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *) {
		[weakSelf followRevealedMenuBar];
	}];
}

// Covers the menu bar again once the mouse is below what macOS revealed, the
// menu bar and the strip with the window's buttons that comes down with it, and
// macOS has hidden the menu bar, which it keeps while its menus or what the
// cutout shows are open.
- (void)followRevealedMenuBar {
	if ([NSMenu menuBarVisible] || [NSEvent mouseLocation].y >= self.revealedChromeBottom) {
		return;
	}

	[self followLevelChange];
	[self.revealedMenuBarTimer invalidate];
	self.revealedMenuBarTimer = nil;
	if ([self presentsFullScreen]) {
		SetPresentationOptions(WithHiddenMenuBar(NSApp.presentationOptions));
	}
	[self updateLevel];
}

// The presentation options belong to the whole application, so only the full screen window
// being presented changes them: another window's full screen may be in front by now, which
// macOS gives the options it entered full screen with.
- (BOOL)presentsFullScreen {
	NSWindow *window = self.window;
	return window.isOnActiveSpace && (window.isMainWindow || window.isKeyWindow);
}

@end

// Tells the given window's full screen that its level was just changed elsewhere.
static napi_value WindowLevelDidChange(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_value undefined;
	napi_get_undefined(env, &undefined);
	if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) {
		return undefined;
	}

	@autoreleasepool {
		NSWindow *window = GetWindow(env, argv[0]);
		UnbrokenMenuBarObserver *observer = window != nil ? objc_getAssociatedObject(window, &MenuBarObserverKey) : nil;
		[observer windowLevelDidChange];
		return undefined;
	}
}

// Returns whether the given window covers the menu bar in the full screen it is in, on the
// display it is on.
static napi_value GetWindowCoversMenuBar(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_value result;
	napi_get_boolean(env, false, &result);
	if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) {
		return result;
	}

	@autoreleasepool {
		NSWindow *window = GetWindow(env, argv[0]);
		UnbrokenMenuBarObserver *observer = window != nil ? objc_getAssociatedObject(window, &MenuBarObserverKey) : nil;
		bool coversMenuBar = observer.coversMenuBar && (window.styleMask & NSWindowStyleMaskFullScreen) != 0 && !NSIsEmptyRect(GetCutout(window.screen));
		napi_get_boolean(env, coversMenuBar, &result);
		return result;
	}
}

// Makes the given window cover the menu bar when it is in full screen, or stop
// doing so. Returns whether macOS lets it.
static napi_value SetCoversMenuBarInFullScreen(napi_env env, napi_callback_info info) {
	size_t argc = 2;
	napi_value argv[2];
	napi_value result;
	napi_get_boolean(env, false, &result);
	bool enabled = false;
	if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 2 || napi_get_value_bool(env, argv[1], &enabled) != napi_ok) {
		return result;
	}

	@autoreleasepool {
		NSWindow *window = GetWindow(env, argv[0]);
		if (window == nil) {
			return result;
		}

		if (!enabled) {
			objc_setAssociatedObject(window, &CoversMenuBarKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC); // keep observing, to restore the level of a window in full screen
			napi_get_boolean(env, true, &result);
			return result;
		}

		if (window.delegate == nil || !InstallReservesSpaceForMenuBarHook()) {
			return result;
		}

		InstallWillUsePresentationOptionsHook([(id)window.delegate class]);
		objc_setAssociatedObject(window, &CoversMenuBarKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
		if (objc_getAssociatedObject(window, &MenuBarObserverKey) == nil) {
			objc_setAssociatedObject(window, &MenuBarObserverKey, [[UnbrokenMenuBarObserver alloc] initWithWindow:window], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
		}
		napi_get_boolean(env, true, &result);
		return result;
	}
}

//#endregion

NAPI_MODULE_INIT() {
	struct { const char *name; napi_callback callback; } functions[] = {
		{ "getWindowCornerRadii", GetWindowCornerRadii },
		{ "getWindowDisplayCutout", GetWindowDisplayCutout },
		{ "setCoversMenuBarInFullScreen", SetCoversMenuBarInFullScreen },
		{ "getWindowCoversMenuBar", GetWindowCoversMenuBar },
		{ "windowLevelDidChange", WindowLevelDidChange },
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
