/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { escape } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { getReleasesUrl, IReleaseNotesFeedService } from '../../../../platform/update/common/updateFeed.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ACTIVE_GROUP, IEditorService } from '../../../services/editor/common/editorService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { DEFAULT_MARKDOWN_STYLES, renderMarkdownDocument } from '../../markdown/browser/markdownDocumentRenderer.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { createReleaseNotesMarkdown, IReleaseNotesFeed, IReleaseNotesRequest, parseReleaseNotesFeed } from '../common/unbrokenReleaseNotes.js';

export const IUnbrokenReleaseNotesService = createDecorator<IUnbrokenReleaseNotesService>('unbrokenReleaseNotesService');

export interface IUnbrokenReleaseNotesService {
	readonly _serviceBrand: undefined;

	/**
	 * Shows the release notes of a request in an editor, reusing the editor if it's already open.
	 */
	show(request: IReleaseNotesRequest): Promise<void>;
}

const SHOW_RELEASE_NOTES_SETTING = 'update.showReleaseNotes';

export class UnbrokenReleaseNotesService extends Disposable implements IUnbrokenReleaseNotesService {

	declare readonly _serviceBrand: undefined;

	private readonly feeds = new Map<string, Promise<IReleaseNotesFeed | undefined>>();
	private input: WebviewInput | undefined;
	private readonly inputDisposables = this._register(new MutableDisposable<DisposableStore>());
	private showRequest = 0;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ILogService private readonly logService: ILogService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
		@IReleaseNotesFeedService private readonly releaseNotesFeedService: IReleaseNotesFeedService,
		@IWebviewWorkbenchService private readonly webviewWorkbenchService: IWebviewWorkbenchService,
	) {
		super();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SHOW_RELEASE_NOTES_SETTING)) {
				this.postShowReleaseNotesSetting();
			}
		}));
	}

	/**
	 * Returns the release notes feed of a version, which is downloaded once.
	 */
	private async getFeed(version: string): Promise<IReleaseNotesFeed | undefined> {
		let promise = this.feeds.get(version);
		if (!promise) {
			promise = this.downloadFeed(version);
			this.feeds.set(version, promise);
		}
		const feed = await promise;
		if (!feed && this.feeds.get(version) === promise) {
			// Download it again next time, since it may have failed because of the network
			this.feeds.delete(version);
		}
		return feed;
	}

	private async downloadFeed(version: string): Promise<IReleaseNotesFeed | undefined> {
		try {
			const text = await this.releaseNotesFeedService.downloadReleaseNotesFeed(version);
			if (text === undefined) {
				return undefined;
			}
			const feed = parseReleaseNotesFeed(JSON.parse(text));
			if (!feed) {
				this.logService.warn('[UnbrokenReleaseNotes] The release notes feed has an unknown format');
			}
			return feed;
		} catch (error) {
			this.logService.warn('[UnbrokenReleaseNotes] Failed to download the release notes feed', error);
			return undefined;
		}
	}

	async show(request: IReleaseNotesRequest): Promise<void> {
		const showRequest = ++this.showRequest;
		const feed = await this.getFeed(request.version);
		const html = await this.renderPage(feed, request);
		if (showRequest !== this.showRequest || this._store.isDisposed) {
			return;
		}

		const title = localize('unbrokenReleaseNotes.title', "Release Notes: {0}", request.version);
		if (this.input) {
			this.input.setWebviewTitle(title);
			// Show the new release notes from the top, instead of where the previous ones were scrolled to
			this.input.webview.initialScrollProgress = 0;
			this.input.webview.setHtml(html);
			const activeEditorPane = this.editorService.activeEditorPane;
			this.webviewWorkbenchService.revealWebview(this.input, activeEditorPane ? activeEditorPane.group : this.editorGroupsService.activeGroup, false);
			return;
		}

		const input = this.webviewWorkbenchService.openWebview(
			{
				title,
				options: {
					tryRestoreScrollPosition: true,
					enableFindWidget: true,
					disableServiceWorker: true,
				},
				contentOptions: {
					localResourceRoots: [],
					allowScripts: true,
				},
				extension: undefined,
			},
			'unbrokenReleaseNotes',
			title,
			Codicon.megaphone,
			{ group: ACTIVE_GROUP, preserveFocus: false });
		this.input = input;

		const disposables = new DisposableStore();
		this.inputDisposables.value = disposables;
		const onDispose = () => {
			if (this.input === input) {
				this.input = undefined;
				this.showRequest++;
				this.inputDisposables.clear();
			}
		};
		disposables.add(Event.once(input.webview.onDidDispose)(onDispose));
		disposables.add(Event.once(input.onWillDispose)(onDispose));
		disposables.add(input.webview.onDidClickLink(link => {
			this.openerService.open(URI.parse(link), { openExternal: true }).catch(onUnexpectedError);
		}));
		disposables.add(input.webview.onMessage(e => {
			if (e.message?.type === 'showReleaseNotes' && typeof e.message.value === 'boolean') {
				this.configurationService.updateValue(SHOW_RELEASE_NOTES_SETTING, e.message.value).catch(onUnexpectedError);
			}
		}));

		input.webview.setHtml(html);
	}

	private postShowReleaseNotesSetting(): void {
		this.input?.webview.postMessage({
			type: 'showReleaseNotes',
			value: this.configurationService.getValue<boolean>(SHOW_RELEASE_NOTES_SETTING),
		});
	}

	private async renderPage(feed: IReleaseNotesFeed | undefined, request: IReleaseNotesRequest): Promise<string> {
		const markdown = createReleaseNotesMarkdown(feed, request, this.productService.nameLong, this.productService.version, this.productService.updateUrl ? getReleasesUrl(this.productService.updateUrl) : undefined);
		const [header, body] = await Promise.all([
			renderMarkdownDocument(markdown.header, this.extensionService, this.languageService),
			renderMarkdownDocument(markdown.body, this.extensionService, this.languageService),
		]);
		const nonce = generateUuid();
		const showReleaseNotes = !!this.configurationService.getValue<boolean>(SHOW_RELEASE_NOTES_SETTING);
		const showReleaseNotesLabel = localize('unbrokenReleaseNotes.showOnUpdate', "Show release notes after an update");

		return `<!DOCTYPE html>
		<html>
			<head>
				<meta http-equiv="Content-type" content="text/html;charset=UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
				<style nonce="${nonce}">
					${DEFAULT_MARKDOWN_STYLES}

					body {
						margin: 0 auto;
						max-width: 980px;
						padding-bottom: 2em;
					}

					h2 {
						margin-top: 1.5em;
					}

					h3 {
						margin-top: 1.25em;
						font-weight: normal;
						color: var(--vscode-descriptionForeground);
					}

					h3 a {
						font-weight: 600;
					}

					.show-release-notes {
						display: flex;
						align-items: center;
						gap: 0.4em;
					}
				</style>
			</head>
			<body>
				${header}
				<p class="show-release-notes">
					<input type="checkbox" id="showReleaseNotes" ${showReleaseNotes ? 'checked' : ''}>
					<label for="showReleaseNotes">${escape(showReleaseNotesLabel)}</label>
				</p>
				${body}
				<script nonce="${nonce}">
					const vscode = acquireVsCodeApi();
					const input = document.getElementById('showReleaseNotes');
					input.addEventListener('change', () => vscode.postMessage({ type: 'showReleaseNotes', value: input.checked }));
					window.addEventListener('message', event => {
						if (event.data.type === 'showReleaseNotes') {
							input.checked = event.data.value;
						}
					});
				</script>
			</body>
		</html>`;
	}
}
