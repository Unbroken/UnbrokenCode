/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Generates contributes.keybindings in package.json from:
// - schemes/<scheme>.json: Visual Studio command => ["Scope::Keys", ...] for each keyboard mapping scheme
// - commandMap.json: Visual Studio command => VS Code command(s)
//
// Every keybinding is gated on the unbroken.keyboardShortcuts.scheme setting.
//
// Usage: node build/generate.mts

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** A Visual Studio command's bindings, as "Scope::Keys" strings. */
type VsBindings = Record<string, string[]>;

/** The VS Code command a Visual Studio command maps to. */
interface ICommandTarget {
	readonly command: string;
	readonly args?: unknown;
	readonly when?: string;
}

interface IKeybinding {
	readonly key: string;
	readonly mac: string | undefined;
	readonly command: string;
	readonly args: unknown;
	readonly when: string;
}

/** Lower is preferred: earlier Visual Studio commands and earlier bindings of a command. */
type Preference = [vsCommand: string, bindingIndex: number];

interface IKeybindingEntry {
	readonly binding: IKeybinding;
	readonly scopeIndex: number;
	preference: Preference;
	readonly schemes: Set<string>;
}

interface IContributedKeybinding {
	key: string;
	mac?: string;
	command: string;
	args?: unknown;
	when: string;
}

const settingKey = 'config.unbroken.keyboardShortcuts.scheme';

/** Visual Studio keyboard mapping schemes, in the order they are listed in the setting. */
const schemes = ['visualStudio', 'visualCpp6', 'visualCSharp2005', 'visualBasic6', 'visualCpp2', 'visualStudio6'];

/** The scheme all additional Visual Studio schemes are layered on. */
const defaultScheme = 'visualStudio';

/** Visual Studio binding scopes we support, in priority order (later wins). */
const scopes = new Map<string, string | undefined>([
	['Global', undefined],
	['Text Editor', 'editorTextFocus'],
]);

const keyNames = new Map<string, string>([
	['Up Arrow', 'up'],
	['Down Arrow', 'down'],
	['Left Arrow', 'left'],
	['Right Arrow', 'right'],
	['PgUp', 'pageup'],
	['Page Up', 'pageup'],
	['PgDn', 'pagedown'],
	['Page Down', 'pagedown'],
	['Home', 'home'],
	['End', 'end'],
	['Ins', 'insert'],
	['Insert', 'insert'],
	['Del', 'delete'],
	['Delete', 'delete'],
	['Bkspce', 'backspace'],
	['Backspace', 'backspace'],
	['Esc', 'escape'],
	['Escape', 'escape'],
	['Enter', 'enter'],
	['Tab', 'tab'],
	['Space', 'space'],
	['Spacebar', 'space'],
	['Break', 'pausebreak'],
	['Pause', 'pausebreak'],
	['Num *', 'numpad_multiply'],
	['Num +', 'numpad_add'],
	['Num -', 'numpad_subtract'],
	['Num /', 'numpad_divide'],
]);

const modifierNames = new Map<string, string>([
	['Ctrl', 'ctrl'],
	['Shift', 'shift'],
	['Alt', 'alt'],
]);

/**
 * macOS system shortcuts that Ctrl => Cmd conversion would collide with.
 * Bindings that use any of these keep VS Code's macOS keybinding instead.
 */
const macReservedChords = new Set([
	'cmd+space', // Spotlight
	'cmd+alt+space', // Finder search
	'cmd+tab', // Application switcher
	'cmd+shift+tab',
	'cmd+`', // Cycle windows
	'cmd+shift+`',
	'cmd+q', // Quit
	'cmd+shift+q', // Log out
	'cmd+h', // Hide
	'cmd+alt+h', // Hide others
	'cmd+m', // Minimize
	'cmd+alt+m', // Minimize all
	'cmd+alt+d', // Toggle Dock
	'cmd+alt+escape', // Force quit
	'cmd+,', // Settings, by macOS convention
]);

/**
 * Text navigation keys. macOS uses Cmd and Option with these for line and word movement,
 * so bindings that use them keep VS Code's macOS keybindings.
 */
