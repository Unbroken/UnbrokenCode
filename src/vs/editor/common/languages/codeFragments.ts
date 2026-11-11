/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isHighSurrogate, isLowSurrogate } from '../../../base/common/strings.js';

/**
 * What a code fragment is: the name, type or value of a debugger variable, code that a message, such as a compiler
 * error, quotes, or the name of a stack frame, such as a function's signature.
 */
export type CodeFragmentKind = 'name' | 'type' | 'value' | 'quoted' | 'stackFrame';

/**
 * A rule that gives the words a regular expression matches a semantic token type in code fragments, the short pieces of
 * code shown outside editors, such as the names of debugger variables and the types quoted in compiler errors.
 */
export interface CodeFragmentTokenRule {
	/**
	 * The source of a JavaScript regular expression. It is tried where a word starts and at characters outside words,
	 * and counts only when its match ends where a word ends, so `int` doesn't match the start of `int32`.
	 */
	readonly regex: string;
	readonly tokenType: string;
	readonly tokenModifiers?: readonly string[];
	/**
	 * The kinds of fragments the rule applies to, all when unset.
	 */
	readonly kinds?: readonly CodeFragmentKind[];
}

/**
 * The rules an extension registers for the code fragments of the documents its selector matches.
 */
export interface CodeFragmentTokenRules {
	readonly rules: readonly CodeFragmentTokenRule[];
}

/**
 * A range of a code fragment that a rule matched.
 */
export interface ICodeFragmentToken {
	readonly start: number;
	readonly end: number;
	readonly tokenType: string;
	readonly tokenModifiers: readonly string[];
}

interface ICompiledRule {
	readonly regex: RegExp;
	readonly rule: CodeFragmentTokenRule;
}

const compiledRules = new WeakMap<CodeFragmentTokenRules, readonly ICompiledRule[]>();

// Where a match ends a word: after a character that isn't one of a word, or before one, so that of in|int, int is
// found in int rather than in rejected
const wordEnd = '(?:(?<![\\p{L}\\p{N}_$])|(?![\\p{L}\\p{N}_$]))';

/**
 * The rule's regex, sticky so it matches only where it is tried, and with where it ends a word, which needs the u flag.
 * A regex that's invalid with it, such as one with the escape \:, is used as it is, and only the end it first matches
 * is checked.
 */
function compileRegex(regex: string): RegExp {
	try {
		return new RegExp(`(?:${regex})${wordEnd}`, 'yu');
	} catch {
		return new RegExp(regex, 'y');
	}
}

function compileRules(rules: CodeFragmentTokenRules): readonly ICompiledRule[] {
	let compiled = compiledRules.get(rules);
	if (!compiled) {
		const result: ICompiledRule[] = [];
		for (const rule of rules.rules) {
			try {
				result.push({ regex: compileRegex(rule.regex), rule });
			} catch {
				// An invalid rule matches nothing
			}
		}
		compiled = result;
		compiledRules.set(rules, compiled);
	}
	return compiled;
}

const wordCharacter = /[\p{L}\p{N}_$]/u;

/**
 * Whether the code point at an offset of UTF-16 code units is a word character. Letters outside the Basic Multilingual
 * Plane, such as 𝛂, take two code units.
 */
function isWordCharacterAt(text: string, offset: number): boolean {
	const codePoint = offset >= 0 ? text.codePointAt(offset) : undefined;
	return codePoint !== undefined && wordCharacter.test(String.fromCodePoint(codePoint));
}

/**
 * Whether the code point that ends at an offset of UTF-16 code units is a word character.
 */
function isWordCharacterBefore(text: string, offset: number): boolean {
	const lowSurrogate = offset >= 2 && isLowSurrogate(text.charCodeAt(offset - 1)) && isHighSurrogate(text.charCodeAt(offset - 2));
	return isWordCharacterAt(text, offset - (lowSurrogate ? 2 : 1));
}

function codePointLength(text: string, offset: number): number {
	return (text.codePointAt(offset) ?? 0) > 0xFFFF ? 2 : 1;
}

/**
 * The ranges of a code fragment that the rules match. Rule sets are tried in order, and the rules of a set in their
 * order, and the first rule that matches at an offset wins. Of a fragment of a kind, only the rules for that kind are
 * tried.
 */
export function computeCodeFragmentTokens(text: string, ruleSets: readonly CodeFragmentTokenRules[], kind?: CodeFragmentKind): ICodeFragmentToken[] {
	const compiledSets = ruleSets
		.map(rules => compileRules(rules).filter(({ rule }) => !kind || !rule.kinds || rule.kinds.includes(kind)))
		.filter(set => set.length > 0);
	const result: ICodeFragmentToken[] = [];
	if (!compiledSets.length) {
		return result;
	}

	let offset = 0;
	while (offset < text.length) {
		// Inside a word, or at whitespace, no rule can start a match
		if ((isWordCharacterBefore(text, offset) && isWordCharacterAt(text, offset)) || /\s/.test(text[offset])) {
			offset += codePointLength(text, offset);
			continue;
		}

		const match = matchRules(text, offset, compiledSets);
		if (match) {
			result.push(match);
			offset = match.end;
		} else {
			offset += codePointLength(text, offset);
		}
	}

	return result;
}

function matchRules(text: string, offset: number, compiledSets: readonly (readonly ICompiledRule[])[]): ICodeFragmentToken | undefined {
	for (const compiledRules of compiledSets) {
		for (const { regex, rule } of compiledRules) {
			regex.lastIndex = offset;
			const match = regex.exec(text);
			if (!match || !match[0].length) {
				continue;
			}
			const end = offset + match[0].length;
			if (isWordCharacterBefore(text, end) && isWordCharacterAt(text, end)) {
				continue;
			}
			return { start: offset, end, tokenType: rule.tokenType, tokenModifiers: rule.tokenModifiers ?? [] };
		}
	}
	return undefined;
}

