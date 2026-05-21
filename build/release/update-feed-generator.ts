/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import { type RestEndpointMethodTypes, Octokit } from '@octokit/rest';
import { getGitHubToken } from './create-github-release.ts';
import { fileURLToPath } from 'url';

type GitHubReleaseAsset = RestEndpointMethodTypes['repos']['listReleaseAssets']['response']['data'][number] & { digest?: string };
type GitHubRelease = RestEndpointMethodTypes['repos']['listReleases']['response']['data'][number];

const REPO_OWNER = 'Unbroken';
const REPO_NAME = 'UnbrokenCode';
const FEED_RELEASE_TAG = 'update-feed';

interface UpdateFeedEntry {
	version: string;
	productVersion: string;
	timestamp: number;
	url: string;
	sha256hash?: string;
	size: number;
	supportsFastUpdate: boolean;
	quality: string;
	commit?: string;
}

interface UpdateFeed {
	latest: {
		[platform: string]: UpdateFeedEntry;
	};
	releases: {
		[version: string]: {
			[platform: string]: UpdateFeedEntry;
		};
	};
	lastUpdated: number;
}

interface ManifestAsset {
	url: string;
	sha256hash?: string;
	size: number;
	supportsFastUpdate: boolean;
}

interface PlatformManifest {
	platform: 'windows' | 'linux' | 'macos';
	arch: 'x64' | 'arm64' | 'universal';
	version: string;
	productVersion: string;
	commit?: string;
	quality: string;
	timestamp: number;
	assets: Record<string, ManifestAsset>;
}

function mapPlatformToFeedKey(manifest: PlatformManifest): string {
	let platform: string;
	switch (manifest.platform) {
		case 'macos':
			platform = 'darwin';
			break;
		case 'windows':
			platform = 'win32';
			break;
		default:
			platform = 'linux';
	}
	return `${platform}-${manifest.arch}`;
}

function getFeedKeysForAsset(manifest: PlatformManifest, baseKey: string, assetKey: string): string[] {
	if (manifest.platform === 'windows') {
		switch (assetKey) {
			case 'installer-system':
				return [`${baseKey}-system-setup`];
			case 'installer-user':
				return [`${baseKey}-user-setup`];
			case 'app-zip':
				return [baseKey, `${baseKey}-archive`];
			default:
				return [];
		}
	}
	if (manifest.platform === 'macos') {
		if (assetKey === 'app-zip') {
			return [baseKey];
		}
		return [];
	}
	if (manifest.platform === 'linux') {
		if (assetKey === 'app-tar') {
			return [baseKey];
		}
		return [];
	}
	return [];
}

function parseManifest(content: string, fallbackPlatform?: PlatformManifest['platform'], fallbackArch?: PlatformManifest['arch']): PlatformManifest {
	const parsed = JSON.parse(content);
	return {
		platform: parsed.platform ?? fallbackPlatform ?? 'linux',
		arch: parsed.arch ?? fallbackArch ?? 'x64',
		version: parsed.version,
		productVersion: parsed.productVersion ?? parsed.version,
		commit: parsed.commit,
		quality: parsed.quality ?? 'stable',
		timestamp: parsed.timestamp ?? Date.now(),
		assets: parsed.assets ?? {}
	};
}

function parseVersion(tagName: string): string {
	// Remove 'v' prefix if present
	return tagName.startsWith('v') ? tagName.substring(1) : tagName;
}

function extractCommitFromNotes(body: string): string | undefined {
	// Look for commit hash in release notes (format: "Commit: `hash`")
	const match = body.match(/Commit:\s*`([a-f0-9]{40})`/i);
	return match ? match[1] : undefined;
}

async function downloadAssetContent(octokit: Octokit, assetId: number): Promise<string> {
	const { data } = await octokit.repos.getReleaseAsset({
		owner: REPO_OWNER,
		repo: REPO_NAME,
		asset_id: assetId,
		headers: {
			Accept: 'application/octet-stream'
		}
	}) as { data: unknown };

	// Handle different response types
	if (Buffer.isBuffer(data)) {
		return data.toString('utf8');
	} else if (data instanceof ArrayBuffer) {
		// Convert ArrayBuffer to string
		return Buffer.from(data).toString('utf8');
	} else if (typeof data === 'string') {
		return data;
	} else {
		// If it's something else, try to convert it to string
		return String(data);
	}
}

