/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import * as errors from '../../../../base/common/errors.js';
import { Disposable, DisposableMap, DisposableStore, dispose } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { registerEditorFeature } from '../../../common/editorFeatures.js';
import { LanguageFeatureRegistry } from '../../../common/languageFeatureRegistry.js';
import { DocumentSemanticTokensProvider, SemanticTokens, SemanticTokensEdits } from '../../../common/languages.js';
import { ITextModel } from '../../../common/model.js';
import { IFeatureDebounceInformation, ILanguageFeatureDebounceService } from '../../../common/services/languageFeatureDebounce.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { IModelService } from '../../../common/services/model.js';
import { SemanticTokensProviderStyling, toMultilineTokens2 } from '../../../common/services/semanticTokensProviderStyling.js';
import { SparseMultilineTokens } from '../../../common/tokens/sparseMultilineTokens.js';
import { ISemanticTokensStylingService } from '../../../common/services/semanticTokensStyling.js';
import { IModelContentChangedEvent } from '../../../common/textModelEvents.js';
import { getDocumentSemanticTokens, getMergedDocumentSemanticTokensProviders, hasDocumentSemanticTokensProvider, isSemanticTokens, isSemanticTokensEdits } from '../common/getSemanticTokens.js';
import { SEMANTIC_HIGHLIGHTING_SETTING_ID, isSemanticColoringEnabled } from '../common/semanticTokensConfig.js';

export class DocumentSemanticTokensFeature extends Disposable {

	private readonly _watchers = new ResourceMap<ModelSemanticColoring>();
	private readonly _providerChangeListeners = this._register(new DisposableStore());

	constructor(
		@ISemanticTokensStylingService semanticTokensStylingService: ISemanticTokensStylingService,
		@IModelService modelService: IModelService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILanguageFeatureDebounceService languageFeatureDebounceService: ILanguageFeatureDebounceService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
	) {
		super();

		const provider = languageFeaturesService.documentSemanticTokensProvider;

		const register = (model: ITextModel) => {
			this._watchers.get(model.uri)?.dispose();
			this._watchers.set(model.uri, new ModelSemanticColoring(model, undefined, undefined, semanticTokensStylingService, languageFeatureDebounceService, languageFeaturesService));
		};
		const deregister = (model: ITextModel, modelSemanticColoring: ModelSemanticColoring) => {
			modelSemanticColoring.dispose();
			this._watchers.delete(model.uri);
		};
		const handleSettingOrThemeChange = (themeChanged: boolean) => {
			for (const model of modelService.getModels()) {
				// Updating tokens can synchronously dispose another model in this snapshot.
				if (model.isDisposed()) {
					continue;
				}
				const curr = this._watchers.get(model.uri);
				if (isSemanticColoringEnabled(model, themeService, configurationService)) {
					if (!curr) {
						register(model);
					} else if (themeChanged) {
						try {
							curr.handleThemeChange();
						} catch (err) {
							errors.onUnexpectedError(err);
						}
					}
				} else {
					if (curr) {
						deregister(model, curr);
					}
				}
			}
		};

		const bindProviderChangeListeners = () => {
			this._providerChangeListeners.clear();
			for (const p of provider.allNoModel()) {
				if (typeof p.onDidChange === 'function') {
					this._providerChangeListeners.add(p.onDidChange(() => {
						for (const watcher of this._watchers.values()) {
							watcher.handleProviderDidChange(p);
						}
					}));
				}
			}
		};

		modelService.getModels().forEach(model => {
			if (isSemanticColoringEnabled(model, themeService, configurationService)) {
				register(model);
			}
		});
		this._register(modelService.onModelAdded((model) => {
			if (isSemanticColoringEnabled(model, themeService, configurationService)) {
				register(model);
			}
		}));
		this._register(modelService.onModelRemoved((model) => {
			const curr = this._watchers.get(model.uri);
			if (curr) {
				deregister(model, curr);
			}
		}));
		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SEMANTIC_HIGHLIGHTING_SETTING_ID)) {
				handleSettingOrThemeChange(false);
			}
		}));
		this._register(themeService.onDidColorThemeChange(() => handleSettingOrThemeChange(true)));
		bindProviderChangeListeners();
		this._register(provider.onDidChange(() => {
			bindProviderChangeListeners();
			for (const watcher of this._watchers.values()) {
				watcher.handleRegistryChange();
			}
		}));
	}

	override dispose(): void {
		dispose(this._watchers.values());
		this._watchers.clear();

		super.dispose();
	}
}

