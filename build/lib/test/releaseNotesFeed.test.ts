/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { createLocalReleaseNotesFeed, createReleaseNotesFeed, type IReleaseNotesSource, parseReleaseNotes } from '../../release/release-notes-feed.ts';

function release(version: string, options: { prerelease?: boolean; draft?: boolean; notes?: string[] } = {}): IReleaseNotesSource {
	return {
		tag_name: `release/${version}`,
		html_url: `https://example.com/releases/tag/release/${version}`,
		body: `Commit: \`abc\`\n\n## What's New\n\n${(options.notes ?? [`Notes of ${version}`]).map(note => `- ${note}`).join('\n')}\n\n---\n## Downloads\n\n- not a note\n`,
		draft: options.draft ?? false,
		prerelease: options.prerelease ?? false,
		published_at: '2026-11-17T19:34:54Z',
		created_at: '2026-11-17T19:00:00Z',
	};
}

suite('release notes feed', () => {

	test('reads the items of the What\'s New list of a release description', () => {
		assert.deepStrictEqual({
			list: parseReleaseNotes('Commit: `abc`\r\n\r\n## What\'s New\r\n\r\n- Fix `code` in hovers\r\n* Add a setting\r\n\r\n---\r\n## Downloads\r\n- not a note'),
			endsAtHeading: parseReleaseNotes('## What\'s New\n- First\n## Downloads\n- not a note'),
			none: parseReleaseNotes('Commit: `abc`\n\n---\n## Downloads\n- not a note'),
			noBody: parseReleaseNotes(null),
		}, {
			list: ['Fix `code` in hovers', 'Add a setting'],
			endsAtHeading: ['First'],
			none: [],
			noBody: [],
		});
	});

	test('has the release and the stable releases before it, newest first', () => {
		const releases = [
			release('1.146.12'),
			release('1.146.11', { draft: true }),
			release('1.146.10', { prerelease: true }),
			{ ...release('0'), tag_name: 'update-feed' },
			release('1.144.10', { prerelease: true }),
			release('1.144.9'),
			release('1.144.8', { notes: [] }),
			release('1.135.7'),
			release('1.135.6'),
		];
		const versions = (version: string) => createReleaseNotesFeed(releases, version, 'https://example.com/releases', 3).releases.map(entry => `${entry.version}${entry.prerelease ? ' (pre-release)' : ''}`);

		assert.deepStrictEqual({
			latest: versions('1.146.12'),
			prerelease: versions('1.146.10'),
			older: versions('1.144.8'),
			entry: createReleaseNotesFeed([release('1.144.8')], '1.144.8', 'https://example.com/releases'),
		}, {
			latest: ['1.146.12', '1.144.9', '1.144.8'],
			prerelease: ['1.146.10 (pre-release)', '1.144.9', '1.144.8'],
			older: ['1.144.8', '1.135.7', '1.135.6'],
			entry: {
				releasesUrl: 'https://example.com/releases',
				releases: [{
					version: '1.144.8',
					date: '2026-11-17T19:34:54Z',
					prerelease: false,
					url: 'https://example.com/releases/tag/release/1.144.8',
					notes: ['Notes of 1.144.8'],
				}],
			},
		});
	});

	test('makes the local release notes of the version being built', () => {
		assert.deepStrictEqual(createLocalReleaseNotesFeed('1.147.74', ['Fix a thing'], 'https://example.com/releases', new Date('2026-11-23T10:00:00Z')), {
			releasesUrl: 'https://example.com/releases',
			releases: [{ version: '1.147.74', date: '2026-11-23T10:00:00.000Z', prerelease: false, url: 'https://example.com/releases', notes: ['Fix a thing'] }],
		});
	});
});