async function fetchLatestProductRelease(octokit: Octokit): Promise<GitHubRelease | null> {
	// Find the most recent published release (including prereleases) so that
	// beta/rc feeds point to the correct build. The stream-specific file
	// naming (latest-beta-*, latest-rc-*, latest-*) is what separates streams
	// on the client side.
	const { data: releases } = await octokit.repos.listReleases({
		owner: REPO_OWNER,
		repo: REPO_NAME,
		per_page: 100
	});
	return releases.find((release): release is GitHubRelease => !release.draft && release.tag_name !== FEED_RELEASE_TAG) ?? null;
}

async function generateUpdateFeed(octokit: Octokit): Promise<UpdateFeed> {
	console.log('Fetching latest release from GitHub...');

	const release = await fetchLatestProductRelease(octokit);

	const feed: UpdateFeed = {
		latest: {},
		releases: {},
		lastUpdated: 0
	};

	if (!release) {
		console.warn('No suitable release found for update feed generation.');
		feed.lastUpdated = Date.now();
		return feed;
	}

	const version = parseVersion(release.tag_name);
	const commit = extractCommitFromNotes(release.body || '');
	const manifestAssets = release.assets?.filter(asset => asset.name?.startsWith('manifest-') && asset.name.endsWith('.json')) ?? [];

	if (manifestAssets.length === 0) {
		console.warn(`No manifest assets found for ${release.tag_name}, unable to generate feed.`);
		feed.lastUpdated = Date.now();
		return feed;
	}

	feed.releases[version] = {};
	let lastUpdatedTimestamp = 0;

	for (const asset of manifestAssets) {
		try {
			const fallbackPlatform = asset.name.includes('windows') ? 'windows' : asset.name.includes('macos') ? 'macos' : 'linux';
			const fallbackArch = asset.name.includes('arm64') ? 'arm64' : asset.name.includes('universal') ? 'universal' : 'x64';
			const content = await downloadAssetContent(octokit, asset.id);
			const manifest = parseManifest(content, fallbackPlatform as PlatformManifest['platform'], fallbackArch as PlatformManifest['arch']);
			const platformKey = mapPlatformToFeedKey(manifest);
			const releaseTimestamp = new Date(release.published_at || release.created_at).getTime();
			const assetEntries = Object.entries(manifest.assets) as [string, ManifestAsset][];
			if (assetEntries.length === 0) {
				continue;
			}

			const recordEntry = (key: string, entry: UpdateFeedEntry) => {
				const entryCopy = { ...entry };
				if (entryCopy.timestamp > lastUpdatedTimestamp) {
					lastUpdatedTimestamp = entryCopy.timestamp;
				}
				feed.releases[version][key] = entryCopy;
				if (!feed.latest[key] || entryCopy.timestamp > feed.latest[key].timestamp) {
					feed.latest[key] = entryCopy;
				}
			};

			let baseAssigned = false;

			for (const [assetKey, assetInfo] of assetEntries) {
				const entryTimestamp = manifest.timestamp || releaseTimestamp;
				const entry: UpdateFeedEntry = {
					version: manifest.version || version,
					productVersion: manifest.productVersion || manifest.version || version,
					timestamp: entryTimestamp,
					url: assetInfo.url,
					sha256hash: assetInfo.sha256hash,
					size: assetInfo.size,
					supportsFastUpdate: assetInfo.supportsFastUpdate !== false,
					quality: manifest.quality || 'stable',
					commit: commit || manifest.commit
				};

				let targetKeys = getFeedKeysForAsset(manifest, platformKey, assetKey);
				if (targetKeys.length === 0 && assetInfo.supportsFastUpdate !== false && !baseAssigned) {
					targetKeys = [platformKey];
				}

				if (targetKeys.length === 0) {
					continue;
				}

				for (const key of targetKeys) {
					recordEntry(key, entry);
					if (key === platformKey) {
						baseAssigned = true;
					}
				}
			}

			if (!baseAssigned) {
				const fastAssetEntry = assetEntries.find(([, info]) => info.supportsFastUpdate !== false) ?? assetEntries[0];
				if (fastAssetEntry) {
					const [, fastAsset] = fastAssetEntry;
					const entryTimestamp = manifest.timestamp || releaseTimestamp;
					const fallbackEntry: UpdateFeedEntry = {
						version: manifest.version || version,
						productVersion: manifest.productVersion || manifest.version || version,
						timestamp: entryTimestamp,
						url: fastAsset.url,
						sha256hash: fastAsset.sha256hash,
						size: fastAsset.size,
						supportsFastUpdate: fastAsset.supportsFastUpdate !== false,
						quality: manifest.quality || 'stable',
						commit: commit || manifest.commit
					};
					recordEntry(platformKey, fallbackEntry);
				}
			}
		} catch (error) {
			console.warn(`Failed to process manifest ${asset.name} for ${release.tag_name}:`, error);
		}
	}

	// Set the final lastUpdated timestamp to the largest timestamp found
	feed.lastUpdated = lastUpdatedTimestamp || Date.now();

	return feed;
}

