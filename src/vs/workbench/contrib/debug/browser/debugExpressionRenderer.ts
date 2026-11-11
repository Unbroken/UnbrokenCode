/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IManagedHoverTooltipHTMLElement } from '../../../../base/browser/ui/hover/hover.js';
import * as dom from '../../../../base/browser/dom.js';
import { HighlightedLabel, IHighlight, renderStyledText } from '../../../../base/browser/ui/highlightedlabel/highlightedLabel.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeFragmentService, ICodeFragmentStyle } from '../../../../editor/common/services/codeFragmentService.js';
import { readEditorFontInfo, renderCodeHover } from '../../../../editor/browser/codeFragmentRenderer.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { observableConfigValue } from '../../../../platform/observable/common/platformObservableUtils.js';
import { IDebugService, IDebugSession, IExpression, IExpressionContainer, IExpressionValue } from '../common/debug.js';
import { Expression, ExpressionContainer, Scope, Variable } from '../common/debugModel.js';
import { ReplEvaluationResult } from '../common/replModel.js';
import { IVariableTemplateData, splitExpressionOrScopeHighlights } from './baseDebugView.js';
import { handleANSIOutput } from './debugANSIHandling.js';
import { COPY_EVALUATE_PATH_ID, COPY_VALUE_ID } from './debugCommands.js';
import { DebugLinkHoverBehavior, DebugLinkHoverBehaviorTypeData, ILinkDetector, LinkDetector } from './linkDetector.js';

export interface IValueHoverOptions {
	/** Commands to show in the hover footer. */
	commands?: { id: string; args: unknown[] }[];
}

export interface IRenderValueOptions {
	showChanged?: boolean;
	maxValueLength?: number;
	/** If not false, a rich hover will be shown on the element. */
	hover?: false | IValueHoverOptions;
	colorize?: boolean;
	highlights?: IHighlight[];

	/**
	 * Indicates areas where VS Code implicitly always supported ANSI escape
	 * sequences. These should be rendered as ANSI when the DA does not specify
	 * any value of `supportsANSIStyling`.
	 * @deprecated
	 */
	wasANSI?: boolean;
	session?: IDebugSession;
	locationReference?: number;
	/**
	 * The source of the code the value comes from, such as that of a stack frame. A value that isn't colored as a number,
	 * boolean or string is colored as code of its language, if an extension registered rules for that.
	 */
	codeResource?: URI;
}

export interface IRenderVariableOptions {
	showChanged?: boolean;
	highlights?: IHighlight[];
}


