/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The release notes of a release and the releases before it, which the app downloads in one
 * request to show what changed since the build it was updated from, and what an update brings.
 * Attached to each release as `release-notes.json`, and read by
 * `src/vs/workbench/contrib/unbrokenReleaseNotes/common/unbrokenReleaseNotes.ts`.
 */
export interface IReleaseNotesFeed {
	/** The page that lists all releases, for releases older than the ones in the feed. */
	readonly releasesUrl: string;
	/** The release and the releases before it, newest first. */
	readonly releases: readonly IReleaseNotesFeedRelease[];
}

export interface IReleaseNotesFeedRelease {
	readonly version: string;
	/** When the release was published, as an ISO 8601 date. */
	readonly date: string;
	readonly prerelease: boolean;
	/** The page of the release. */
	readonly url: string;
	/** The items of the release's "What's New" list, in Markdown. */
	readonly notes: readonly string[];
}

/** The part of a GitHub release that the feed is made from. */
export interface IReleaseNotesSource {
	readonly tag_name: string;
	readonly html_url: string;
	readonly body?: string | null;
	readonly draft: boolean;
	readonly prerelease: boolean;
	readonly published_at: string | null;
	readonly created_at: string;
}

export const RELEASE_NOTES_FEED_FILE_NAME = 'release-notes.json';

export const RELEASE_NOTES_FEED_RELEASE_COUNT = 10;

/**
 * Where `--show-release-notes` writes the release notes of the version being built, relative to the
 * root of the repository. Builds from sources show them, with the releases before it downloaded
 * from the latest release. Read by `src/vs/platform/update/electron-main/releaseNotesFeedService.ts`.
 */
export const LOCAL_RELEASE_NOTES_FEED_PATH = '.build/release-notes.json';

const RELEASE_TAG_PREFIX = 'release/';

/**
 * Returns the items of the "What's New" list of a release description, which
 * `buildReleaseBody` in `create-github-release.ts` writes.
 */
export function parseReleaseNotes(body: string | null | undefined): string[] {
	const notes: string[] = [];
	let inSection = false;
	for (const line of (body ?? '').split(/\r?\n/)) {
		if (/^##\s+What's New\s*$/i.test(line)) {
			inSection = true;
			continue;
		}
		if (!inSection) {
			continue;
		}
		if (/^(#{1,6}\s|---)/.test(line)) {
			break;
		}
		const item = /^[-*]\s+(?<text>.+?)\s*$/.exec(line);
		if (item?.groups) {
			notes.push(item.groups.text);
		}
	}
	return notes;
}

function compareVersions(a: string, b: string): number {
	const parse = (version: string) => version.split('.').map(part => parseInt(part, 10) || 0);
	const left = parse(a);
	const right = parse(b);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

/**
 * Makes the release notes feed of a release from the GitHub releases: the release and the stable
 * releases before it. The notes of a release, also of a pre-release, list the changes since the
 * stable release before it, so they include the notes of the pre-releases before it.
 */
export function createReleaseNotesFeed(releases: readonly IReleaseNotesSource[], version: string, releasesUrl: string, count = RELEASE_NOTES_FEED_RELEASE_COUNT): IReleaseNotesFeed {
	const tagName = `${RELEASE_TAG_PREFIX}${version}`;
	const feedReleases = releases
		.filter(release => !release.draft && release.tag_name.startsWith(RELEASE_TAG_PREFIX) && (!release.prerelease || release.tag_name === tagName))
		.map((release): IReleaseNotesFeedRelease => ({
			version: release.tag_name.substring(RELEASE_TAG_PREFIX.length),
			date: release.published_at ?? release.created_at,
			prerelease: release.prerelease,
			url: release.html_url,
			notes: parseReleaseNotes(release.body),
		}))
		.filter(release => compareVersions(release.version, version) <= 0)
		.sort((a, b) => compareVersions(b.version, a.version))
		.slice(0, count);

	return { releasesUrl, releases: feedReleases };
}

/**
 * Makes the release notes feed of a version that isn't released yet, for builds from sources.
 */
export function createLocalReleaseNotesFeed(version: string, notes: readonly string[], releasesUrl: string, date: Date): IReleaseNotesFeed {
	return {
		releasesUrl,
		releases: [{ version, date: date.toISOString(), prerelease: false, url: releasesUrl, notes }],
	};
}