// The layer in the model of each provider that merges its tokens with the others'
const mergedLayers = new WeakMap<DocumentSemanticTokensProvider, number>();
let nextMergedLayer = 0;

// The layer of approximate tokens of the provider chosen among those that don't merge, which are merged below the
// tokens that aren't approximate
const approximateLayer = -1;

function getMergedLayer(provider: DocumentSemanticTokensProvider): number {
	let layer = mergedLayers.get(provider);
	if (layer === undefined) {
		layer = nextMergedLayer++;
		mergedLayers.set(provider, layer);
	}
	return layer;
}

/**
 * The semantic tokens of a model: of the provider chosen among those that don't merge their tokens with the others',
 * or with a `mergedProvider`, of that provider, which are set as a layer below. The coloring of the chosen provider
 * owns a coloring for each provider that merges, and orders the layers: approximate tokens below the others, and
 * otherwise in the order of the providers.
 */
class ModelSemanticColoring extends Disposable {

	public static REQUEST_MIN_DELAY = 300;
	public static REQUEST_MAX_DELAY = 2000;

	private _isDisposed: boolean;
	private readonly _model: ITextModel;
	private readonly _provider: LanguageFeatureRegistry<DocumentSemanticTokensProvider>;
	private readonly _mergedLayer: number | undefined;
	private readonly _mergedColorings = this._register(new DisposableMap<DocumentSemanticTokensProvider, ModelSemanticColoring>());
	private _mergedProviders: DocumentSemanticTokensProvider[] = [];
	// Whether the tokens set last are approximate
	private _approximate = false;
	private readonly _debounceInformation: IFeatureDebounceInformation;
	private readonly _fetchDocumentSemanticTokens: RunOnceScheduler;
	private _currentDocumentResponse: SemanticTokensResponse | null;
	private _currentDocumentRequestCancellationTokenSource: CancellationTokenSource | null;
	private _relevantProviders = new Set<DocumentSemanticTokensProvider>();
	private _providersChangedDuringRequest: boolean;

	constructor(
		model: ITextModel,
		private readonly _mergedProvider: DocumentSemanticTokensProvider | undefined,
		private readonly _onDidChangeApproximate: (() => void) | undefined,
		@ISemanticTokensStylingService private readonly _semanticTokensStylingService: ISemanticTokensStylingService,
		@ILanguageFeatureDebounceService private readonly _languageFeatureDebounceService: ILanguageFeatureDebounceService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
	) {
		super();

		this._isDisposed = false;
		this._model = model;
		this._provider = _languageFeaturesService.documentSemanticTokensProvider;
		this._mergedLayer = _mergedProvider ? getMergedLayer(_mergedProvider) : undefined;
		// A provider that merges is usually faster than the others, so it keeps its own average
		const debounceSalt = this._mergedLayer !== undefined ? `merged${this._mergedLayer}` : undefined;
		this._debounceInformation = _languageFeatureDebounceService.for(this._provider, 'DocumentSemanticTokens', { min: ModelSemanticColoring.REQUEST_MIN_DELAY, max: ModelSemanticColoring.REQUEST_MAX_DELAY, salt: debounceSalt });
		this._fetchDocumentSemanticTokens = this._register(new RunOnceScheduler(() => this._fetchDocumentSemanticTokensNow(), ModelSemanticColoring.REQUEST_MIN_DELAY));
		this._currentDocumentResponse = null;
		this._currentDocumentRequestCancellationTokenSource = null;
		this._providersChangedDuringRequest = false;
		this._updateRelevantProviders();

		this._register(this._model.onDidChangeContent(() => {
			if (!this._fetchDocumentSemanticTokens.isScheduled()) {
				this._fetchDocumentSemanticTokens.schedule(this._debounceInformation.get(this._model));
			}
		}));
		this._register(this._model.onDidChangeAttached(() => {
			if (!this._fetchDocumentSemanticTokens.isScheduled()) {
				this._fetchDocumentSemanticTokens.schedule(this._debounceInformation.get(this._model));
			}
		}));
		this._register(this._model.onDidChangeLanguage(() => {
			// clear any outstanding state
			if (this._currentDocumentResponse) {
				this._currentDocumentResponse.dispose();
				this._currentDocumentResponse = null;
			}
			if (this._currentDocumentRequestCancellationTokenSource) {
				this._currentDocumentRequestCancellationTokenSource.cancel();
				this._currentDocumentRequestCancellationTokenSource = null;
			}
			this._setDocumentSemanticTokens(null, null, null, []);
			this._updateRelevantProviders();
			this._fetchDocumentSemanticTokens.schedule(0);
		}));

		this._fetchDocumentSemanticTokens.schedule(0);
	}

