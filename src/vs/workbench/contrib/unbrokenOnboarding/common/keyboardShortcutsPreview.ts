/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResolvedKeybinding } from '../../../../base/common/keybindings.js';
import { ContextKeyValue, IContext, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingResolver, ResultKind } from '../../../../platform/keybinding/common/keybindingResolver.js';
import { ResolvedKeybindingItem } from '../../../../platform/keybinding/common/resolvedKeybindingItem.js';

export const KEYBOARD_SHORTCUTS_SCHEME_SETTING = 'unbroken.keyboardShortcuts.scheme';

/**
 * Finds the keybinding a command would have with the given keyboard mapping scheme selected,
 * in a context where the given context keys have the given values.
 *
 * Unlike `IKeybindingService.lookupKeybinding`, this never falls back to a keybinding whose
 * when clause does not match, so keybindings of other schemes are not reported. Keys that run
 * another command, such as keys the user assigned to another command, are not reported either.
 */
export function findSchemeKeybinding(
	keybindings: readonly ResolvedKeybindingItem[],
	contextKeyService: IContextKeyService,
	schemeId: string,
	command: string,
	context: Record<string, ContextKeyValue>
): ResolvedKeybinding | undefined {
	const overlay = contextKeyService.createOverlay([
		[`config.${KEYBOARD_SHORTCUTS_SCHEME_SETTING}`, schemeId],
		...Object.entries(context),
	]);
	// The keys are resolved like they are when pressed: another keybinding can take them, or wait
	// for a chord that the keys don't continue with
	const resolver = new KeybindingResolver([...keybindings], [], () => { });
	const resolveContext = overlay.getContext(null);
	// Later keybindings take precedence
	for (let i = keybindings.length - 1; i >= 0; i--) {
		const keybinding = keybindings[i];
		if (keybinding.command === command && keybinding.resolvedKeybinding && keybinding.chords.length > 0
			&& overlay.contextMatchesRules(keybinding.when) && runsCommand(resolver, resolveContext, keybinding.chords, command)) {
			return keybinding.resolvedKeybinding;
		}
	}
	return undefined;
}

/**
 * Whether pressing the chords runs the command
 */
function runsCommand(resolver: KeybindingResolver, context: IContext, chords: readonly string[], command: string): boolean {
	for (let i = 0; i < chords.length; i++) {
		const result = resolver.resolve(context, chords.slice(0, i), chords[i]);
		if (i < chords.length - 1) {
			if (result.kind !== ResultKind.MoreChordsNeeded) {
				return false;
			}
		} else {
			return result.kind === ResultKind.KbFound && result.commandId === command;
		}
	}
	return false;
}
