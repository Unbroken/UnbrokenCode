/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from '../../../base/common/platform.js';
import { EditorOption, EditorOptions } from './editorOptions.js';
import { IValidatedEditorOptions, BareFontInfo } from './fontInfo.js';

export function resolveDisableFontHinting(disableFontHinting: 'auto' | 'on' | 'off', fontFamily: string): boolean {
	if (disableFontHinting === 'on') {
		return true;
	}
	if (disableFontHinting === 'off') {
		return false;
	}
	// 'auto': enable on Windows when using an Unbroken font
	return platform.isWindows && /(?:^|,)\s*(?:"|')?Unbroken/i.test(fontFamily);
}

export function createBareFontInfoFromValidatedSettings(options: IValidatedEditorOptions, pixelRatio: number, ignoreEditorZoom: boolean): BareFontInfo {
	const fontFamily = options.get(EditorOption.fontFamily);
	const fontWeight = options.get(EditorOption.fontWeight);
	const fontSize = options.get(EditorOption.fontSize);
	const fontFeatureSettings = options.get(EditorOption.fontLigatures);
	const fontVariationSettings = options.get(EditorOption.fontVariations);
	const lineHeight = options.get(EditorOption.lineHeight);
	const letterSpacing = options.get(EditorOption.letterSpacing);
	const disableFontHintingSetting = options.get(EditorOption.disableFontHinting);
	const disableFontHinting = resolveDisableFontHinting(disableFontHintingSetting, fontFamily);
	return BareFontInfo._create(fontFamily, fontWeight, fontSize, fontFeatureSettings, fontVariationSettings, lineHeight, letterSpacing, pixelRatio, ignoreEditorZoom, disableFontHinting);
}

export function createBareFontInfoFromRawSettings(opts: {
	fontFamily?: unknown;
	fontWeight?: unknown;
	fontSize?: unknown;
	fontLigatures?: unknown;
	fontVariations?: unknown;
	lineHeight?: unknown;
	letterSpacing?: unknown;
	disableFontHinting?: unknown;
}, pixelRatio: number, ignoreEditorZoom: boolean = false): BareFontInfo {
	const fontFamily = EditorOptions.fontFamily.validate(opts.fontFamily);
	const fontWeight = EditorOptions.fontWeight.validate(opts.fontWeight);
	const fontSize = EditorOptions.fontSize.validate(opts.fontSize);
	const fontFeatureSettings = EditorOptions.fontLigatures2.validate(opts.fontLigatures);
	const fontVariationSettings = EditorOptions.fontVariations.validate(opts.fontVariations);
	const lineHeight = EditorOptions.lineHeight.validate(opts.lineHeight);
	const letterSpacing = EditorOptions.letterSpacing.validate(opts.letterSpacing);
	const disableFontHintingSetting = EditorOptions.disableFontHinting.validate(opts.disableFontHinting);
	const disableFontHinting = resolveDisableFontHinting(disableFontHintingSetting, fontFamily);
	return BareFontInfo._create(fontFamily, fontWeight, fontSize, fontFeatureSettings, fontVariationSettings, lineHeight, letterSpacing, pixelRatio, ignoreEditorZoom, disableFontHinting);
}