/**
 * A range of a message.
 */
export interface ICodeFragmentRange {
	readonly start: number;
	readonly end: number;
}

const quotePairs: ReadonlyMap<string, string> = new Map([
	['\'', '\''],
	['‘', '’'],
	['`', '`'],
]);

// A character literal in C and C++: 'a', '\'', '\x02', u8'a'. Its hex escapes are of at most 8 digits, so trying one
// takes few steps.
const characterLiteral = /'(?:\\(?:x[\da-fA-F]{1,8}|[0-7]{1,3}|u[\da-fA-F]{4}|U[\da-fA-F]{8}|.)|[^'\\\n])'/y;

/**
 * Where the string literal that starts at an offset, whose quotes, such as the ' of "it's", aren't those of the code,
 * ends, or -1 where it doesn't on its line, and how many characters were scanned to find out.
 */
function scanStringLiteral(message: string, start: number): { end: number; scanned: number } {
	for (let offset = start + 1; offset < message.length; ++offset) {
		const character = message[offset];
		if (character === '\\') {
			++offset;
		} else if (character === '"') {
			return { end: offset + 1, scanned: offset + 1 - start };
		} else if (character === '\n' || character === '\r') {
			return { end: -1, scanned: offset - start };
		}
	}
	return { end: -1, scanned: message.length - start };
}
/**
 * Whether the word that ends at a quote is the prefix of a character literal: L'a', u'a', U'a' or u8'a'.
 */
function startsCharacterLiteral(message: string, wordStart: number, quote: number): boolean {
	return wordStart >= 0 && quote - wordStart <= 2 && /^(?:u8|[uUL])$/.test(message.substring(wordStart, quote));
}

// What code doesn't end with, after which a quote starts a literal rather than ends the code
const afterOperator = /[=<>!|&,(+\-*/%^?:[{]/;

/**
 * The code that a message, such as a compiler error, quotes: `'...'` as Clang and MSVC quote it, `‘...’` as GCC does and
 * `` `...` `` as Rust and Markdown do. The ranges exclude the quotes. A quote opens only at the start of the message or
 * after whitespace or an opening bracket or separator, and closes only at the end or before whitespace or a closing
 * bracket or punctuation, so the apostrophe of "couldn't" isn't taken for a quote.
 */
export function findQuotedCodeFragments(message: string): ICodeFragmentRange[] {
	const result: ICodeFragmentRange[] = [];
	const opensAfter = /[\s([{<:,;=]/;
	const closesBefore = /[\s)\]}>.,:;!?]/;

	// Each quote that opens scans for where it closes, which in a message with many quotes that don't close would take
	// time quadratic in its length, so the scanning has a budget linear in it, after which the rest isn't searched
	let budget = 100_000 + 16 * message.length;
	let offset = 0;
	while (offset < message.length && budget > 0) {
		const closingQuote = quotePairs.get(message[offset]);
		if (!closingQuote || (offset > 0 && !opensAfter.test(message[offset - 1]))) {
			++offset;
			continue;
		}

		let end = -1;
		// Inside brackets the code can't end, so a quote there starts a character literal, as in <(char)'\x02', 1>, as it
		// does after an operator that follows code, as in X::Value == 'a' || X::Other == 'b', also with a prefix, L'a'
		let depth = 0;
		let lastNonSpace = '';
		let hasWord = false;
		// The word being read, and what came before it, for a word that is the prefix of a literal
		let wordStart = -1;
		let beforeWord = '';
		let hasWordBeforeWord = false;
		for (let candidate = offset + 1; candidate < message.length && budget > 0; ++candidate, --budget) {
			const character = message[candidate];
			if (character === '\n' || character === '\r') {
				break;
			}
			if (character === '(' || character === '[' || character === '<') {
				++depth;
			} else if ((character === ')' || character === ']' || character === '>') && message[candidate - 1] !== '-' && depth > 0) {
				--depth;
			} else if (character === '\'' && (depth > 0 || (startsCharacterLiteral(message, wordStart, candidate) ? hasWordBeforeWord && afterOperator.test(beforeWord) : hasWord && afterOperator.test(lastNonSpace)))) {
				characterLiteral.lastIndex = candidate;
				const literal = characterLiteral.exec(message);
				if (literal) {
					// The characters skipped count too, as each quote before can skip the same literal
					candidate += literal[0].length - 1;
					budget -= literal[0].length - 1;
					lastNonSpace = '\'';
					continue;
				}
			}
			if (character === '"') {
				// The characters scanned count too, also for a literal that doesn't end, as each quote before can scan
				// the same ones
				const literal = scanStringLiteral(message, candidate);
				budget -= literal.scanned - 1;
				if (literal.end >= 0) {
					candidate = literal.end - 1;
					lastNonSpace = '"';
					hasWord = true;
					continue;
				}
			}
			if (!/\s/.test(character)) {
				if (/[\w$]/.test(character) && (candidate === offset + 1 || !/[\w$]/.test(message[candidate - 1]))) {
					wordStart = candidate;
					beforeWord = lastNonSpace;
					hasWordBeforeWord = hasWord;
				}
				lastNonSpace = character;
				hasWord ||= /\w/.test(character);
			}
			if (character === closingQuote && (candidate + 1 === message.length || closesBefore.test(message[candidate + 1]))) {
				end = candidate;
				break;
			}
		}

		if (end > offset + 1) {
			result.push({ start: offset + 1, end });
			offset = end + 1;
		} else {
			++offset;
		}
	}

	return result;
}
