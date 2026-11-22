/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { join } from '../../../base/common/path.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService, isSuccess, readBoundedResponse } from '../../request/common/request.js';
import { getReleaseNotesFeedUrls, IReleaseNotesFeedService, LOCAL_RELEASE_NOTES_FEED_PATH, mergeLocalReleaseNotesFeed, parseReleaseNotesFeedJson } from '../common/updateFeed.js';

/** A release notes feed is about 10 KB, so a larger response isn't one. */
const MAX_RELEASE_NOTES_FEED_BYTES = 1024 * 1024;

/**
 * Downloads release notes feeds for the windows. Windows reach every method of the service through
 * the main process's channel, so the helpers are functions outside it: windows can only ask for the
 * release notes of a version, not download other URLs.
 */
export class ReleaseNotesFeedService implements IReleaseNotesFeedService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
	) { }

	async downloadReleaseNotesFeed(version: string): Promise<string | undefined> {
		const updateUrl = this.productService.updateUrl;
		const urls = updateUrl ? getReleaseNotesFeedUrls(updateUrl, version) : [];

		const localFeed = this.environmentMainService.isBuilt ? undefined : await readLocalReleaseNotesFeed(this.environmentMainService.appRoot);
		if (localFeed !== undefined) {
			const downloaded = await downloadFirstReleaseNotesFeed(this.requestService, this.logService, urls).catch(error => {
				this.logService.warn('[ReleaseNotesFeed] Failed to download the release notes of the releases before this build', error);
				return undefined;
			});
			const merged = mergeLocalReleaseNotesFeed(localFeed, downloaded, this.productService.version, version);
			if (merged === undefined) {
				this.logService.trace(`[ReleaseNotesFeed] ${LOCAL_RELEASE_NOTES_FEED_PATH} isn't for ${this.productService.version}`);
			}
			return merged ?? downloaded;
		}

		return downloadFirstReleaseNotesFeed(this.requestService, this.logService, urls);
	}
}

/**
 * Returns the release notes of the version being built, in builds from sources, which
 * `./build-unbroken-code.sh --show-release-notes` writes.
 */
async function readLocalReleaseNotesFeed(appRoot: string): Promise<string | undefined> {
	try {
		return await fs.readFile(join(appRoot, LOCAL_RELEASE_NOTES_FEED_PATH), 'utf8');
	} catch {
		return undefined;
	}
}

/**
 * Returns the first of the URLs that has a release notes feed, skipping the ones that fail or have
 * something else, and throws the last error if none has one.
 */
async function downloadFirstReleaseNotesFeed(requestService: IRequestService, logService: ILogService, urls: readonly string[]): Promise<string | undefined> {
	let lastError: unknown;
	for (const url of urls) {
		try {
			const context = await requestService.request({ url, callSite: 'releaseNotesFeedService.download' }, CancellationToken.None);
			if (!isSuccess(context)) {
				throw new Error(`Server returned ${context.res.statusCode}`);
			}
			// Drops a larger response instead of buffering it
			const text = await readBoundedResponse(context, MAX_RELEASE_NOTES_FEED_BYTES, () => new Error(`The release notes feed is larger than ${MAX_RELEASE_NOTES_FEED_BYTES} bytes`));
			if (!parseReleaseNotesFeedJson(text)) {
				throw new Error('Not a release notes feed');
			}
			return text;
		} catch (error) {
			logService.trace(`[ReleaseNotesFeed] No release notes at ${url}`, error);
			lastError = error;
		}
	}
	if (lastError) {
		throw lastError;
	}
	return undefined;
}
