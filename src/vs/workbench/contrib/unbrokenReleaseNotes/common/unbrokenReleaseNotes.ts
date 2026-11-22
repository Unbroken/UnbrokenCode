/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { formatDate, tryParseDate, tryParseVersion } from '../../update/common/updateUtils.js';

/**
 * The release notes of a release and the releases before it, which
 * `build/release/release-notes-feed.ts` attaches to each release.
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

/**
 * What the release notes are shown for.
 */
export const enum ReleaseNotesKind {
	/** The release notes of the running version. */
	Current = 'current',
	/** What an update that hasn't been installed yet brings, compared to the running version. */
	Update = 'update',
	/** What changed since the version that was updated from. */
	Updated = 'updated',
}

export interface IReleaseNotesRequest {
	readonly kind: ReleaseNotesKind;
	/** The newest version to show the release notes of. */
	readonly version: string;
	/** The version to show the changes since, which isn't included in them. */
	readonly since?: string;
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * Returns the releases of a release notes feed, leaving out entries it doesn't understand, or
 * `undefined` if it isn't a release notes feed.
 */
export function parseReleaseNotesFeed(value: unknown): IReleaseNotesFeed | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const { releasesUrl, releases } = value as Partial<Record<keyof IReleaseNotesFeed, unknown>>;
	if (!isString(releasesUrl) || !Array.isArray(releases)) {
		return undefined;
	}

	const feedReleases: IReleaseNotesFeedRelease[] = [];
	for (const release of releases as unknown[]) {
		if (!release || typeof release !== 'object') {
			continue;
		}
		const { version, date, prerelease, url, notes } = release as Partial<Record<keyof IReleaseNotesFeedRelease, unknown>>;
		if (!isString(version) || !tryParseVersion(version) || !isString(url) || !Array.isArray(notes)) {
			continue;
		}
		feedReleases.push({
			version,
			date: isString(date) ? date : '',
			prerelease: prerelease === true,
			url,
			notes: notes.filter(isString),
		});
	}

	return { releasesUrl, releases: feedReleases.sort((a, b) => compareVersions(b.version, a.version)) };
}

/**
 * Compares two versions in the format "major.minor.patch".
 */