	public handleThemeChange(): void {
		for (const coloring of this._mergedColorings.values()) {
			coloring.handleThemeChange();
		}
		this._setDocumentSemanticTokens(null, null, null, []);
		this._fetchDocumentSemanticTokens.schedule(this._debounceInformation.get(this._model));
	}

	public handleRegistryChange(): void {
		// Before the colorings of new providers are created, which fetch their tokens right away
		for (const coloring of this._mergedColorings.values()) {
			coloring.handleRegistryChange();
		}
		this._updateRelevantProviders();
		this._fetchDocumentSemanticTokens.schedule(this._debounceInformation.get(this._model));
	}

	public handleProviderDidChange(provider: DocumentSemanticTokensProvider): void {
		for (const coloring of this._mergedColorings.values()) {
			coloring.handleProviderDidChange(provider);
		}
		if (!this._relevantProviders.has(provider)) {
			return;
		}
		if (this._currentDocumentRequestCancellationTokenSource) {
			// there is already a request running,
			this._providersChangedDuringRequest = true;
			return;
		}
		this._fetchDocumentSemanticTokens.schedule(0);
	}

	private _updateRelevantProviders(): void {
		const providers = this._provider.all(this._model);
		if (this._mergedProvider) {
			this._relevantProviders = new Set(providers.filter(provider => provider === this._mergedProvider));
			return;
		}
		this._relevantProviders = new Set(providers.filter(provider => !provider.merge));

		this._mergedProviders = getMergedDocumentSemanticTokensProviders(this._provider, this._model);
		for (const provider of [...this._mergedColorings.keys()]) {
			if (!this._mergedProviders.includes(provider)) {
				this._mergedColorings.deleteAndDispose(provider);
			}
		}
		this._updateMergedSemanticTokensOrder();
		for (const provider of this._mergedProviders) {
			if (!this._mergedColorings.has(provider)) {
				this._mergedColorings.set(provider, new ModelSemanticColoring(this._model, provider, () => this._updateMergedSemanticTokensOrder(), this._semanticTokensStylingService, this._languageFeatureDebounceService, this._languageFeaturesService));
			}
		}
	}

	private _updateMergedSemanticTokensOrder(): void {
		const isApproximate = (provider: DocumentSemanticTokensProvider) => this._mergedColorings.get(provider)?._approximate ?? false;
		this._model.tokenization.setMergedSemanticTokensOrder([
			...this._mergedProviders.filter(provider => isApproximate(provider)).map(getMergedLayer),
			approximateLayer,
			...this._mergedProviders.filter(provider => !isApproximate(provider)).map(getMergedLayer),
		]);
	}

	private _setModelSemanticTokens(tokens: SparseMultilineTokens[] | null, isComplete: boolean, approximate: boolean = false): void {
		const approximateChanged = approximate !== this._approximate;
		this._approximate = approximate;
		if (this._mergedLayer !== undefined) {
			if (approximateChanged) {
				this._onDidChangeApproximate?.();
			}
			this._model.tokenization.setMergedSemanticTokens(this._mergedLayer, tokens);
		} else if (approximate) {
			this._model.tokenization.setMergedSemanticTokens(approximateLayer, tokens);
			// Only accurate document tokens are replaced; accurate tokens of a range provider stay above
			if (this._model.tokenization.hasCompleteSemanticTokens()) {
				this._model.tokenization.setSemanticTokens(null, false);
			}
		} else {
			this._model.tokenization.setMergedSemanticTokens(approximateLayer, null);
			this._model.tokenization.setSemanticTokens(tokens, isComplete);
		}
	}