async function ensureFeedRelease(octokit: Octokit): Promise<GitHubRelease> {
	try {
		// Try to get existing feed release
		const { data } = await octokit.repos.getReleaseByTag({
			owner: REPO_OWNER,
			repo: REPO_NAME,
			tag: FEED_RELEASE_TAG
		});
		return data;
	} catch (error: unknown) {
		const errorRecord = error as Record<string, unknown> | null;
		if (errorRecord?.status === 404) {
			// Create feed release if it doesn't exist
			console.log('Creating update-feed release...');
			const { data } = await octokit.repos.createRelease({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				tag_name: FEED_RELEASE_TAG,
				name: 'Update Feed',
				body: 'Auto-generated update feed for Unbroken Code automatic updates.\n\n**⚠️ DO NOT DELETE THIS RELEASE**\n\nThis release hosts the auto-update manifest files used by the updater.',
				draft: false,
				prerelease: false
			});
			return data;
		}
		throw error;
	}
}

/**
 * Returns the feed filename prefix for a given release stream.
 * - 'stable' -> 'latest'
 * - 'beta'   -> 'latest-beta'
 * - 'rc'     -> 'latest-rc'
 */
function getFeedPrefix(stream: string): string {
	if (stream === 'stable') {
		return 'latest';
	}
	return `latest-${stream}`;
}

async function uploadOrSkipAsset(
	octokit: Octokit,
	feedReleaseId: number,
	releaseAssets: GitHubReleaseAsset[],
	fileName: string,
	content: string,
	label: string
): Promise<GitHubReleaseAsset[]> {
	const buffer = Buffer.from(content, 'utf8');
	const existing = releaseAssets.find(a => a.name === fileName);
	const needsUpdate = await shouldUpdateAsset(existing, content);

	if (!needsUpdate) {
		const existingSHA = existing?.digest?.substring('sha256:'.length) || 'unknown';
		console.log(`✓ ${fileName} unchanged (SHA256: ${existingSHA.substring(0, 8)}...), skipping`);
		return releaseAssets;
	}

	if (existing) {
		console.log(`~ ${fileName} changed, updating...`);
		await octokit.repos.deleteReleaseAsset({
			owner: REPO_OWNER,
			repo: REPO_NAME,
			asset_id: existing.id
		});
		releaseAssets = releaseAssets.filter(asset => asset.id !== existing.id);
	}

	console.log(`Uploading ${fileName}...`);
	await octokit.repos.uploadReleaseAsset({
		owner: REPO_OWNER,
		repo: REPO_NAME,
		release_id: feedReleaseId,
		name: fileName,
		data: buffer as unknown as string,
		headers: {
			'content-type': 'application/json',
			'content-length': buffer.length
		}
	});

	console.log(`✓ Uploaded ${label}: ${fileName}`);
	return releaseAssets;
}

