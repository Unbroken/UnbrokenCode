/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { onUnexpectedExternalError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { LRUCache } from '../../../base/common/map.js';
import { URI } from '../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../platform/theme/common/themeService.js';
import { ColorId, FontStyle, StandardTokenType, TokenMetadata } from '../encodedTokenAttributes.js';
import { TokenizationRegistry } from '../languages.js';
import { CodeFragmentFormattingOptions, CodeFragmentKind, computeCodeFragmentTokens, findQuotedCodeFragments, ICodeFragmentToken } from '../languages/codeFragments.js';
import { ILanguageService } from '../languages/language.js';
import { ILanguageFeaturesService } from './languageFeatures.js';
import { IModelService } from './model.js';

export const ICodeFragmentService = createDecorator<ICodeFragmentService>('codeFragmentService');

/**
 * The class of each range of a code fragment that is styled, by which a view can style them all, such as to show the
 * code of a selected row in the color of the selection.
 */
export const codeFragmentTokenClassName = 'code-fragment-token';

/**
 * The CSS classes that style a range of a code fragment: the token classes the editor colors code with, and
 * {@link codeFragmentTokenClassName}.
 */
export interface ICodeFragmentStyle {
	readonly start: number;
	readonly end: number;
	readonly classNames: readonly string[];
}

/**
 * How to style a code fragment.
 */
export interface ICodeFragmentStyleOptions {
	readonly kind?: CodeFragmentKind;
	readonly defaultForeground?: boolean;
}

/**
 * Colors code fragments, the short pieces of code shown outside editors, such as the names of debugger variables and
 * the types quoted in compiler errors, like an editor colors the code of their language: the language's syntax
 * highlighting, with the token types of the rules extensions register on top.
 */
export interface ICodeFragmentService {
	readonly _serviceBrand: undefined;

	/**
	 * Fires when fragments may be styled or laid out differently than before: the theme, the rules, a tokenizer, the
	 * language of a file or the extensions that lay out code changed.
	 */
	readonly onDidChange: Event<void>;

	/**
	 * The styles of a fragment of the code of a resource, such as the file of a diagnostic or a stack frame: the colors
	 * the syntax highlighting gives its strings, comments and numbers, and the token types the rules give its words. A
	 * fragment of a language no extension registered rules for keeps the styling of where it is shown, so it has none.
	 *
	 * @param options.kind What the fragment is, which selects the rules that apply to it.
	 * @param options.defaultForeground Whether what neither colors has the default color of code, like in an editor,
	 * rather than the color of where the fragment is shown, such as the color of names in the debug views.
	 */
	getStyles(text: string, resource: URI, options?: ICodeFragmentStyleOptions): readonly ICodeFragmentStyle[];

	/**
	 * The styles of the code a message about a resource quotes, such as the types in a compiler error, as offsets into
	 * the message. Of a message shown only up to a length, the code is found in all of it, so that code the shown part
	 * ends is styled too, and styled up to the length.
	 */
	getQuotedCodeStyles(message: string, resource: URI, length?: number): readonly ICodeFragmentStyle[];

	/**
	 * Whether an extension colors the code of a resource, which is cheaper to ask than for the styles of a message.
	 */
	canColor(resource: URI): boolean;

	/**
	 * Whether an extension lays out the fragments of the code of a resource over lines.
	 */
	canFormat(resource: URI): boolean;

	/**
	 * For each fragment of the code of a resource, its text laid out over lines that fit a width by the extension that
	 * does that for the resource's language, or undefined where there is none or it leaves the fragment as is.
	 */
	format(fragments: readonly string[], resource: URI, options: CodeFragmentFormattingOptions, token: CancellationToken): Promise<(string | undefined)[]>;
}

// A number, with its sign where one starts it, its digit separators and its suffix, as the C family and languages such
// as Python, Rust and JavaScript write them: 42, -0x1F, 0o755, 1'000, 1_000, 1.5e-3f, 32u, 42u32, 1.0f64. A sign after
// a word, number or closing bracket is an operator: the - of a - 1.
const numberLiteral = /(?:(?<![\p{L}\p{N}_$.)\]}]\s*)[-+](?=\.?\d))?(?<![\p{L}\p{N}_$.])(?:0[xXbBoO][\da-fA-F'_]+|\d[\d'_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)(?:[\p{L}_][\p{L}\p{N}_]*)?(?![\p{L}\p{N}_$])/gu;

// The most ranges a text is styled in, beyond which the rest isn't, so that rendering it makes a bounded number of
// elements, which can be passed as arguments, as to dom.reset
const maxStyles = 1000;

// A character of a name, which a length that cuts the name doesn't cut before it is styled
const wordCharacter = /[\p{L}\p{N}_$]/u;

interface ICharacterStyle {
	foreground: number | undefined;
	fontStyle: FontStyle;
	/** Whether the syntax highlighting takes the character for part of a string or comment, which the rules leave be */
	inStringOrComment?: boolean;
}

export class CodeFragmentService extends Disposable implements ICodeFragmentService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _cache = new LRUCache<string, readonly ICodeFragmentStyle[]>(500);
	private readonly _formattedCache = new LRUCache<string, string | undefined>(500);
	private _formattingProviderGeneration = 0;
	private readonly _requestedLanguages = new Set<string>();
	private readonly _activatedLanguages = new Set<string>();

	constructor(
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IModelService private readonly _modelService: IModelService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super();

		this._register(this._languageFeaturesService.codeFragmentTokenRules.onDidChange(() => this._changed()));
		this._register(this._languageFeaturesService.codeFragmentFormattingProvider.onDidChange(() => {
			this._formattedCache.clear();
			++this._formattingProviderGeneration;
			this._onDidChange.fire();
		}));
		this._register(this._themeService.onDidColorThemeChange(() => this._changed()));
		// The fragments of a file are styled as code of its language, which can change, also when a model of it is added or
		// removed, such as a debugger's source with the language the debugger gives it
		this._register(this._modelService.onModelLanguageChanged(() => this._changed()));
		this._register(this._modelService.onModelAdded(() => this._changed()));
		this._register(this._modelService.onModelRemoved(() => this._changed()));
		// And, for a file that isn't open, when the languages files are associated with change
		this._register(this._languageService.onDidChange(() => this._changed()));
		this._register(TokenizationRegistry.onDidChange(e => {
			if (e.changedColorMap || e.changedLanguages.some(languageId => this._requestedLanguages.has(languageId))) {
				this._changed();
			}
		}));
	}

	/**
	 * Asks for the features of a language, as an extension that registers rules for it can activate on its use, also for
	 * a file that isn't open, such as the source of a stack frame.
	 */
	private _activate(languageId: string): void {
		if (!this._activatedLanguages.has(languageId)) {
			this._activatedLanguages.add(languageId);
			this._languageService.requestRichLanguageFeatures(languageId);
		}
	}

	private _changed(): void {
		this._cache.clear();
		this._onDidChange.fire();
	}

	private _getLanguageId(resource: URI): string | null {
		return this._modelService.getModel(resource)?.getLanguageId() ?? this._languageService.guessLanguageIdByFilepathOrFirstLine(resource);
	}

	canColor(resource: URI): boolean {
		const languageId = this._getLanguageId(resource);
		if (!languageId) {
			return false;
		}
		this._activate(languageId);
		return this._languageFeaturesService.codeFragmentTokenRules.orderedForResource(resource, languageId).length > 0;
	}

	canFormat(resource: URI): boolean {
		const languageId = this._getLanguageId(resource);
		return !!languageId && this._languageFeaturesService.codeFragmentFormattingProvider.orderedForResource(resource, languageId).length > 0;
	}

	async format(fragments: readonly string[], resource: URI, options: CodeFragmentFormattingOptions, token: CancellationToken): Promise<(string | undefined)[]> {
		const result: (string | undefined)[] = fragments.map(() => undefined);
		const languageId = this._getLanguageId(resource);
		const provider = languageId ? this._languageFeaturesService.codeFragmentFormattingProvider.orderedForResource(resource, languageId)[0] : undefined;
		if (!languageId || !provider) {
			return result;
		}

		const keyPrefix = `${languageId}\n${resource.toString()}\n${options.maxColumns}\n${options.tabSize}\n${options.insertSpaces}\n`;
		const missing: number[] = [];
		fragments.forEach((fragment, index) => {
			const key = keyPrefix + fragment;
			if (this._formattedCache.has(key)) {
				result[index] = this._formattedCache.get(key);
			} else {
				missing.push(index);
			}
		});
		if (!missing.length) {
			return result;
		}

		try {
			// The results of a provider that was replaced while it was asked aren't kept
			const generation = this._formattingProviderGeneration;
			const formatted = await provider.provideCodeFragmentFormatting(resource, languageId, missing.map(index => fragments[index]), options, token);
			// No results, unlike results that leave fragments as they are, are no answer, which isn't kept, so the
			// fragments are asked for again, such as once the formatter is available
			if (token.isCancellationRequested || !formatted) {
				return result;
			}
			missing.forEach((index, i) => {
				const text = formatted?.[i];
				result[index] = typeof text === 'string' ? text : undefined;
				if (generation === this._formattingProviderGeneration) {
					this._formattedCache.set(keyPrefix + fragments[index], result[index]);
				}
			});
		} catch (error) {
			onUnexpectedExternalError(error);
		}
		return result;
	}

	getStyles(text: string, resource: URI, options?: ICodeFragmentStyleOptions): readonly ICodeFragmentStyle[] {
		if (!text) {
			return [];
		}

		const languageId = this._getLanguageId(resource);
		if (!languageId) {
			return [];
		}

		this._activate(languageId);
		const ruleSets = this._languageFeaturesService.codeFragmentTokenRules.orderedForResource(resource, languageId);
		if (!ruleSets.length) {
			return [];
		}

		const defaultForeground = !!options?.defaultForeground;
		const key = `${languageId}\n${resource.toString()}\n${options?.kind}\n${defaultForeground}\n${text}`;
		let styles = this._cache.get(key);
		if (!styles) {
			const characters = this._getSyntaxStyles(text, languageId);
			this._applyRules(languageId, computeCodeFragmentTokens(text, ruleSets, options?.kind), characters);
			styles = toStyles(characters, defaultForeground).slice(0, maxStyles);
			this._cache.set(key, styles);
		}
		return styles;
	}

	getQuotedCodeStyles(message: string, resource: URI, length = message.length): readonly ICodeFragmentStyle[] {
		const result: ICodeFragmentStyle[] = [];
		// A message about a file of a language no rules are registered for isn't searched for code
		const languageId = this._modelService.getModel(resource)?.getLanguageId() ?? this._languageService.guessLanguageIdByFilepathOrFirstLine(resource);
		if (languageId) {
			this._activate(languageId);
		}
		if (!languageId || !this._languageFeaturesService.codeFragmentTokenRules.orderedForResource(resource, languageId).length) {
			return result;
		}
		for (const fragment of findQuotedCodeFragments(message)) {
			if (fragment.start >= length) {
				break;
			}
			// A name the length cuts is styled whole, as the rules take it, and then cut, unless it is too long to
			let end = Math.min(fragment.end, length);
			while (end < fragment.end && end - length < 256 && wordCharacter.test(message[end])) {
				++end;
			}
			for (const style of this.getStyles(message.substring(fragment.start, end), resource, { kind: 'quoted' })) {
				if (result.length >= maxStyles) {
					return result;
				}
				if (fragment.start + style.start < length) {
					result.push({ start: fragment.start + style.start, end: Math.min(fragment.start + style.end, length), classNames: style.classNames });
				}
			}
		}
		return result;
	}

	private _getSyntaxStyles(text: string, languageId: string): ICharacterStyle[] {
		const characters: ICharacterStyle[] = [];
		for (let i = 0; i < text.length; ++i) {
			characters.push({ foreground: undefined, fontStyle: FontStyle.None });
		}

		// The grammar sees a fragment without the code around it, so the scopes it gives names, punctuation and operators,
		// such as the :: and < of a qualified template name it takes for a type, or a word after a string, can differ from
		// those in a document. Only the styles of its strings and comments are taken from it.
		// The fragments of a language are styled again when its tokenizer changes, such as when it has loaded
		const tokenizationSupport = TokenizationRegistry.get(languageId);
		const requested = this._requestedLanguages.has(languageId);
		this._requestedLanguages.add(languageId);
		if (!tokenizationSupport) {
			if (!requested) {
				this._languageService.requestRichLanguageFeatures(languageId);
				TokenizationRegistry.getOrCreate(languageId);
			}
		} else {
			try {
				let state = tokenizationSupport.getInitialState();
				const lineBreak = /\r\n|\r|\n/g;
				let lineStart = 0;
				while (lineStart <= text.length) {
					const lineBreakMatch = lineBreak.exec(text);
					const lineEnd = lineBreakMatch ? lineBreakMatch.index : text.length;
					const line = text.substring(lineStart, lineEnd);
					const result = tokenizationSupport.tokenizeEncoded(line, true, state);
					const tokens = result.tokens;
					for (let i = 0; i < tokens.length; i += 2) {
						const metadata = tokens[i + 1];
						const tokenType = TokenMetadata.getTokenType(metadata);
						if (tokenType !== StandardTokenType.String && tokenType !== StandardTokenType.Comment) {
							continue;
						}
						const foreground = TokenMetadata.getForeground(metadata);
						const style: ICharacterStyle = { foreground: foreground > ColorId.DefaultForeground ? foreground : undefined, fontStyle: TokenMetadata.getFontStyle(metadata), inStringOrComment: true };
						const end = i + 2 < tokens.length ? tokens[i + 2] : line.length;
						characters.fill(style, lineStart + tokens[i], lineStart + end);
					}
					state = result.endState;
					if (!lineBreakMatch) {
						break;
					}
					lineStart = lineEnd + lineBreakMatch[0].length;
				}
			} catch {
				// A fragment that isn't code the tokenizer can take keeps the rules' styles
			}
		}

		// Numbers, which the grammar doesn't mark, have the theme's style of numbers, all of them, whatever scopes the
		// grammar gives their parts
		const numberStyle = this._themeService.getColorTheme().getTokenStyleMetadata('number', [], languageId);
		if (numberStyle) {
			const style: ICharacterStyle = { foreground: numberStyle.foreground || undefined, fontStyle: toFontStyle(numberStyle) };
			for (const match of text.matchAll(numberLiteral)) {
				const end = match.index + match[0].length;
				if (!characters.slice(match.index, end).some(character => character.inStringOrComment)) {
					characters.fill(style, match.index, end);
				}
			}
		}

		return characters;
	}

	private _applyRules(languageId: string, tokens: readonly ICodeFragmentToken[], characters: ICharacterStyle[]): void {
		const theme = this._themeService.getColorTheme();
		for (const token of tokens) {
			// Words in strings and comments, such as the text of a string value, aren't code
			if (characters.slice(token.start, token.end).some(character => character.inStringOrComment)) {
				continue;
			}
			const style = theme.getTokenStyleMetadata(token.tokenType, [...token.tokenModifiers], languageId);
			if (!style) {
				continue;
			}
			for (let offset = token.start; offset < token.end; ++offset) {
				const character = characters[offset];
				let fontStyle = character.fontStyle;
				fontStyle = applyFontStyle(fontStyle, FontStyle.Bold, style.bold);
				fontStyle = applyFontStyle(fontStyle, FontStyle.Italic, style.italic);
				fontStyle = applyFontStyle(fontStyle, FontStyle.Underline, style.underline);
				fontStyle = applyFontStyle(fontStyle, FontStyle.Strikethrough, style.strikethrough);
				// A style without a color, such as only bold, has the color 0
				characters[offset] = { foreground: style.foreground || character.foreground, fontStyle };
			}
		}
	}
}