	public override dispose(): void {
		if (this._currentDocumentResponse) {
			this._currentDocumentResponse.dispose();
			this._currentDocumentResponse = null;
		}
		if (this._currentDocumentRequestCancellationTokenSource) {
			this._currentDocumentRequestCancellationTokenSource.cancel();
			this._currentDocumentRequestCancellationTokenSource = null;
		}
		this._setDocumentSemanticTokens(null, null, null, []);
		this._isDisposed = true;

		super.dispose();
	}

	private _fetchDocumentSemanticTokensNow(): void {
		if (this._currentDocumentRequestCancellationTokenSource) {
			// there is already a request running, let it finish...
			return;
		}

		if (!hasDocumentSemanticTokensProvider(this._provider, this._model, this._mergedProvider)) {
			// there is no provider
			if (this._currentDocumentResponse) {
				// there are semantic tokens set
				this._setModelSemanticTokens(null, false);
			}
			return;
		}

		if (!this._model.isAttachedToEditor()) {
			// this document is not visible, there is no need to fetch semantic tokens for it
			return;
		}

		const cancellationTokenSource = new CancellationTokenSource();
		const lastProvider = this._currentDocumentResponse ? this._currentDocumentResponse.provider : null;
		const lastResultId = this._currentDocumentResponse ? this._currentDocumentResponse.resultId || null : null;
		const request = getDocumentSemanticTokens(this._provider, this._model, lastProvider, lastResultId, cancellationTokenSource.token, this._mergedProvider);
		this._currentDocumentRequestCancellationTokenSource = cancellationTokenSource;
		this._providersChangedDuringRequest = false;

		const pendingChanges: IModelContentChangedEvent[] = [];
		const contentChangeListener = this._model.onDidChangeContent((e) => {
			pendingChanges.push(e);
		});

		const sw = new StopWatch(false);
		request.then((res) => {
			this._debounceInformation.update(this._model, sw.elapsed());
			this._currentDocumentRequestCancellationTokenSource = null;
			contentChangeListener.dispose();

			if (!res) {
				this._setDocumentSemanticTokens(null, null, null, pendingChanges);
			} else {
				const { provider, tokens } = res;
				const styling = this._semanticTokensStylingService.getStyling(provider);
				this._setDocumentSemanticTokens(provider, tokens || null, styling, pendingChanges);
			}
		}, (err) => {
			const isExpectedError = err && (errors.isCancellationError(err) || (typeof err.message === 'string' && err.message.indexOf('busy') !== -1));
			if (!isExpectedError) {
				errors.onUnexpectedError(err);
			}

			// Semantic tokens eats up all errors and considers errors to mean that the result is temporarily not available
			// The API does not have a special error kind to express this...
			this._currentDocumentRequestCancellationTokenSource = null;
			contentChangeListener.dispose();

			if (pendingChanges.length > 0 || this._providersChangedDuringRequest) {
				// More changes occurred while the request was running
				if (!this._fetchDocumentSemanticTokens.isScheduled()) {
					this._fetchDocumentSemanticTokens.schedule(this._debounceInformation.get(this._model));
				}
			}
		});
	}

	private static _copy(src: Uint32Array, srcOffset: number, dest: Uint32Array, destOffset: number, length: number): void {
		// protect against overflows
		length = Math.min(length, dest.length - destOffset, src.length - srcOffset);
		for (let i = 0; i < length; i++) {
			dest[destOffset + i] = src[srcOffset + i];
		}
	}