async function uploadFeedAsset(octokit: Octokit, feed: UpdateFeed, streams: string[] = ['stable']): Promise<void> {
	const feedRelease = await ensureFeedRelease(octokit);

	let releaseAssets: GitHubReleaseAsset[] = (feedRelease.assets ?? []) as GitHubReleaseAsset[];

	for (const stream of streams) {
		const prefix = getFeedPrefix(stream);
		console.log(`\nGenerating feeds for stream: ${stream} (prefix: ${prefix})`);

		// 1. Squirrel.Mac feeds (for macOS)
		const darwinPlatforms = ['darwin-arm64', 'darwin-x64', 'darwin-universal'];
		for (const platform of darwinPlatforms) {
			if (feed.latest[platform]) {
				const latestVersion = feed.latest[platform].version;

				const releases = Object.keys(feed.releases)
					.filter(version => feed.releases[version][platform])
					.map(version => {
						const release = feed.releases[version][platform];
						return {
							version: release.version,
							updateTo: {
								version: release.version,
								name: release.version,
								notes: `Update to Unbroken Code ${release.version}`,
								pub_date: new Date(release.timestamp).toISOString(),
								url: release.url
							}
						};
					})
					.sort((a, b) => b.version.localeCompare(a.version));

				const squirrelFeed = {
					currentRelease: latestVersion,
					releases: releases
				};

				const fileName = `${prefix}-${platform}.json`;
				const content = JSON.stringify(squirrelFeed, null, 2);
				releaseAssets = await uploadOrSkipAsset(octokit, feedRelease.id, releaseAssets, fileName, content, `Squirrel.Mac ${stream} feed`);
			}
		}

		// 2. Linux feeds (IUpdate format)
		const linuxPlatforms = ['linux-x64', 'linux-arm64'];
		for (const platform of linuxPlatforms) {
			if (feed.latest[platform]) {
				const iUpdateFeed: UpdateFeedEntry = {
					version: feed.latest[platform].commit || feed.latest[platform].version,
					productVersion: feed.latest[platform].version,
					timestamp: feed.latest[platform].timestamp,
					url: feed.latest[platform].url,
					sha256hash: feed.latest[platform].sha256hash,
					size: feed.latest[platform].size,
					supportsFastUpdate: feed.latest[platform].supportsFastUpdate,
					quality: feed.latest[platform].quality
				};

				const fileName = `${prefix}-${platform}.json`;
				const content = JSON.stringify(iUpdateFeed, null, 2);
				releaseAssets = await uploadOrSkipAsset(octokit, feedRelease.id, releaseAssets, fileName, content, `${platform} ${stream} feed`);
			}
		}

		// 3. Windows feeds
		const windowsArchs = ['x64', 'arm64'];
		for (const arch of windowsArchs) {
			const winPlatform = `win32-${arch}`;

			// System installer (default)
			const systemSetupKey = `${winPlatform}-system-setup`;
			if (feed.latest[systemSetupKey]) {
				const systemFeed: UpdateFeedEntry = {
					version: feed.latest[systemSetupKey].commit || feed.latest[systemSetupKey].version,
					productVersion: feed.latest[systemSetupKey].version,
					timestamp: feed.latest[systemSetupKey].timestamp,
					url: feed.latest[systemSetupKey].url,
					sha256hash: feed.latest[systemSetupKey].sha256hash,
					size: feed.latest[systemSetupKey].size,
					supportsFastUpdate: false,
					quality: feed.latest[systemSetupKey].quality
				};

				const fileName = `${prefix}-${winPlatform}.json`;
				const content = JSON.stringify(systemFeed, null, 2);
				releaseAssets = await uploadOrSkipAsset(octokit, feedRelease.id, releaseAssets, fileName, content, `Windows ${arch} system ${stream} feed`);
			}

			// User installer
			const userSetupKey = `${winPlatform}-user-setup`;
			if (feed.latest[userSetupKey]) {
				const userFeed: UpdateFeedEntry = {
					version: feed.latest[userSetupKey].commit || feed.latest[userSetupKey].version,
					productVersion: feed.latest[userSetupKey].version,
					timestamp: feed.latest[userSetupKey].timestamp,
					url: feed.latest[userSetupKey].url,
					sha256hash: feed.latest[userSetupKey].sha256hash,
					size: feed.latest[userSetupKey].size,
					supportsFastUpdate: false,
					quality: feed.latest[userSetupKey].quality
				};

				const fileName = `${prefix}-${winPlatform}-user.json`;
				const content = JSON.stringify(userFeed, null, 2);
				releaseAssets = await uploadOrSkipAsset(octokit, feedRelease.id, releaseAssets, fileName, content, `Windows ${arch} user ${stream} feed`);
			}

			// Archive/ZIP (portable)
			const archiveKey = `${winPlatform}-archive`;
			if (feed.latest[archiveKey]) {
				const archiveFeed: UpdateFeedEntry = {
					version: feed.latest[archiveKey].commit || feed.latest[archiveKey].version,
					productVersion: feed.latest[archiveKey].version,
					timestamp: feed.latest[archiveKey].timestamp,
					url: feed.latest[archiveKey].url,
					sha256hash: feed.latest[archiveKey].sha256hash,
					size: feed.latest[archiveKey].size,
					supportsFastUpdate: true,
					quality: feed.latest[archiveKey].quality
				};

				const fileName = `${prefix}-${winPlatform}-archive.json`;
				const content = JSON.stringify(archiveFeed, null, 2);
				releaseAssets = await uploadOrSkipAsset(octokit, feedRelease.id, releaseAssets, fileName, content, `Windows ${arch} archive ${stream} feed`);
			}
		}
	}
}