export function compareVersions(a: string, b: string): number {
	const left = tryParseVersion(a);
	const right = tryParseVersion(b);
	if (!left || !right) {
		return left ? 1 : right ? -1 : 0;
	}
	return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export interface IReleaseNotesSelection {
	/**
	 * The release the changes are shown since: the newest stable release up to the request's
	 * `since`, or `since` itself if the feed has no release up to it.
	 */
	readonly since: string | undefined;
	/** The releases after `since` up to `version`, newest first. */
	readonly newReleases: readonly IReleaseNotesFeedRelease[];
	/** The releases up to `since`, newest first. */
	readonly earlierReleases: readonly IReleaseNotesFeedRelease[];
	/** Whether releases after `since` may be missing from `newReleases`, because they are older than the releases in the feed. */
	readonly incomplete: boolean;
}

/**
 * Returns the releases a request shows: the newest release up to `version` and the stable releases
 * before it. The notes of a release, also of a pre-release, list the changes since the stable
 * release before it, so they include the notes of the pre-releases before it, and the changes are
 * shown since the stable release that `since` has. Without `since`, the new release is `version`
 * itself.
 */
export function selectReleaseNotes(feed: IReleaseNotesFeed, request: IReleaseNotesRequest): IReleaseNotesSelection {
	const releases = feed.releases
		.filter(release => compareVersions(release.version, request.version) <= 0)
		.filter((release, index) => index === 0 || !release.prerelease);
	const requestSince = request.since;
	const since = requestSince === undefined
		? undefined
		: releases.find(release => compareVersions(release.version, requestSince) <= 0)?.version ?? requestSince;
	const isNew = (release: IReleaseNotesFeedRelease) => since !== undefined
		? compareVersions(release.version, since) > 0
		: compareVersions(release.version, request.version) === 0;
	const newReleases = releases.filter(isNew);
	const earlierReleases = releases.filter(release => !isNew(release));
	return {
		since,
		newReleases,
		earlierReleases,
		incomplete: since !== undefined && newReleases.length > 0 && earlierReleases.length === 0 && feed.releases.length > 0 && compareVersions(feed.releases[feed.releases.length - 1].version, since) > 0,
	};
}

function renderRelease(release: IReleaseNotesFeedRelease): string {
	const date = tryParseDate(release.date);
	const details = [
		date !== undefined ? formatDate(date) : undefined,
		release.prerelease ? localize('unbrokenReleaseNotes.prerelease', "Pre-release") : undefined,
	].filter(isString);
	const heading = `### [${release.version}](${release.url})${details.map(detail => ` · ${detail}`).join('')}`;
	const notes = release.notes.length
		? release.notes.map(note => `- ${note}`).join('\n')
		: `*${localize('unbrokenReleaseNotes.noNotes', "No changes are listed for this release.")}*`;
	return `${heading}\n\n${notes}`;
}

export interface IReleaseNotesMarkdown {
	/** The title and the introduction, which the setting to show release notes after an update follows. */
	readonly header: string;
	readonly body: string;
}

/**
 * Returns the Markdown of the release notes page of a request.
 */
export function createReleaseNotesMarkdown(feed: IReleaseNotesFeed | undefined, request: IReleaseNotesRequest, productName: string, currentVersion: string, fallbackReleasesUrl: string | undefined): IReleaseNotesMarkdown {
	const releasesUrl = feed?.releasesUrl ?? fallbackReleasesUrl;
	const allReleasesLink = releasesUrl ? `[${localize('unbrokenReleaseNotes.allReleases', "See all releases on GitHub")}](${releasesUrl})` : '';

	const selection = feed && selectReleaseNotes(feed, request);
	const since = selection ? selection.since : request.since;
	let title: string;
	let introduction: string | undefined;
	let newHeading: string;
	switch (request.kind) {
		case ReleaseNotesKind.Update:
			title = localize('unbrokenReleaseNotes.updateTitle', "Update to {0} {1}", productName, request.version);
			// The changes are shown since an earlier stable release when the running version is a pre-release
			if (since && since !== request.since) {
				introduction = localize('unbrokenReleaseNotes.updateSinceIntroduction', "You have {0}. These are the changes in the update since {1}.", currentVersion, since);
				newHeading = localize('unbrokenReleaseNotes.newSince', "New Since {0}", since);
			} else {
				introduction = localize('unbrokenReleaseNotes.updateIntroduction', "You have {0}. These are the changes the update brings.", currentVersion);
				newHeading = localize('unbrokenReleaseNotes.newInUpdate', "New in This Update");
			}
			break;
		case ReleaseNotesKind.Updated:
			title = `${productName} ${request.version}`;
			introduction = request.since ? localize('unbrokenReleaseNotes.updatedIntroduction', "Updated from {0}.", request.since) : undefined;
			newHeading = since ? localize('unbrokenReleaseNotes.newSince', "New Since {0}", since) : localize('unbrokenReleaseNotes.thisVersion', "This Version");
			break;
		default:
			title = `${productName} ${request.version}`;
			newHeading = localize('unbrokenReleaseNotes.thisVersion', "This Version");
			break;
	}
	const header = `# ${title}${introduction ? `\n\n${introduction}` : ''}`;

	if (!feed || !selection) {
		return {
			header,
			body: `${localize('unbrokenReleaseNotes.unavailable', "The release notes couldn't be downloaded.")}\n\n${allReleasesLink}`,
		};
	}

	const { newReleases, earlierReleases, incomplete } = selection;
	const sections: string[] = [`## ${newHeading}`];
	if (!feed.releases.some(release => compareVersions(release.version, request.version) === 0)) {
		sections.push(localize('unbrokenReleaseNotes.notAvailable', "The release notes of {0} aren't available.", request.version));
	}
	sections.push(...newReleases.map(renderRelease));
	if (newReleases.length && incomplete && releasesUrl) {
		sections.push(localize('unbrokenReleaseNotes.incomplete', "Releases older than {0} are on [GitHub]({1}).", newReleases[newReleases.length - 1].version, releasesUrl));
	}
	if (earlierReleases.length) {
		sections.push(`## ${localize('unbrokenReleaseNotes.earlierReleases', "Earlier Releases")}`, ...earlierReleases.map(renderRelease));
	}
	if (allReleasesLink) {
		sections.push(allReleasesLink);
	}

	return { header, body: sections.join('\n\n') };
}
