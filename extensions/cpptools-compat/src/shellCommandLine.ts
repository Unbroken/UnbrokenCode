/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * An argument with explicit quoting, as accepted by `cppbuild` tasks.
 */
export interface IQuotedString {
	value: string;
	quoting: 'escape' | 'strong' | 'weak';
}

export type CommandString = string | IQuotedString;

export function commandStringValue(value: CommandString): string {
	return typeof value === 'string' ? value : value.value;
}

interface IShellQuoting {
	readonly escape?: { readonly escapeChar: string; readonly charsToEscape: string };
	readonly strong: string;
	readonly weak?: string;
}

const windowsQuoting: IShellQuoting = { strong: '"' };
const posixQuoting: IShellQuoting = { escape: { escapeChar: '\\', charsToEscape: ' "\'' }, strong: '\'', weak: '"' };

/**
 * Builds the command line the Microsoft C/C++ extension runs for a `cppbuild` task. The line is run
 * through a shell (`/bin/sh` or `cmd.exe`), so unquoted arguments such as `*.cpp` are expanded by it.
 * Plain string arguments are only quoted when they contain an unquoted space.
 *
 * @param unresolvedCommand The command before variables were resolved. A command without arguments is
 * used as a complete command line, unless it only got spaces from resolving variables.
 */
export function buildShellCommandLine(command: CommandString, args: readonly CommandString[], platform: NodeJS.Platform, unresolvedCommand: CommandString = command): string {
	const isWindows = platform === 'win32';
	const quoting = isWindows ? windowsQuoting : posixQuoting;

	if (args.length === 0 && typeof command === 'string' && (command === unresolvedCommand || (typeof unresolvedCommand === 'string' && needsQuotes(unresolvedCommand, quoting)))) {
		return command;
	}

	const [commandValue, commandQuoted] = quoteIfNecessary(command, quoting);
	let argQuoted = false;
	const parts = [commandValue];
	for (const arg of args) {
		const [value, quoted] = quoteIfNecessary(arg, quoting);
		parts.push(value);
		argQuoted ||= quoted;
	}

	let commandLine = parts.join(' ');
	if (isWindows) {
		// cmd.exe strips the outer quotes of `/c "a" "b"`, so the whole line needs another pair of quotes
		commandLine = `chcp 65001>nul && ${commandLine}`;
		if (commandQuoted && argQuoted) {
			commandLine = `"${commandLine}"`;
		}
		commandLine = `cmd /c ${commandLine}`;
	}
	return commandLine;
}

function quoteIfNecessary(value: CommandString, quoting: IShellQuoting): [string, boolean] {
	if (typeof value !== 'string') {
		return quote(value.value, value.quoting, quoting);
	}
	return needsQuotes(value, quoting) ? quote(value, 'strong', quoting) : [value, false];
}

function needsQuotes(value: string, quoting: IShellQuoting): boolean {
	if (value.length >= 2) {
		const first = value[0];
		if ((first === quoting.strong || first === quoting.weak) && value[value.length - 1] === first) {
			return false;
		}
	}
	let quote: string | undefined;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (quote !== undefined) {
			if (ch === quote) {
				quote = undefined;
			}
		} else if (ch === quoting.escape?.escapeChar) {
			i++;
		} else if (ch === quoting.strong || ch === quoting.weak) {
			quote = ch;
		} else if (ch === ' ') {
			return true;
		}
	}
	// An unbalanced quote, such as the apostrophe in `/tmp/John's/main.cpp`, is part of the value
	return quote !== undefined;
}

function quote(value: string, kind: IQuotedString['quoting'], quoting: IShellQuoting): [string, boolean] {
	if (kind === 'weak' && quoting.weak) {
		return [quoting.weak + value + quoting.weak, true];
	}
	if (kind === 'escape' && quoting.escape) {
		const { escapeChar, charsToEscape } = quoting.escape;
		let result = '';
		for (const ch of value) {
			result += charsToEscape.includes(ch) ? escapeChar + ch : ch;
		}
		return [result, true];
	}
	if (kind === 'strong') {
		// POSIX single quotes can't contain single quotes: end the quoting, add an escaped quote and quote again
		const escaped = quoting.strong === '\'' ? value.replaceAll('\'', '\'\\\'\'') : value;
		return [quoting.strong + escaped + quoting.strong, true];
	}
	return [value, false];
}

/**
 * Finds the output file a compiler command line writes to (`-o <file>`, or `/Fe<file>` and `/out:<file>`
 * for MSVC), so that its directory can be created before the build starts.
 */
export function findOutputPath(args: readonly CommandString[], platform: NodeJS.Platform): string | undefined {
	let previous: string | undefined;
	for (const arg of args) {
		const value = commandStringValue(arg);
		if (previous === '-o') {
			return unquote(value);
		}
		if (platform === 'win32' && value.includes('.exe')) {
			if (value.startsWith('/Fe')) {
				// The colon in `/Fe:<file>` is optional
				return unquote(value.substring(value.startsWith('/Fe:') ? 4 : 3));
			}
			if (value.toLowerCase().startsWith('/out:')) {
				return unquote(value.substring(5));
			}
		}
		previous = value;
	}
	return undefined;
}

/**
 * Removes the quotes around a path that is quoted for the shell, such as `"build dir/app"`.
 */
function unquote(value: string): string {
	if (value.length >= 2 && (value[0] === '"' || value[0] === '\'') && value[value.length - 1] === value[0]) {
		return value.substring(1, value.length - 1);
	}
	return value;
}