function toFontStyle(style: { readonly bold?: boolean; readonly italic?: boolean; readonly underline?: boolean; readonly strikethrough?: boolean }): FontStyle {
	return (style.bold ? FontStyle.Bold : 0) | (style.italic ? FontStyle.Italic : 0) | (style.underline ? FontStyle.Underline : 0) | (style.strikethrough ? FontStyle.Strikethrough : 0);
}

function applyFontStyle(fontStyle: FontStyle, flag: FontStyle, value: boolean | undefined): FontStyle {
	if (value === undefined) {
		return fontStyle;
	}
	return value ? fontStyle | flag : fontStyle & ~flag;
}

function getClassNames(style: ICharacterStyle, defaultForeground: boolean): string[] {
	const classNames: string[] = [];
	if (style.foreground !== undefined || defaultForeground) {
		classNames.push(codeFragmentTokenClassName);
		classNames.push(`mtk${style.foreground ?? ColorId.DefaultForeground}`);
	}
	if (style.fontStyle > FontStyle.None) {
		if (style.fontStyle & FontStyle.Italic) {
			classNames.push('mtki');
		}
		if (style.fontStyle & FontStyle.Bold) {
			classNames.push('mtkb');
		}
		if (style.fontStyle & FontStyle.Underline) {
			classNames.push('mtku');
		}
		if (style.fontStyle & FontStyle.Strikethrough) {
			classNames.push('mtks');
		}
	}
	return classNames;
}

function toStyles(characters: readonly ICharacterStyle[], defaultForeground: boolean): ICodeFragmentStyle[] {
	const styles: ICodeFragmentStyle[] = [];
	let start = 0;
	while (start < characters.length) {
		let end = start + 1;
		while (end < characters.length && characters[end].foreground === characters[start].foreground && characters[end].fontStyle === characters[start].fontStyle) {
			++end;
		}
		const classNames = getClassNames(characters[start], defaultForeground);
		if (classNames.length) {
			styles.push({ start, end, classNames });
		}
		start = end;
	}
	return styles;
}

registerSingleton(ICodeFragmentService, CodeFragmentService, InstantiationType.Delayed);
