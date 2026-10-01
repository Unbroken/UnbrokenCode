/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { KeyChord, KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ResolvedKeybindingItem } from '../../../../../platform/keybinding/common/resolvedKeybindingItem.js';
import { createUSLayoutResolvedKeybinding } from '../../../../../platform/keybinding/test/common/keybindingsTestUtils.js';
import { findSchemeKeybinding } from '../../common/keyboardShortcutsPreview.js';

suite('Unbroken Onboarding - Keyboard Shortcuts Preview', () => {

	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	function keybinding(keybinding: number, command: string, when?: string): ResolvedKeybindingItem {
		return new ResolvedKeybindingItem(
			createUSLayoutResolvedKeybinding(keybinding, OperatingSystem.Windows),
			command,
			undefined,
			ContextKeyExpr.deserialize(when),
			true,
			null,
			false
		);
	}

	// Default keybindings first, then the Visual Studio Keymap extension's, which take precedence
	const keybindings = [
		keybinding(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyB, 'workbench.action.tasks.build'),
		keybinding(KeyCode.F12, 'editor.action.revealDefinition', 'editorTextFocus'),
		keybinding(KeyMod.Alt | KeyCode.KeyO, 'clangd.switchheadersource', 'editorTextFocus'),
		keybinding(KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyC, 'workbench.debug.action.focusCallStackView', 'config.unbroken.keyboardShortcuts.scheme =~ /^visual/'),
		keybinding(KeyCode.F7, 'workbench.action.tasks.build', 'config.unbroken.keyboardShortcuts.scheme == \'visualCpp6\''),
		keybinding(KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyO), 'clangd.switchheadersource', 'config.unbroken.keyboardShortcuts.scheme =~ /^visual/ && editorTextFocus'),
		// User keybindings that assign F12, and Ctrl+K, which starts the scheme's Ctrl+K Ctrl+O, to other commands
		keybinding(KeyCode.F12, 'workbench.action.files.save'),
		keybinding(KeyMod.CtrlCmd | KeyCode.KeyK, 'workbench.action.files.saveAll'),
		// An unbound entry, such as `{ "key": "", "command": ... }` in keybindings.json
		keybinding(0, 'workbench.action.files.saveAs'),
	];

	test('resolves the keybinding each scheme gives a command', () => {
		const contextKeyService = testDisposables.add(new ContextKeyService(new TestConfigurationService()));

		const commands = ['workbench.action.tasks.build', 'workbench.debug.action.focusCallStackView', 'clangd.switchheadersource', 'editor.action.revealDefinition'];
		const result: Record<string, Record<string, string | null>> = {};
		for (const scheme of ['vscode', 'visualStudio', 'visualCpp6']) {
			result[scheme] = {};
			for (const command of commands) {
				result[scheme][command] = findSchemeKeybinding(keybindings, contextKeyService, scheme, command, { editorTextFocus: true })?.getUserSettingsLabel() ?? null;
			}
		}

		assert.deepStrictEqual(result, {
			vscode: {
				'workbench.action.tasks.build': 'ctrl+shift+b',
				'workbench.debug.action.focusCallStackView': null,
				'clangd.switchheadersource': 'alt+o',
				'editor.action.revealDefinition': null,
			},
			visualStudio: {
				'workbench.action.tasks.build': 'ctrl+shift+b',
				'workbench.debug.action.focusCallStackView': 'ctrl+alt+c',
				'clangd.switchheadersource': 'alt+o',
				'editor.action.revealDefinition': null,
			},
			visualCpp6: {
				'workbench.action.tasks.build': 'f7',
				'workbench.debug.action.focusCallStackView': 'ctrl+alt+c',
				'clangd.switchheadersource': 'alt+o',
				'editor.action.revealDefinition': null,
			},
		});
	});

	test('keys that wait for another chord can still run the scheme\'s keybinding', () => {
		const contextKeyService = testDisposables.add(new ContextKeyService(new TestConfigurationService()));

		const chordKeybindings = [
			keybinding(KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyC), 'editor.action.commentLine', 'config.unbroken.keyboardShortcuts.scheme =~ /^visual/'),
			keybinding(KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyU), 'editor.action.removeCommentLine', 'config.unbroken.keyboardShortcuts.scheme =~ /^visual/'),
			// User keybindings: Ctrl+K saves all, but a later Ctrl+K Ctrl+X makes Ctrl+K wait for the next chord,
			// and Ctrl+K Ctrl+U runs another command
			keybinding(KeyMod.CtrlCmd | KeyCode.KeyK, 'workbench.action.files.saveAll'),
			keybinding(KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyX), 'editor.action.trimTrailingWhitespace'),
			keybinding(KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyU), 'editor.action.transformToUppercase'),
		];

		const result: Record<string, string | null> = {};
		for (const command of ['editor.action.commentLine', 'editor.action.removeCommentLine', 'workbench.action.files.saveAll']) {
			result[command] = findSchemeKeybinding(chordKeybindings, contextKeyService, 'visualStudio', command, {})?.getUserSettingsLabel() ?? null;
		}

		assert.deepStrictEqual(result, {
			'editor.action.commentLine': 'ctrl+k ctrl+c',
			'editor.action.removeCommentLine': null,
			'workbench.action.files.saveAll': null,
		});
	});
});
