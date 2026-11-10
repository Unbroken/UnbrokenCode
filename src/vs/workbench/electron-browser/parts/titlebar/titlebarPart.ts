/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Color } from '../../../../base/common/color.js';
import { getZoomFactor, setHasDisplayCutout } from '../../../../base/browser/browser.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { $, addDisposableListener, append, EventType, getWindow, getWindowId, hide, prepend, show } from '../../../../base/browser/dom.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService, IConfigurationChangeEvent } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { isMacintosh, isWindows, isLinux, isTahoeOrNewer } from '../../../../base/common/platform.js';
import { IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { BrowserTitlebarPart, BrowserTitleService, IAuxiliaryTitlebarPart } from '../../../browser/parts/titlebar/titlebarPart.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IDisplayCutout, IDisplayShape, INativeHostService } from '../../../../platform/native/common/native.js';
import { ILayoutDisplayCutout } from '../../../../platform/layout/browser/layoutService.js';
import { localize } from '../../../../nls.js';
import { equals } from '../../../../base/common/objects.js';
import { hasNativeTitlebar, useWindowControlsOverlay, DEFAULT_CUSTOM_TITLEBAR_HEIGHT, hasNativeMenu } from '../../../../platform/window/common/window.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { NativeMenubarControl } from './menubarControl.js';
import { IEditorGroupsContainer, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { CodeWindow, mainWindow } from '../../../../base/browser/window.js';
import { IsWindowAlwaysOnTopContext } from '../../../common/contextkeys.js';

/**
 * How far the antialiased edge of a camera cutout that floats below the top edge
 * of the display, like the Dynamic Island, reaches past where macOS says the
 * cutout ends, in screen points. A notch hanging from the top edge ends there.
 */
const FLOATING_DISPLAY_CUTOUT_ANTIALIASING = 1;

export class NativeTitlebarPart extends BrowserTitlebarPart {

	//#region IView

	override get minimumHeight(): number {
		if (!isMacintosh) {
			return super.minimumHeight;
		}

		const height = (this.isCommandCenterVisible ? DEFAULT_CUSTOM_TITLEBAR_HEIGHT : this.macTitlebarSize) / (this.preventZoom ? getZoomFactor(getWindow(this.element)) : 1);
		const cutout = this.displayCutout;

		// Reach below the camera cutout, so that it only ever covers the title bar, and put the
		// title bar's border, if it has one, below it
		return cutout ? Math.max(height, cutout.bottom + (this.hasBorder ? 1 : 0)) : height;
	}
	override get maximumHeight(): number { return this.minimumHeight; }

	private tahoeOrNewer: boolean;
	private get macTitlebarSize() {
		if (this.tahoeOrNewer) {
			return 32;
		}

		return 28;
	}

	//#endregion

	private maxRestoreControl: HTMLElement | undefined;
	private resizer: HTMLElement | undefined;

	private screenCutout: IDisplayCutout | undefined; // in screen points
	private coversMenuBar = false;
	private hasBorder = false;
	private fullScreenWindowControls: HTMLElement | undefined;

	private cachedWindowControlStyles: { bgColor: string; fgColor: string } | undefined;
	private cachedWindowControlHeight: number | undefined;

	constructor(
		id: string,
		targetWindow: CodeWindow,
		editorGroupsContainer: IEditorGroupsContainer,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IActionViewItemService actionViewItemService: IActionViewItemService
	) {
		super(id, targetWindow, editorGroupsContainer, contextMenuService, configurationService, environmentService, instantiationService, themeService, storageService, layoutService, contextKeyService, hostService, editorService, menuService, keybindingService, actionViewItemService);

		this.tahoeOrNewer = isTahoeOrNewer(environmentService.os.release);

		this.handleWindowsAlwaysOnTop(targetWindow.vscodeWindowId);

		if (isMacintosh) {
			this.handleDisplayShape(targetWindow.vscodeWindowId);
		}
	}

	/**
	 * In native full screen on displays with a camera cutout, windows can cover the
	 * menu bar, and the title bar then takes its band beside the cutout: it reaches
	 * below the cutout, keeps its contents clear of it, and turns black to hide it.
	 * The menu bar then only appears when the mouse reaches the cutout, and so do
	 * the window controls macOS shows with it, so the title bar shows its own.
	 */
	private async handleDisplayShape(targetWindowId: number): Promise<void> {
		this._register(toDisposable(() => setHasDisplayCutout(false, this.targetWindow)));

		let receivedChange = false;
		this._register(Event.filter(this.nativeHostService.onDidChangeWindowDisplayShape, e => e.windowId === targetWindowId)(({ shape }) => {
			receivedChange = true;
			this.updateDisplayShape(shape);
		}));

		const shape = await this.nativeHostService.getWindowDisplayShape({ targetWindowId });
		if (!receivedChange) { // a change event may have arrived meanwhile
			this.updateDisplayShape(shape);
		}
	}

	private updateDisplayShape({ cutout, coversMenuBar }: IDisplayShape): void {
		if (equals(cutout, this.screenCutout) && coversMenuBar === this.coversMenuBar) {
			return;
		}

		this.screenCutout = cutout;
		this.coversMenuBar = coversMenuBar;
		setHasDisplayCutout(!!cutout, this.targetWindow);
		this.layoutDisplayCutout();
		this.updateFullScreenWindowControls();
		this.updateStyles();
		this._onDidChange.fire(undefined); // the height follows the cutout
	}

	override get displayCutout(): ILayoutDisplayCutout | undefined {
		if (!this.screenCutout) {
			return undefined;
		}

		// The cutout comes in screen points, the workbench lays out in CSS pixels
		const zoomFactor = getZoomFactor(getWindow(this.element));
		const bottom = this.screenCutout.bottom + (this.screenCutout.floats ? FLOATING_DISPLAY_CUTOUT_ANTIALIASING : 0);

		return { left: this.screenCutout.left / zoomFactor, right: this.screenCutout.right / zoomFactor, bottom: bottom / zoomFactor };
	}

	private layoutDisplayCutout(): void {
		if (!this.rootContainer) {
			return; // not created yet
		}

		const cutout = this.screenCutout;
		this.rootContainer.classList.toggle('has-display-cutout', !!cutout);
		if (!cutout) {
			this.rootContainer.style.removeProperty('--titlebar-display-cutout-left');
			this.rootContainer.style.removeProperty('--titlebar-display-cutout-right');
			return;
		}

		// The cutout comes in screen points, the title bar's contents counter zoom unless they can zoom
		const scale = this.preventZoom ? 1 : 1 / getZoomFactor(getWindow(this.element));
		this.rootContainer.style.setProperty('--titlebar-display-cutout-left', `${cutout.left * scale}px`);
		this.rootContainer.style.setProperty('--titlebar-display-cutout-right', `${cutout.right * scale}px`);
	}

	/**
	 * Window controls that look and act like the ones macOS shows in full screen:
	 * close, a disabled minimize, and exit full screen.
	 */
	private createFullScreenWindowControls(targetWindow: CodeWindow): void {
		const container = this.fullScreenWindowControls = prepend(this.leftContent, $('div.fullscreen-window-controls'));

		const close = this._register(new Button(container, { ariaLabel: localize('closeWindow', "Close Window") }));
		close.element.classList.add('fullscreen-window-control', 'close');
		this._register(close.onDidClick(() => this.nativeHostService.closeWindow({ targetWindowId: targetWindow.vscodeWindowId })));

		// Minimizing is not possible in full screen, which macOS shows with a disabled control
		append(container, $('div.fullscreen-window-control.minimize', { 'aria-hidden': 'true' }));

		const exitFullScreen = this._register(new Button(container, { ariaLabel: localize('exitFullScreen', "Exit Full Screen") }));
		exitFullScreen.element.classList.add('fullscreen-window-control', 'exit-full-screen');
		this._register(exitFullScreen.onDidClick(() => this.hostService.toggleFullScreen(targetWindow)));

		this.updateFullScreenWindowControls();
	}

	private updateFullScreenWindowControls(): void {
		this.fullScreenWindowControls?.classList.toggle('visible', this.coversMenuBar);
	}

	private async handleWindowsAlwaysOnTop(targetWindowId: number): Promise<void> {
		const isWindowAlwaysOnTopContext = IsWindowAlwaysOnTopContext.bindTo(this.contextKeyService);

		this._register(this.nativeHostService.onDidChangeWindowAlwaysOnTop(({ windowId, alwaysOnTop }) => {
			if (windowId === targetWindowId) {
				isWindowAlwaysOnTopContext.set(alwaysOnTop);
			}
		}));

		isWindowAlwaysOnTopContext.set(await this.nativeHostService.isWindowAlwaysOnTop({ targetWindowId }));
	}

	protected override onMenubarVisibilityChanged(visible: boolean): void {

		// Hide title when toggling menu bar
		if ((isWindows || isLinux) && this.currentMenubarVisibility === 'toggle' && visible) {

			// Hack to fix issue #52522 with layered webkit-app-region elements appearing under cursor
			if (this.dragRegion) {
				hide(this.dragRegion);
				setTimeout(() => show(this.dragRegion!), 50);
			}
		}

		super.onMenubarVisibilityChanged(visible);
	}

	protected override onConfigurationChanged(event: IConfigurationChangeEvent): void {
		super.onConfigurationChanged(event);

		if (event.affectsConfiguration('window.doubleClickIconToClose')) {
			if (this.appIcon) {
				this.onUpdateAppIconDragBehavior();
			}
		}
	}

	private onUpdateAppIconDragBehavior(): void {
		const setting = this.configurationService.getValue('window.doubleClickIconToClose');
		if (setting && this.appIcon) {
			(this.appIcon.style as CSSStyleDeclaration & { '-webkit-app-region': string })['-webkit-app-region'] = 'no-drag';
		} else if (this.appIcon) {
			(this.appIcon.style as CSSStyleDeclaration & { '-webkit-app-region': string })['-webkit-app-region'] = 'drag';
		}
	}

	protected override installMenubar(): void {
		super.installMenubar();

		if (this.menubar) {
			return;
		}

		if (this.customMenubar.value) {
			this._register(this.customMenubar.value.onFocusStateChange(e => this.onMenubarFocusChanged(e)));
		}
	}

	private onMenubarFocusChanged(focused: boolean): void {
		if ((isWindows || isLinux) && this.currentMenubarVisibility !== 'compact' && this.dragRegion) {
			if (focused) {
				hide(this.dragRegion);
			} else {
				show(this.dragRegion);
			}
		}
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		const result = super.createContentArea(parent);
		const targetWindow = getWindow(parent);
		const targetWindowId = getWindowId(targetWindow);

		// Native menu controller
		if (isMacintosh || hasNativeMenu(this.configurationService)) {
			this._register(this.instantiationService.createInstance(NativeMenubarControl));
		}

		// Full Screen Window Controls (macOS, when the window covers the menu bar)
		if (isMacintosh) {
			this.createFullScreenWindowControls(targetWindow);
			this.layoutDisplayCutout();
		}

		// App Icon (Native Windows/Linux)
		if (this.appIcon) {
			this.onUpdateAppIconDragBehavior();

			this._register(addDisposableListener(this.appIcon, EventType.DBLCLICK, (() => {
				this.nativeHostService.closeWindow({ targetWindowId });
			})));
		}

		// Custom Window Controls (Native Windows/Linux)
		if (
			!hasNativeTitlebar(this.configurationService) &&		// not for native title bars
			!useWindowControlsOverlay(this.configurationService) &&	// not when controls are natively drawn
			this.windowControlsContainer
		) {

			// Minimize
			const minimizeIcon = append(this.windowControlsContainer, $('div.window-icon.window-minimize' + ThemeIcon.asCSSSelector(Codicon.chromeMinimize)));
			this._register(addDisposableListener(minimizeIcon, EventType.CLICK, () => {
				this.nativeHostService.minimizeWindow({ targetWindowId });
			}));

			// Restore
			this.maxRestoreControl = append(this.windowControlsContainer, $('div.window-icon.window-max-restore'));
			this._register(addDisposableListener(this.maxRestoreControl, EventType.CLICK, async () => {
				const maximized = await this.nativeHostService.isMaximized({ targetWindowId });
				if (maximized) {
					return this.nativeHostService.unmaximizeWindow({ targetWindowId });
				}

				return this.nativeHostService.maximizeWindow({ targetWindowId });
			}));

			// Close
			const closeIcon = append(this.windowControlsContainer, $('div.window-icon.window-close' + ThemeIcon.asCSSSelector(Codicon.chromeClose)));
			this._register(addDisposableListener(closeIcon, EventType.CLICK, () => {
				this.nativeHostService.closeWindow({ targetWindowId });
			}));

			// Resizer
			this.resizer = append(this.rootContainer, $('div.resizer'));
			this._register(Event.runAndSubscribe(this.layoutService.onDidChangeWindowMaximized, ({ windowId, maximized }) => {
				if (windowId === targetWindowId) {
					this.onDidChangeWindowMaximized(maximized);
				}
			}, { windowId: targetWindowId, maximized: this.layoutService.isWindowMaximized(targetWindow) }));
		}

		// Window System Context Menu
		// See https://github.com/electron/electron/issues/24893
		if (isWindows && !hasNativeTitlebar(this.configurationService)) {
			this._register(this.nativeHostService.onDidTriggerWindowSystemContextMenu(({ windowId, x, y }) => {
				if (targetWindowId !== windowId) {
					return;
				}

				const zoomFactor = getZoomFactor(getWindow(this.element));
				this.onContextMenu(new MouseEvent(EventType.MOUSE_UP, { clientX: x / zoomFactor, clientY: y / zoomFactor }), MenuId.TitleBarContext);
			}));
		}

		return result;
	}

	private onDidChangeWindowMaximized(maximized: boolean): void {
		if (this.maxRestoreControl) {
			if (maximized) {
				this.maxRestoreControl.classList.remove(...ThemeIcon.asClassNameArray(Codicon.chromeMaximize));
				this.maxRestoreControl.classList.add(...ThemeIcon.asClassNameArray(Codicon.chromeRestore));
			} else {
				this.maxRestoreControl.classList.remove(...ThemeIcon.asClassNameArray(Codicon.chromeRestore));
				this.maxRestoreControl.classList.add(...ThemeIcon.asClassNameArray(Codicon.chromeMaximize));
			}
		}

		if (this.resizer) {
			if (maximized) {
				hide(this.resizer);
			} else {
				show(this.resizer);
			}
		}
	}

	override updateStyles(): void {
		super.updateStyles();

		// Part container
		if (this.element) {

			// Black around a camera cutout, so that the cutout disappears into the title bar.
			// A light theme's title bar colors would not show on black, so they get dark ones.
			const hidesCutout = !!this.screenCutout;
			const hasLightTheme = hidesCutout && this.element.classList.contains('light');
			this.element.classList.toggle('display-cutout', hidesCutout);
			this.element.classList.toggle('display-cutout-light-theme', hasLightTheme);
			if (hidesCutout) {
				this.element.style.backgroundColor = Color.black.toString();
				this.element.classList.remove('light');
				if (hasLightTheme) {
					this.element.style.color = ''; // from the styles for light themes
				}
			}

			// The height reaches below a camera cutout by the border, if there is one
			const hasBorder = !!this.element.style.borderBottom;
			if (hasBorder !== this.hasBorder) {
				this.hasBorder = hasBorder;
				if (hidesCutout) {
					this._onDidChange.fire(undefined);
				}
			}

			if (useWindowControlsOverlay(this.configurationService)) {
				if (
					!this.cachedWindowControlStyles ||
					this.cachedWindowControlStyles.bgColor !== this.element.style.backgroundColor ||
					this.cachedWindowControlStyles.fgColor !== this.element.style.color
				) {
					// Convert colors to hex format for Electron's setTitleBarOverlay API
					// which doesn't support CSS Color Level 4 color() function syntax
					const bgColor = this.element.style.backgroundColor;
					const fgColor = this.element.style.color;
					this.nativeHostService.updateWindowControls({
						targetWindowId: getWindowId(getWindow(this.element)),
						backgroundColor: bgColor ? Color.Format.CSS.formatHex(Color.Format.CSS.parse(bgColor)!) : undefined,
						foregroundColor: fgColor ? Color.Format.CSS.formatHex(Color.Format.CSS.parse(fgColor)!) : undefined
					});
				}
			}
		}
	}

	override layout(width: number, height: number): void {
		super.layout(width, height);

		this.layoutDisplayCutout(); // the zoom may have changed

		if (useWindowControlsOverlay(this.configurationService)) {
			const newHeight = Math.round(height * getZoomFactor(getWindow(this.element)));
			if (newHeight !== this.cachedWindowControlHeight) {
				this.cachedWindowControlHeight = newHeight;
				this.nativeHostService.updateWindowControls({
					targetWindowId: getWindowId(getWindow(this.element)),
					height: newHeight
				});
			}
		}
	}
}

export class MainNativeTitlebarPart extends NativeTitlebarPart {

	constructor(
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@INativeHostService nativeHostService: INativeHostService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IActionViewItemService actionViewItemService: IActionViewItemService
	) {
		super(Parts.TITLEBAR_PART, mainWindow, editorGroupService.mainPart, contextMenuService, configurationService, environmentService, instantiationService, themeService, storageService, layoutService, contextKeyService, hostService, nativeHostService, editorGroupService, editorService, menuService, keybindingService, actionViewItemService);
	}
}

export class AuxiliaryNativeTitlebarPart extends NativeTitlebarPart implements IAuxiliaryTitlebarPart {

	private static COUNTER = 1;

	get height() { return this.minimumHeight; }

	constructor(
		readonly container: HTMLElement,
		editorGroupsContainer: IEditorGroupsContainer,
		private readonly mainTitlebar: BrowserTitlebarPart,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@INativeHostService nativeHostService: INativeHostService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IActionViewItemService actionViewItemService: IActionViewItemService
	) {
		const id = AuxiliaryNativeTitlebarPart.COUNTER++;
		super(`workbench.parts.auxiliaryTitle.${id}`, getWindow(container), editorGroupsContainer, contextMenuService, configurationService, environmentService, instantiationService, themeService, storageService, layoutService, contextKeyService, hostService, nativeHostService, editorGroupService, editorService, menuService, keybindingService, actionViewItemService);
	}

	override get preventZoom(): boolean {

		// Prevent zooming behavior if any of the following conditions are met:
		// 1. Shrinking below the window control size (zoom < 1)
		// 2. No custom items are present in the main title bar
		// The auxiliary title bar never contains any zoomable items itself,
		// but we want to match the behavior of the main title bar.

		return getZoomFactor(getWindow(this.element)) < 1 || !this.mainTitlebar.hasZoomableElements;
	}
}

export class NativeTitleService extends BrowserTitleService {

	protected override createMainTitlebarPart(): MainNativeTitlebarPart {
		return this.instantiationService.createInstance(MainNativeTitlebarPart);
	}

	protected override doCreateAuxiliaryTitlebarPart(container: HTMLElement, editorGroupsContainer: IEditorGroupsContainer, instantiationService: IInstantiationService): AuxiliaryNativeTitlebarPart {
		return instantiationService.createInstance(AuxiliaryNativeTitlebarPart, container, editorGroupsContainer, this.mainPart);
	}
}