	private _setDocumentSemanticTokens(provider: DocumentSemanticTokensProvider | null, tokens: SemanticTokens | SemanticTokensEdits | null, styling: SemanticTokensProviderStyling | null, pendingChanges: IModelContentChangedEvent[]): void {
		const currentResponse = this._currentDocumentResponse;
		const approximate = tokens?.approximate === true;
		const rescheduleIfNeeded = () => {
			if ((pendingChanges.length > 0 || this._providersChangedDuringRequest) && !this._fetchDocumentSemanticTokens.isScheduled()) {
				this._fetchDocumentSemanticTokens.schedule(this._debounceInformation.get(this._model));
			}
		};

		if (this._currentDocumentResponse) {
			this._currentDocumentResponse.dispose();
			this._currentDocumentResponse = null;
		}
		if (this._isDisposed) {
			// disposed!
			if (provider && tokens) {
				provider.releaseDocumentSemanticTokens(tokens.resultId);
			}
			return;
		}
		if (!provider || !styling) {
			this._setModelSemanticTokens(null, false);
			return;
		}
		if (!tokens) {
			this._setModelSemanticTokens(null, true);
			rescheduleIfNeeded();
			return;
		}

		if (isSemanticTokensEdits(tokens)) {
			const resultId = tokens.resultId;
			const rejectInvalidEdits = (requestFullRefresh: boolean) => {
				provider.releaseDocumentSemanticTokens(resultId);
				this._setModelSemanticTokens(null, true);
				if (requestFullRefresh) {
					this._fetchDocumentSemanticTokens.schedule(0);
				}
			};
			if (!currentResponse) {
				// not possible!
				rejectInvalidEdits(false);
				return;
			}
			if (tokens.edits.length === 0) {
				// nothing to do!
				tokens = {
					resultId: tokens.resultId,
					data: currentResponse.data
				};
			} else {
				let deltaLength = 0;
				for (const edit of tokens.edits) {
					deltaLength += (edit.data ? edit.data.length : 0) - edit.deleteCount;
				}

				const srcData = currentResponse.data;
				const destDataLength = srcData.length + deltaLength;
				if (destDataLength < 0) {
					styling.warnInvalidEditDeleteCount(currentResponse.resultId, resultId, srcData.length, deltaLength);
					rejectInvalidEdits(true);
					return;
				}
				const destData = new Uint32Array(destDataLength);

				let srcLastStart = srcData.length;
				let destLastStart = destData.length;
				for (let i = tokens.edits.length - 1; i >= 0; i--) {
					const edit = tokens.edits[i];

					if (edit.start > srcData.length) {
						styling.warnInvalidEditStart(currentResponse.resultId, resultId, i, edit.start, srcData.length);
						rejectInvalidEdits(true);
						return;
					}

					const copyCount = srcLastStart - (edit.start + edit.deleteCount);
					if (copyCount > 0) {
						ModelSemanticColoring._copy(srcData, srcLastStart - copyCount, destData, destLastStart - copyCount, copyCount);
						destLastStart -= copyCount;
					}

					if (edit.data) {
						ModelSemanticColoring._copy(edit.data, 0, destData, destLastStart - edit.data.length, edit.data.length);
						destLastStart -= edit.data.length;
					}

					srcLastStart = edit.start;
				}

				if (srcLastStart > 0) {
					ModelSemanticColoring._copy(srcData, 0, destData, 0, srcLastStart);
				}

				tokens = {
					resultId: tokens.resultId,
					data: destData
				};
			}
		}

		if (isSemanticTokens(tokens)) {

			this._currentDocumentResponse = new SemanticTokensResponse(provider, tokens.resultId, tokens.data);

			const result = toMultilineTokens2(tokens, styling, this._model.getLanguageId());

			// Adjust incoming semantic tokens
			if (pendingChanges.length > 0) {
				// More changes occurred while the request was running
				// We need to:
				// 1. Adjust incoming semantic tokens
				// 2. Request them again
				for (const change of pendingChanges) {
					for (const area of result) {
						for (const singleChange of change.changes) {
							area.applyEdit(singleChange.range, singleChange.text);
						}
					}
				}
			}

			this._setModelSemanticTokens(result, true, approximate);
		} else {
			this._setModelSemanticTokens(null, true);
		}

		rescheduleIfNeeded();
	}
}

class SemanticTokensResponse {
	constructor(
		public readonly provider: DocumentSemanticTokensProvider,
		public readonly resultId: string | undefined,
		public readonly data: Uint32Array
	) { }

	public dispose(): void {
		this.provider.releaseDocumentSemanticTokens(this.resultId);
	}
}

registerEditorFeature(DocumentSemanticTokensFeature);