// Helper function to check if asset needs updating based on SHA256
async function shouldUpdateAsset(existingAsset: GitHubReleaseAsset | undefined, newContent: string): Promise<boolean> {
	if (!existingAsset) {
		return true; // New asset, needs upload
	}

	// Calculate SHA256 of new content
	const newContentSHA256 = crypto.createHash('sha256').update(newContent, 'utf8').digest('hex');

	// Extract SHA256 from GitHub's digest property (format: "sha256:hash")
	let existingSHA: string | null = null;
	if (existingAsset.digest && existingAsset.digest.startsWith('sha256:')) {
		existingSHA = existingAsset.digest.substring('sha256:'.length);
	}

	return !existingSHA || existingSHA !== newContentSHA256;
}

// Platform-specific feed endpoint that mimics VS Code's update API
export async function generatePlatformFeed(octokit: Octokit, platform: string, quality: string = 'stable'): Promise<UpdateFeedEntry | null> {
	const feed = await generateUpdateFeed(octokit);

	// Map platform names to our asset names
	const platformMap: { [key: string]: string } = {
		'darwin': 'darwin-universal',
		'darwin-arm64': 'darwin-arm64',
		'darwin-x64': 'darwin-x64',
		'darwin-universal': 'darwin-universal'
	};

	const mappedPlatform = platformMap[platform] || platform;
	const entry = feed.latest[mappedPlatform];

	// Filter by quality if needed
	if (entry && entry.quality !== quality) {
		return null;
	}

	return entry || null;
}

// Export function for use by create-github-release.ts
export async function updateReleaseFeed(octokit?: Octokit, streams?: string[]): Promise<void> {
	if (!octokit) {
		const token = getGitHubToken();
		octokit = new Octokit({ auth: token });
	}

	const feed = await generateUpdateFeed(octokit);
	await uploadFeedAsset(octokit, feed, streams ?? ['stable']);
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0] || 'generate';

	// Parse --streams=<list> flag (comma-separated: stable,beta,rc)
	const streamsArg = args.find(a => a.startsWith('--streams='));
	const streams: string[] = streamsArg
		? streamsArg.substring('--streams='.length).split(',').map(s => s.trim()).filter(Boolean)
		: ['stable'];

	// Initialize GitHub API client
	const token = getGitHubToken();
	const octokit = new Octokit({ auth: token });

	switch (command) {
		case 'generate':
			{
				console.log(`Generating update feed from GitHub releases for streams: ${streams.join(', ')}...`);
				const feed = await generateUpdateFeed(octokit);

				console.log('\nLatest versions:');
				for (const [platform, info] of Object.entries(feed.latest)) {
					console.log(`  ${platform}: ${info.productVersion} (${info.commit?.substring(0, 7) || 'no commit'})`);
				}

				console.log('\nAll releases:');
				for (const version of Object.keys(feed.releases).sort()) {
					const platforms = Object.keys(feed.releases[version]);
					console.log(`  ${version}: ${platforms.join(', ')}`);
				}

				await uploadFeedAsset(octokit, feed, streams);

				console.log(`\nFeed assets refreshed successfully!`);
				break;
			}

		case 'platform':
			// Used for testing platform-specific queries
			{
				const platform = args[1] || 'darwin-universal';
				const quality = args[2] || 'stable';
				console.log(`Fetching update for platform: ${platform}, quality: ${quality}`);

				const update = await generatePlatformFeed(octokit, platform, quality);
				if (update) {
					console.log('Update available:', JSON.stringify(update, null, 2));
				} else {
					console.log('No update available');
				}
				break;
			}

		default:
			console.log('Usage:');
			console.log('  ts-node update-feed-generator.ts generate [--streams=stable,beta,rc] - Generate and upload feed');
			console.log('  ts-node update-feed-generator.ts platform [platform] [quality]       - Test platform query');
	}
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch(error => {
		console.error('Error:', error);
		process.exit(1);
	});
}