const macTextNavigationKeys = new Set(['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'backspace', 'delete']);

/** Keys that Mac keyboards do not have. */
const macMissingKeys = new Set(['pausebreak']);

const buildDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(buildDirectory, '..', 'package.json');

function readJson<T>(file: string): T {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Converts a single Visual Studio chord such as "Ctrl+Shift+Down Arrow" to VS Code notation.
 */
function convertChord(chord: string): string | undefined {
	const modifiers = new Set<string>();
	let rest = chord.trim();
	for (; ;) {
		const match = /^(?<modifier>Ctrl|Shift|Alt)\+(?=.)/.exec(rest);
		if (!match) {
			break;
		}
		modifiers.add(modifierNames.get(match.groups!.modifier)!);
		rest = rest.slice(match[0].length);
	}

	let key: string;
	if (keyNames.has(rest)) {
		key = keyNames.get(rest)!;
	} else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(rest)) {
		key = rest.toLowerCase();
	} else if (/^[A-Z0-9]$/.test(rest)) {
		key = rest.toLowerCase();
	} else if (/^[-=[\]\\;',./`]$/.test(rest)) {
		key = rest;
	} else {
		return undefined;
	}

	return [...['ctrl', 'shift', 'alt'].filter(modifier => modifiers.has(modifier)), key].join('+');
}

/**
 * Converts Visual Studio keys such as "Ctrl+K, Ctrl+C" to VS Code notation ("ctrl+k ctrl+c").
 */
function convertKeys(keys: string): string[] | undefined {
	// Chords are separated by commas, but "Ctrl+," is the comma key
	const chords = keys.split(/(?<!\+),\s*/).map(convertChord);
	if (chords.some(chord => chord === undefined)) {
		return undefined;
	}
	return chords as string[];
}

function toMacChord(chord: string): string {
	return chord.replace(/^ctrl\+/, 'cmd+');
}

/**
 * Splits a when clause on an operator that is not inside parentheses.
 */
function splitTopLevel(clause: string, operator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < clause.length; i++) {
		if (clause[i] === '(') {
			depth++;
		} else if (clause[i] === ')') {
			depth--;
		} else if (depth === 0 && clause.startsWith(operator, i)) {
			parts.push(clause.slice(start, i).trim());
			start = i + operator.length;
			i = start - 1;
		}
	}
	parts.push(clause.slice(start).trim());
	return parts;
}

/**
 * Combines when clauses with &&, dropping duplicate terms. Terms containing a top-level || are parenthesized.
 */
function andWhen(...clauses: (string | undefined)[]): string {
	const terms: string[] = [];
	for (const clause of clauses) {
		if (!clause) {
			continue;
		}
		for (const term of splitTopLevel(clause, '&&')) {
			if (!terms.includes(term)) {
				terms.push(term);
			}
		}
	}
	return terms.map(term => splitTopLevel(term, '||').length > 1 ? `(${term})` : term).join(' && ');
}

function schemeCondition(schemeIds: string[]): string {
	if (schemeIds.length === schemes.length) {
		return `${settingKey} =~ /^visual/`;
	}
	if (schemeIds.length === 1) {
		return `${settingKey} == '${schemeIds[0]}'`;
	}
	return `${settingKey} =~ /^(${schemeIds.join('|')})$/`;
}

function loadScheme(scheme: string): VsBindings {
	const file = path.join(buildDirectory, 'schemes', `${scheme}.json`);
	if (fs.existsSync(file)) {
		return readJson<{ bindings: VsBindings }>(file).bindings;
	}
	console.warn(`No data for scheme '${scheme}', using the '${defaultScheme}' scheme`);
	return readJson<{ bindings: VsBindings }>(path.join(buildDirectory, 'schemes', `${defaultScheme}.json`)).bindings;
}

function comparePreference([commandA, indexA]: Preference, [commandB, indexB]: Preference): number {
	return commandA.localeCompare(commandB) || indexA - indexB;
}

const commandMap = readJson<Record<string, ICommandTarget | ICommandTarget[]>>(path.join(buildDirectory, 'commandMap.json'));

/** Keybinding identity => keybinding and the schemes it belongs to */
const keybindings = new Map<string, IKeybindingEntry>();
const unmappedCommands = new Map<string, string[]>();
const unsupportedKeys = new Set<string>();
const usedVsCommands = new Set<string>();

for (const scheme of schemes) {
	const bindings = loadScheme(scheme);
	for (const [vsCommand, vsBindings] of Object.entries(bindings)) {
		const mapping = commandMap[vsCommand];
		if (!mapping) {
			unmappedCommands.set(vsCommand, vsBindings);
			continue;
		}
		usedVsCommands.add(vsCommand);
		const targets = Array.isArray(mapping) ? mapping : [mapping];

		for (const vsBinding of vsBindings) {
			const separator = vsBinding.indexOf('::');
			const scope = vsBinding.slice(0, separator);
			if (!scopes.has(scope)) {
				continue;
			}
			const chords = convertKeys(vsBinding.slice(separator + 2));
			if (!chords) {
				unsupportedKeys.add(`${vsCommand}: ${vsBinding}`);
				continue;
			}

			const key = chords.join(' ');
			const macChords = chords.map(toMacChord);
			const macReserved = macChords.some(chord => {
				const keyName = chord.split('+').pop()!;
				return macReservedChords.has(chord) || macTextNavigationKeys.has(keyName) || macMissingKeys.has(keyName);
			});
			const mac = macChords.join(' ');

			for (const target of targets) {
				const binding: IKeybinding = {
					key,
					mac: macReserved || mac === key ? undefined : mac,
					command: target.command,
					args: target.args,
					// The scope's term goes after the target's, so identical conditions from different scopes deduplicate
					when: andWhen(target.when, scopes.get(scope), macReserved ? '!isMac' : undefined),
				};
				const identity = JSON.stringify(binding);
				const preference: Preference = [vsCommand, vsBindings.indexOf(vsBinding)];
				if (!keybindings.has(identity)) {
					keybindings.set(identity, { binding, scopeIndex: [...scopes.keys()].indexOf(scope), preference, schemes: new Set() });
				}
				const entry = keybindings.get(identity)!;
				if (comparePreference(preference, entry.preference) < 0) {
					entry.preference = preference;
				}
				entry.schemes.add(scheme);
			}
		}
	}
}

// The last matching keybinding of a command is its primary keybinding, shown in menus and the
// Command Palette. Keybindings specific to fewer schemes go last, so a scheme's own keys (such as
// F7 for Build in Visual C++ 6) are primary in that scheme. Otherwise the preferred binding goes last.
const sorted = [...keybindings.values()].sort((a, b) =>
	a.scopeIndex - b.scopeIndex
	|| a.binding.command.localeCompare(b.binding.command)
	|| b.schemes.size - a.schemes.size
	|| comparePreference(b.preference, a.preference)
	|| a.binding.key.localeCompare(b.binding.key)
	|| a.binding.when.localeCompare(b.binding.when)
);

const contributed = sorted.map(({ binding, schemes: bindingSchemes }): IContributedKeybinding => ({
	key: binding.key,
	...(binding.mac ? { mac: binding.mac } : {}),
	command: binding.command,
	...(binding.args ? { args: binding.args } : {}),
	when: andWhen(schemeCondition(schemes.filter(scheme => bindingSchemes.has(scheme))), binding.when),
}));

// Report keys bound to different commands under overlapping conditions in the same scheme
const byKey = new Map<string, IKeybinding>();
for (const { binding, scopeIndex, schemes: bindingSchemes } of sorted) {
	for (const scheme of bindingSchemes) {
		const identity = `${scheme} ${scopeIndex} ${binding.key}`;
		const existing = byKey.get(identity);
		if (existing && existing.command !== binding.command && existing.when === binding.when) {
			console.warn(`Conflict in ${scheme}: ${binding.key} => ${existing.command} and ${binding.command}`);
		}
		byKey.set(identity, binding);
	}
}

// Report single-chord keys that are also the first chord of a multi-chord key in the same scheme:
// the chord takes precedence, so the single-chord binding would never run
for (const scheme of schemes) {
	const singles = new Map<string, string>();
	const prefixes = new Map<string, string>();
	for (const { binding, schemes: bindingSchemes } of sorted) {
		if (!bindingSchemes.has(scheme)) {
			continue;
		}
		const [first, ...rest] = binding.key.split(' ');
		(rest.length ? prefixes : singles).set(first, binding.command);
	}
	for (const [first, command] of singles) {
		if (prefixes.has(first)) {
			console.warn(`Chord prefix conflict in ${scheme}: ${first} => ${command} is shadowed by ${first} ... => ${prefixes.get(first)}`);
		}
	}
}

const packageJson = readJson<{ contributes: { keybindings: IContributedKeybinding[] } }>(packageJsonPath);
packageJson.contributes.keybindings = contributed;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, undefined, 2) + '\n');

console.log(`Wrote ${contributed.length} keybindings to ${path.relative(process.cwd(), packageJsonPath)}`);
const unusedMappings = Object.keys(commandMap).filter(vsCommand => !usedVsCommands.has(vsCommand));
if (unusedMappings.length) {
	console.warn(`\ncommandMap.json maps Visual Studio commands no scheme binds: ${unusedMappings.join(', ')}`);
}
if (unsupportedKeys.size) {
	console.log(`\nSkipped ${unsupportedKeys.size} bindings with keys VS Code cannot express:`);
	for (const entry of [...unsupportedKeys].sort()) {
		console.log(`  ${entry}`);
	}
}
if (process.argv.includes('--unmapped')) {
	console.log(`\n${unmappedCommands.size} Visual Studio commands have no VS Code mapping:`);
	for (const [vsCommand, vsBindings] of [...unmappedCommands].sort(([a], [b]) => a.localeCompare(b))) {
		console.log(`  ${vsCommand}: ${vsBindings.join(' | ')}`);
	}
}
