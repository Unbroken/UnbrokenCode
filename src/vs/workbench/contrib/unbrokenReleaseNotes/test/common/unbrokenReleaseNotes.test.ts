/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getReleaseNotesFeedUrls, getReleasesUrl, mergeLocalReleaseNotesFeed } from '../../../../../platform/update/common/updateFeed.js';
import { formatDate } from '../../../update/common/updateUtils.js';
import { createReleaseNotesMarkdown, IReleaseNotesFeed, IReleaseNotesRequest, parseReleaseNotesFeed, ReleaseNotesKind, selectReleaseNotes } from '../../common/unbrokenReleaseNotes.js';

function release(version: string, options: { prerelease?: boolean; notes?: string[]; date?: string } = {}) {
	return {
		version,
		date: options.date ?? '',
		prerelease: options.prerelease ?? false,
		url: `https://example.com/releases/tag/release/${version}`,
		notes: options.notes ?? [`Change in ${version}`],
	};
}

const feed: IReleaseNotesFeed = {
	releasesUrl: 'https://example.com/releases',
	releases: [release('1.147.73'), release('1.147.72', { prerelease: true }), release('1.146.71'), release('1.146.70')],
};

suite('Unbroken release notes', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads the releases of a feed newest first, and leaves out entries it does not understand', () => {
		assert.deepStrictEqual({
			feed: parseReleaseNotesFeed({
				releasesUrl: 'https://example.com/releases',
				releases: [
					release('1.146.9'),
					{ version: 'unknown', url: 'https://example.com', notes: [] },
					null,
					{ ...release('1.146.10'), notes: ['Fix', 7], prerelease: 'yes', date: 3 },
				],
			}),
			notFeed: parseReleaseNotesFeed({ releases: [] }),
			notObject: parseReleaseNotesFeed('releases'),
		}, {
			feed: {
				releasesUrl: 'https://example.com/releases',
				releases: [{ ...release('1.146.10'), notes: ['Fix'] }, release('1.146.9')],
			},
			notFeed: undefined,
			notObject: undefined,
		});
	});

	test('downloads the release notes of a version from its release, and else from the latest release', () => {
		const updateUrl = 'https://github.com/Unbroken/UnbrokenCode/releases/download/update-feed';
		assert.deepStrictEqual({
			releases: getReleasesUrl(updateUrl),
			urls: getReleaseNotesFeedUrls(updateUrl, '1.147.72'),
			otherServer: getReleaseNotesFeedUrls('https://example.com/api/update', '1.147.72'),
		}, {
			releases: 'https://github.com/Unbroken/UnbrokenCode/releases',
			urls: [
				'https://github.com/Unbroken/UnbrokenCode/releases/download/release%2F1.147.72/release-notes.json',
				'https://github.com/Unbroken/UnbrokenCode/releases/latest/download/release-notes.json',
			],
			otherServer: [],
		});
	});

	test('shows the local release notes of the version being built in builds from sources, before the releases of the latest release', () => {
		const local = JSON.stringify({ releasesUrl: 'https://example.com/releases', releases: [release('1.147.74')] });
		const latest = JSON.stringify(feed);
		const parse = (text: string | undefined) => text === undefined ? undefined : parseReleaseNotesFeed(JSON.parse(text))?.releases.map(r => `${r.version}: ${r.notes.join(', ')}`);
		const released = feed.releases.map(r => `${r.version}: ${r.notes.join(', ')}`);

		assert.deepStrictEqual({
			build: parse(mergeLocalReleaseNotesFeed(local, latest, '1.147.74', '1.147.74')),
			olderRelease: parse(mergeLocalReleaseNotesFeed(local, latest, '1.147.74', '1.146.71')),
			newerUpdate: parse(mergeLocalReleaseNotesFeed(local, latest, '1.147.74', '1.147.75')),
			withoutLatest: parse(mergeLocalReleaseNotesFeed(local, undefined, '1.147.74', '1.147.74')),
			invalidLatest: parse(mergeLocalReleaseNotesFeed(local, '<html>', '1.147.74', '1.147.74')),
			invalidLocal: parse(mergeLocalReleaseNotesFeed('{', latest, '1.147.74', '1.147.74')),
			localWithNullEntry: parse(mergeLocalReleaseNotesFeed(JSON.stringify({ releasesUrl: 'https://example.com/releases', releases: [null, release('1.147.74')] }), undefined, '1.147.74', '1.147.74')),
			latestWithoutReleasesUrl: parse(mergeLocalReleaseNotesFeed(local, JSON.stringify({ releases: feed.releases }), '1.147.74', '1.147.74')),
			otherBuild: parse(mergeLocalReleaseNotesFeed(local, latest, '1.147.80', '1.147.80')),
		}, {
			build: ['1.147.74: Change in 1.147.74', ...released],
			olderRelease: ['1.147.74: Change in 1.147.74', ...released],
			newerUpdate: ['1.147.75: Change in 1.147.74', ...released],
			withoutLatest: ['1.147.74: Change in 1.147.74'],
			invalidLatest: ['1.147.74: Change in 1.147.74'],
			invalidLocal: undefined,
			localWithNullEntry: ['1.147.74: Change in 1.147.74'],
			latestWithoutReleasesUrl: ['1.147.74: Change in 1.147.74'],
			otherBuild: undefined,
		});
	});

	test('selects what is new since the stable release a version has, and the stable releases before it', () => {
		const prereleaseFeed: IReleaseNotesFeed = { ...feed, releases: [release('1.147.74', { prerelease: true }), ...feed.releases] };
		const versions = (request: IReleaseNotesRequest, from = feed) => {
			const selection = selectReleaseNotes(from, request);
			return { since: selection.since, new: selection.newReleases.map(r => r.version), earlier: selection.earlierReleases.map(r => r.version), incomplete: selection.incomplete };
		};

		assert.deepStrictEqual({
			current: versions({ kind: ReleaseNotesKind.Current, version: '1.147.72' }),
			update: versions({ kind: ReleaseNotesKind.Update, version: '1.147.73', since: '1.146.70' }),
			updatedFromPrerelease: versions({ kind: ReleaseNotesKind.Updated, version: '1.147.73', since: '1.147.72' }),
			prereleaseUpdatedFromPrerelease: versions({ kind: ReleaseNotesKind.Updated, version: '1.147.74', since: '1.147.72' }, prereleaseFeed),
			updatedFromOlderThanFeed: versions({ kind: ReleaseNotesKind.Updated, version: '1.146.71', since: '1.135.60' }),
			downgraded: versions({ kind: ReleaseNotesKind.Updated, version: '1.146.71', since: '1.147.72' }),
		}, {
			current: { since: undefined, new: ['1.147.72'], earlier: ['1.146.71', '1.146.70'], incomplete: false },
			update: { since: '1.146.70', new: ['1.147.73', '1.146.71'], earlier: ['1.146.70'], incomplete: false },
			updatedFromPrerelease: { since: '1.146.71', new: ['1.147.73'], earlier: ['1.146.71', '1.146.70'], incomplete: false },
			prereleaseUpdatedFromPrerelease: { since: '1.146.71', new: ['1.147.74', '1.147.73'], earlier: ['1.146.71', '1.146.70'], incomplete: false },
			updatedFromOlderThanFeed: { since: '1.135.60', new: ['1.146.71', '1.146.70'], earlier: [], incomplete: true },
			downgraded: { since: '1.146.71', new: [], earlier: ['1.146.71', '1.146.70'], incomplete: false },
		});
	});

	test('writes the release notes page', () => {
		const date = '2026-11-17T19:34:54Z';
		const dated = { ...feed, releases: [release('1.147.72', { prerelease: true, date, notes: ['Fix `code`', 'Add a setting'] }), release('1.146.71', { notes: [] })] };

		assert.deepStrictEqual({
			update: createReleaseNotesMarkdown(dated, { kind: ReleaseNotesKind.Update, version: '1.147.72', since: '1.146.71' }, 'Unbroken Code', '1.146.71', undefined),
			updatedFromPrerelease: createReleaseNotesMarkdown({ ...feed, releases: [release('1.147.73', { prerelease: true, notes: ['A', 'B'] }), release('1.147.72', { prerelease: true, notes: ['A'] }), release('1.146.71')] }, { kind: ReleaseNotesKind.Updated, version: '1.147.73', since: '1.147.72' }, 'Unbroken Code', '1.147.73', undefined),
			updateFromPrerelease: createReleaseNotesMarkdown({ ...feed, releases: [release('1.147.73', { prerelease: true, notes: ['A', 'B'] }), release('1.147.72', { prerelease: true, notes: ['A'] }), release('1.146.71')] }, { kind: ReleaseNotesKind.Update, version: '1.147.73', since: '1.147.72' }, 'Unbroken Code', '1.147.72', undefined),
			notPublished: createReleaseNotesMarkdown(feed, { kind: ReleaseNotesKind.Updated, version: '1.147.80', since: '1.147.73' }, 'Unbroken Code', '1.147.80', undefined),
			missingTarget: createReleaseNotesMarkdown(feed, { kind: ReleaseNotesKind.Update, version: '1.147.80', since: '1.147.72' }, 'Unbroken Code', '1.147.72', undefined).body.split('\n\n').slice(0, 3),
			unavailable: createReleaseNotesMarkdown(undefined, { kind: ReleaseNotesKind.Current, version: '1.147.72' }, 'Unbroken Code', '1.147.72', 'https://example.com/fallback'),
		}, {
			update: {
				header: '# Update to Unbroken Code 1.147.72\n\nYou have 1.146.71. These are the changes the update brings.',
				body: [
					'## New in This Update',
					`### [1.147.72](https://example.com/releases/tag/release/1.147.72) · ${formatDate(Date.parse(date))} · Pre-release\n\n- Fix \`code\`\n- Add a setting`,
					'## Earlier Releases',
					'### [1.146.71](https://example.com/releases/tag/release/1.146.71)\n\n*No changes are listed for this release.*',
					'[See all releases on GitHub](https://example.com/releases)',
				].join('\n\n'),
			},
			updatedFromPrerelease: {
				header: '# Unbroken Code 1.147.73\n\nUpdated from 1.147.72.',
				body: [
					'## New Since 1.146.71',
					'### [1.147.73](https://example.com/releases/tag/release/1.147.73) · Pre-release\n\n- A\n- B',
					'## Earlier Releases',
					'### [1.146.71](https://example.com/releases/tag/release/1.146.71)\n\n- Change in 1.146.71',
					'[See all releases on GitHub](https://example.com/releases)',
				].join('\n\n'),
			},
			updateFromPrerelease: {
				header: '# Update to Unbroken Code 1.147.73\n\nYou have 1.147.72. These are the changes in the update since 1.146.71.',
				body: [
					'## New Since 1.146.71',
					'### [1.147.73](https://example.com/releases/tag/release/1.147.73) · Pre-release\n\n- A\n- B',
					'## Earlier Releases',
					'### [1.146.71](https://example.com/releases/tag/release/1.146.71)\n\n- Change in 1.146.71',
					'[See all releases on GitHub](https://example.com/releases)',
				].join('\n\n'),
			},
			notPublished: {
				header: '# Unbroken Code 1.147.80\n\nUpdated from 1.147.73.',
				body: [
					'## New Since 1.147.73',
					'The release notes of 1.147.80 aren\'t available.',
					'## Earlier Releases',
					...feed.releases.filter(r => !r.prerelease).map(r => `### [${r.version}](${r.url})\n\n- Change in ${r.version}`),
					'[See all releases on GitHub](https://example.com/releases)',
				].join('\n\n'),
			},
			missingTarget: [
				'## New Since 1.146.71',
				'The release notes of 1.147.80 aren\'t available.',
				'### [1.147.73](https://example.com/releases/tag/release/1.147.73)',
			],
			unavailable: {
				header: '# Unbroken Code 1.147.72',
				body: 'The release notes couldn\'t be downloaded.\n\n[See all releases on GitHub](https://example.com/fallback)',
			},
		});
	});
});