const MAX_VALUE_RENDER_LENGTH_IN_VIEWLET = 1024;
const booleanRegex = /^(true|false)$/i;
const stringRegex = /^(['"]).*\1$/;

const enum Cls {
	Value = 'value',
	Unavailable = 'unavailable',
	Error = 'error',
	Changed = 'changed',
	Boolean = 'boolean',
	String = 'string',
	Number = 'number',
}

const allClasses: readonly Cls[] = Object.keys({
	[Cls.Value]: 0,
	[Cls.Unavailable]: 0,
	[Cls.Error]: 0,
	[Cls.Changed]: 0,
	[Cls.Boolean]: 0,
	[Cls.String]: 0,
	[Cls.Number]: 0,
} satisfies { [key in Cls]: unknown }) as Cls[];

export class DebugExpressionRenderer {
	private displayType: IObservable<boolean>;
	private readonly linkDetector: LinkDetector;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IHoverService private readonly hoverService: IHoverService,
		@IDebugService private readonly debugService: IDebugService,
		@ICodeFragmentService private readonly codeFragmentService: ICodeFragmentService,
	) {
		this.linkDetector = instantiationService.createInstance(LinkDetector);
		this.displayType = observableConfigValue('debug.showVariableTypes', false, configurationService);
	}

	/**
	 * Renders the label of a variable or expression, which starts with its name, and its type when it is shown, coloring
	 * the name and type as code of the language of the stack frame they belong to, and again when the coloring changes.
	 */
	renderNameAndType(data: { label: HighlightedLabel; type: HTMLElement }, expression: IExpression, text: string, highlights: IHighlight[], title: string, type: string | undefined, titleIsCode = true): IDisposable {
		const store = new DisposableStore();
		const resource = this.getCodeResource(expression);
		// A title that is code, such as a long type, shows in the label's hover in the editor font, laid out over lines,
		// when an extension lays out the code, which it can start doing after the label is rendered
		let codeHover: IManagedHoverTooltipHTMLElement | undefined;
		const getCodeHover = () => {
			const codeHoverResource = resource && titleIsCode && title && this.codeFragmentService.canFormat(resource) ? resource : undefined;
			if (!codeHoverResource) {
				return codeHover = undefined;
			}
			return codeHover ??= {
				// The code's content has the inset of the hover's, which it would otherwise have twice
				contentOwnsPadding: true,
				element: (token: CancellationToken) => {
					const targetWindow = dom.getWindow(data.label.element);
					const fontInfo = readEditorFontInfo(targetWindow, this.configurationService.getValue<IEditorOptions>('editor'));
					return renderCodeHover(this.codeFragmentService, title, codeHoverResource, { fontInfo, tabSize: this.configurationService.getValue<number>('editor.tabSize') ?? 4, targetWindow }, token, title === expression.name ? 'name' : 'type');
				}
			};
		};
		const render = () => {
			let nameStyles: ICodeFragmentStyle[] = [];
			if (resource && typeof expression.name === 'string') {
				// The name of a variable in brackets, such as [0] or [raw], is one a debugger gives the children it makes up,
				// not code, so it keeps the color of names, unlike an expression such as [Foo]
				const madeUp = expression instanceof Variable && /^\[.*\]$/s.test(expression.name);
				nameStyles = madeUp ? [] : [...this.codeFragmentService.getStyles(expression.name, resource, { kind: 'name', defaultForeground: true })];
				// The = or : between the name and the value has the default color of code too
				const separator = text.substring(expression.name.length);
				for (const style of this.codeFragmentService.getStyles(separator, resource, { kind: 'name', defaultForeground: true })) {
					nameStyles.push({ ...style, start: expression.name.length + style.start, end: expression.name.length + style.end });
				}
			}
			data.label.set(text, highlights, getCodeHover() ?? title, undefined, undefined, nameStyles);
			if (type === undefined) {
				data.type.textContent = '';
			} else {
				const typeText = `${type} =`;
				const typeStyles = resource ? this.codeFragmentService.getStyles(typeText, resource, { kind: 'type', defaultForeground: true }) : [];
				dom.reset(data.type, ...renderStyledText(typeText, [], typeStyles));
			}
		};
		render();
		if (resource) {
			store.add(this.codeFragmentService.onDidChange(render));
		}
		return store;
	}

	/**
	 * The source of the stack frame a variable belongs to, or for an expression, such as a watch expression, the
	 * focused stack frame it is evaluated in.
	 */
	getCodeResource(expression: IExpression): URI | undefined {
		let container: IExpression | IExpressionContainer = expression;
		while (container instanceof Variable) {
			container = container.parent;
		}
		const stackFrame = container instanceof Scope ? container.stackFrame : this.debugService.getViewModel().focusedStackFrame;
		return stackFrame?.source?.uri;
	}

	renderVariable(data: IVariableTemplateData, variable: Variable, options: IRenderVariableOptions = {}): IDisposable {
		const displayType = this.displayType.get();
		const highlights = splitExpressionOrScopeHighlights(variable, options.highlights || []);
		const store = new DisposableStore();

		if (variable.available) {
			let text = variable.name;
			let type: string | undefined;
			if (variable.value && typeof variable.name === 'string') {
				if (variable.type && displayType) {
					text += ': ';
					type = variable.type;
				} else {
					text += ' =';
				}
			}

			store.add(this.renderNameAndType(data, variable, text, highlights.name, variable.type && !displayType ? variable.type : variable.name, type));
			data.name.classList.toggle('virtual', variable.presentationHint?.kind === 'virtual');
			data.name.classList.toggle('internal', variable.presentationHint?.visibility === 'internal');
		} else if (variable.value && typeof variable.name === 'string' && variable.name) {
			data.label.set(':');
		}

		data.expression.classList.toggle('lazy', !!variable.presentationHint?.lazy);
		const commands = [
			{ id: COPY_VALUE_ID, args: [variable, [variable]] as unknown[] }
		];
		if (variable.evaluateName) {
			commands.push({ id: COPY_EVALUATE_PATH_ID, args: [{ variable }] });
		}

		store.add(this.renderValue(data.value, variable, {
			showChanged: options.showChanged,
			maxValueLength: MAX_VALUE_RENDER_LENGTH_IN_VIEWLET,
			hover: { commands },
			highlights: highlights.value,
			colorize: true,
			session: variable.getSession(),
			codeResource: this.getCodeResource(variable),
		}));
		return store;
	}

	renderValue(container: HTMLElement, expressionOrValue: IExpressionValue | string, options: IRenderValueOptions = {}): IDisposable {
		const store = new DisposableStore();
		// Use remembered capabilities so REPL elements can render even once a session ends
		const supportsANSI: boolean = options.session?.rememberedCapabilities?.supportsANSIStyling ?? options.wasANSI ?? false;

		let value = typeof expressionOrValue === 'string' ? expressionOrValue : expressionOrValue.value;
		let colorizeAsCode = false;

		// remove stale classes
		for (const cls of allClasses) {
			container.classList.remove(cls);
		}
		container.classList.add(Cls.Value);
		// when resolving expressions we represent errors from the server as a variable with name === null.
		if (value === null || ((expressionOrValue instanceof Expression || expressionOrValue instanceof Variable || expressionOrValue instanceof ReplEvaluationResult) && !expressionOrValue.available)) {
			container.classList.add(Cls.Unavailable);
			if (value !== Expression.DEFAULT_VALUE) {
				container.classList.add(Cls.Error);
			}
		} else {
			if (typeof expressionOrValue !== 'string' && options.showChanged && expressionOrValue.valueChanged && value !== Expression.DEFAULT_VALUE) {
				// value changed color has priority over other colors.
				container.classList.add(Cls.Changed);
				expressionOrValue.valueChanged = false;
			}

			if (options.colorize && typeof expressionOrValue !== 'string') {
				colorizeAsCode = !container.classList.contains(Cls.Changed);
				if (expressionOrValue.type === 'number' || expressionOrValue.type === 'boolean' || expressionOrValue.type === 'string') {
					container.classList.add(expressionOrValue.type);
				} else if (!isNaN(+value)) {
					container.classList.add(Cls.Number);
				} else if (booleanRegex.test(value)) {
					container.classList.add(Cls.Boolean);
				} else if (stringRegex.test(value)) {
					container.classList.add(Cls.String);
				}
				if (container.classList.contains(Cls.Number) || container.classList.contains(Cls.Boolean) || container.classList.contains(Cls.String)) {
					colorizeAsCode = false;
				}
			}
		}

		if (options.maxValueLength && value && value.length > options.maxValueLength) {
			value = value.substring(0, options.maxValueLength) + '...';
		}
		if (!value) {
			value = '';
		}

		const session = options.session ?? ((expressionOrValue instanceof ExpressionContainer) ? expressionOrValue.getSession() : undefined);
		// Only use hovers for links if thre's not going to be a hover for the value.
		const hoverBehavior: DebugLinkHoverBehaviorTypeData = options.hover === false ? { type: DebugLinkHoverBehavior.Rich, store } : { type: DebugLinkHoverBehavior.None, store };
		dom.clearNode(container);
		const locationReference = options.locationReference ?? (expressionOrValue instanceof ExpressionContainer && expressionOrValue.valueLocationReference);

		let linkDetector: ILinkDetector = this.linkDetector;
		if (locationReference && session) {
			linkDetector = this.linkDetector.makeReferencedLinkDetector(locationReference, session);
		}

		if (supportsANSI) {
			container.appendChild(handleANSIOutput(value, linkDetector, session ? session.root : undefined, options.highlights, hoverBehavior));
		} else {
			const codeResource = colorizeAsCode ? options.codeResource : undefined;
			// The listeners of a rendering's links go with it when the value is rendered again with new styles
			const textStore = store.add(new MutableDisposable<DisposableStore>());
			const renderText = () => {
				const styles = codeResource ? this.codeFragmentService.getStyles(value, codeResource, { kind: 'value' }) : undefined;
				textStore.value = new DisposableStore();
				dom.reset(container, linkDetector.linkify(value, { ...hoverBehavior, store: textStore.value }, false, session?.root, true, options.highlights, styles));
			};
			renderText();
			if (codeResource) {
				store.add(this.codeFragmentService.onDidChange(renderText));
			}
		}

		if (options.hover !== false) {
			const { commands = [] } = options.hover || {};
			// A value of the code of a language extensions color shows in the editor font, colored, and laid out over lines
			// when it is too long for the hover
			// Decided when the hover shows, as an extension can start coloring or laying out the code after the value is
			// rendered
			const codeResource = !supportsANSI ? options.codeResource : undefined;
			const codeHover = (): IManagedHoverTooltipHTMLElement | undefined => codeResource && (this.codeFragmentService.canFormat(codeResource) || this.codeFragmentService.getStyles(value, codeResource, { kind: 'value' }).length) ? {
				// The code's content has the inset of the hover's, which it would otherwise have twice
				contentOwnsPadding: true,
				element: (token: CancellationToken) => {
					const targetWindow = dom.getWindow(container);
					const fontInfo = readEditorFontInfo(targetWindow, this.configurationService.getValue<IEditorOptions>('editor'));
					return renderCodeHover(this.codeFragmentService, value, codeResource, { fontInfo, tabSize: this.configurationService.getValue<number>('editor.tabSize') ?? 4, targetWindow }, token, 'value');
				}
			} : undefined;
			store.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), container, () => codeHover() ?? (() => {
				const container = dom.$('div');
				const markdownHoverElement = dom.$('div.hover-row');
				const hoverContentsElement = dom.append(markdownHoverElement, dom.$('div.hover-contents'));
				const hoverContentsPre = dom.append(hoverContentsElement, dom.$('pre.debug-var-hover-pre'));
				if (supportsANSI) {
					// note: intentionally using `this.linkDetector` so we don't blindly linkify the
					// entire contents and instead only link file paths that it contains.
					hoverContentsPre.appendChild(handleANSIOutput(value, this.linkDetector, session ? session.root : undefined, options.highlights, hoverBehavior));
				} else {
					hoverContentsPre.textContent = value;
				}
				container.appendChild(markdownHoverElement);
				return container;
			})(), {
				actions: commands.map(({ id, args }) => {
					const description = CommandsRegistry.getCommand(id)?.metadata?.description;
					return {
						label: typeof description === 'string' ? description : description ? description.value : id,
						commandId: id,
						run: () => this.commandService.executeCommand(id, ...args),
					};
				})
			}));
		}

		return store;
	}
}
