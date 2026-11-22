/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

/**
 * Returns the prefix of the static update feeds of a release stream, which the update feed
 * generator in `build/release/update-feed-generator.ts` publishes:
 * - 'stable' (default) -> 'latest'
 * - 'beta'             -> 'latest-beta'
 * - 'rc'               -> 'latest-rc'
 */
export function getUpdateFeedPrefix(releaseStream: string | undefined): string {
	return !releaseStream || releaseStream === 'stable' ? 'latest' : `latest-${releaseStream}`;
}

/**
 * Returns the page that lists the releases, from the URL of the release with the update feeds,
 * such as `https://github.com/<owner>/<repo>/releases/download/update-feed`.
 */
export function getReleasesUrl(baseUpdateUrl: string): string | undefined {
	return /^(?<releases>https:\/\/github\.com\/[^/]+\/[^/]+\/releases)\/download\/[^/]+$/.exec(baseUpdateUrl)?.groups?.releases;
}

/**
 * Returns where to download the release notes of a version and the releases before it from,
 * in order: the file attached to the release of the version, and the file attached to the latest
 * release, for versions whose release doesn't have one, such as versions that aren't released.
 */
export function getReleaseNotesFeedUrls(baseUpdateUrl: string, version: string): string[] {
	const releasesUrl = getReleasesUrl(baseUpdateUrl);
	if (!releasesUrl) {
		return [];
	}
	return [
		`${releasesUrl}/download/${encodeURIComponent(`release/${version}`)}/release-notes.json`,
		`${releasesUrl}/latest/download/release-notes.json`,
	];
}

/**
 * Where builds from sources read the release notes of the version being built from, relative to
 * the root of the repository, which `./build-unbroken-code.sh --show-release-notes` writes.
 */
export const LOCAL_RELEASE_NOTES_FEED_PATH = '.build/release-notes.json';

interface IReleaseNotesFeedJson {
	readonly releasesUrl: string;
	readonly releases: readonly { readonly version: string }[];
}

/**
 * Returns the JSON of a release notes feed, leaving out the releases without a version, or
 * `undefined` if the text isn't one. The workbench checks the rest of each release when it reads
 * them.
 */
export function parseReleaseNotesFeedJson(text: string | undefined): IReleaseNotesFeedJson | undefined {
	if (text === undefined) {
		return undefined;
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!json || typeof json !== 'object') {
		return undefined;
	}
	const { releasesUrl, releases } = json as { releasesUrl?: unknown; releases?: unknown };
	if (typeof releasesUrl !== 'string' || !Array.isArray(releases)) {
		return undefined;
	}
	return {
		...json,
		releasesUrl,
		releases: releases.filter((release): release is { version: string } => !!release && typeof release === 'object' && typeof (release as { version?: unknown }).version === 'string'),
	};
}

function compareVersions(a: string, b: string): number {
	const left = a.split('.').map(part => parseInt(part, 10) || 0);
	const right = b.split('.').map(part => parseInt(part, 10) || 0);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

/**
 * Returns the local release notes feed of a build from sources with the releases of a downloaded
 * feed before them, if it has the release notes of `buildVersion`, the version being built, and
 * else `undefined`, since it was written for another version.
 *
 * The local release notes are of the release being prepared, so when the release notes of a newer
 * version that isn't released are asked for, such as of a simulated update, they are shown as
 * that version's.
 */
export function mergeLocalReleaseNotesFeed(localText: string, downloadedText: string | undefined, buildVersion: string, requestedVersion: string): string | undefined {
	const local = parseReleaseNotesFeedJson(localText);
	const localReleases = local?.releases ?? [];
	if (!local || !localReleases.some(release => release.version === buildVersion)) {
		return undefined;
	}

	const downloaded = parseReleaseNotesFeedJson(downloadedText);
	const downloadedReleases = downloaded?.releases ?? [];
	const isReleased = (version: string) => downloadedReleases.some(release => release.version === version);
	const releases = compareVersions(requestedVersion, buildVersion) > 0 && !isReleased(requestedVersion)
		? localReleases.map(release => release.version === buildVersion ? { ...release, version: requestedVersion } : release)
		: localReleases;
	return JSON.stringify({
		releasesUrl: downloaded?.releasesUrl ?? local.releasesUrl,
		releases: [...releases, ...downloadedReleases.filter(release => !releases.some(localRelease => localRelease.version === release.version))],
	});
}

export const IReleaseNotesFeedService = createDecorator<IReleaseNotesFeedService>('releaseNotesFeedService');

/**
 * Downloads release notes feeds in the main process, since the server of the releases doesn't
 * allow the requests of web pages.
 */
export interface IReleaseNotesFeedService {
	readonly _serviceBrand: undefined;

	/**
	 * Returns the text of the release notes feed of a version, which has the release notes of the
	 * version and the releases before it, or of the latest release if the version's release
	 * doesn't have one. Builds from sources add the release notes of the version being built from
	 * the local feed, if there is one for it. Returns `undefined` if the product has no
	 * releases to download it from.
	 */
	downloadReleaseNotesFeed(version: string): Promise<string | undefined>;
}
