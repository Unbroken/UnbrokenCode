/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import { Octokit } from '@octokit/rest';
import { getGitHubToken } from './create-github-release';

const REPO_OWNER = 'Unbroken';
const REPO_NAME = 'UnbrokenCode';
const FEED_ASSET_NAME = 'updates-feed.json';
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
	}) as any;

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

async function generateUpdateFeed(octokit: Octokit): Promise<UpdateFeed> {
	console.log('Fetching releases from GitHub...');

	const { data: releases } = await octokit.repos.listReleases({
		owner: REPO_OWNER,
		repo: REPO_NAME,
		per_page: 100
	});

	const feed: UpdateFeed = {
		latest: {},
		releases: {},
		lastUpdated: 0 // Will be set to the largest timestamp from processed releases
	};

	let lastUpdatedTimestamp = 0;

	// Process releases (they come sorted by date, newest first)
	for (const release of releases) {
		// Skip drafts, prereleases, and the feed release itself
		if (release.draft || release.prerelease || release.tag_name === FEED_RELEASE_TAG) {
			continue;
		}

		const version = parseVersion(release.tag_name);
		const commit = extractCommitFromNotes(release.body || '');

		console.log(`Processing release: ${version}`);

		// Look for updates.json in assets
		const updatesAsset = release.assets?.find(a => a.name === 'updates.json');

		if (updatesAsset) {
			try {
				// Download and parse the updates.json
				const updatesContent = await downloadAssetContent(octokit, updatesAsset.id);
				const updates = JSON.parse(updatesContent);

				// Initialize version entry
				if (!feed.releases[version]) {
					feed.releases[version] = {};
				}

				// Process each platform
				for (const [platform, info] of Object.entries(updates.assets || {})) {
					const platformInfo = info as any;
					const entryTimestamp = updates.timestamp || new Date(release.published_at || release.created_at).getTime();
					const entry: UpdateFeedEntry = {
						version: updates.version || version,
						productVersion: updates.productVersion || version,
						timestamp: entryTimestamp,
						url: platformInfo.url,
						sha256hash: platformInfo.sha256hash,
						size: platformInfo.size,
						supportsFastUpdate: platformInfo.supportsFastUpdate !== false,
						quality: updates.quality || 'stable',
						commit: commit || updates.commit
					};

					// Track the largest timestamp
					if (entryTimestamp > lastUpdatedTimestamp) {
						lastUpdatedTimestamp = entryTimestamp;
					}

					// Add to releases
					feed.releases[version][platform] = entry;

					// Update latest if this is the newest timestamp for this platform
					if (!feed.latest[platform] || entry.timestamp > feed.latest[platform].timestamp) {
						feed.latest[platform] = entry;
					}
				}
			} catch (error) {
				console.warn(`Failed to process updates.json for ${release.tag_name}:`, error);

				// Fallback: construct feed from asset names
				// IMPORTANT: Use ZIP files for macOS auto-updater (Squirrel.Mac requirement)
				const platforms = ['darwin-arm64', 'darwin-x64', 'darwin-universal'];

				if (!feed.releases[version]) {
					feed.releases[version] = {};
				}

				for (const platform of platforms) {
					const zipAsset = release.assets?.find(a =>
						a.name.includes(platform) && a.name.endsWith('.zip')
					);

					if (zipAsset) {
						const entryTimestamp = new Date(release.published_at || release.created_at).getTime();
						const entry: UpdateFeedEntry = {
							version: version,
							productVersion: version,
							timestamp: entryTimestamp,
							url: zipAsset.browser_download_url,
							size: zipAsset.size,
							supportsFastUpdate: true,
							quality: 'stable',
							commit: commit
						};

						// Track the largest timestamp
						if (entryTimestamp > lastUpdatedTimestamp) {
							lastUpdatedTimestamp = entryTimestamp;
						}

						feed.releases[version][platform] = entry;

						// Update latest if this is the newest timestamp for this platform
						if (!feed.latest[platform] || entry.timestamp > feed.latest[platform].timestamp) {
							feed.latest[platform] = entry;
						}
					}
				}
			}
		}
	}

	// Set the final lastUpdated timestamp to the largest timestamp found
	feed.lastUpdated = lastUpdatedTimestamp || Date.now();

	return feed;
}

async function ensureFeedRelease(octokit: Octokit): Promise<any> {
	try {
		// Try to get existing feed release
		const { data } = await octokit.repos.getReleaseByTag({
			owner: REPO_OWNER,
			repo: REPO_NAME,
			tag: FEED_RELEASE_TAG
		});
		return data;
	} catch (error: any) {
		if (error.status === 404) {
			// Create feed release if it doesn't exist
			console.log('Creating update-feed release...');
			const { data } = await octokit.repos.createRelease({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				tag_name: FEED_RELEASE_TAG,
				name: 'Update Feed',
				body: 'Auto-generated update feed for Unbroken Code automatic updates.\n\n**⚠️ DO NOT DELETE THIS RELEASE**\n\nThis release contains the `updates-feed.json` file that is used by the auto-updater.',
				draft: false,
				prerelease: false
			});
			return data;
		}
		throw error;
	}
}

async function uploadFeedAsset(octokit: Octokit, feed: UpdateFeed): Promise<void> {
	const feedRelease = await ensureFeedRelease(octokit);

	// Prepare new feed content
	const feedContent = JSON.stringify(feed, null, 2);
	const feedBuffer = Buffer.from(feedContent, 'utf8');
	const newFeedSHA256 = crypto.createHash('sha256').update(feedBuffer).digest('hex');

	// Check if feed asset already exists and compare SHA256
	const existingAsset = feedRelease.assets?.find((a: any) => a.name === FEED_ASSET_NAME);

	let feedChanged = false;
	if (existingAsset) {
		// Extract SHA256 from GitHub's digest property (format: "sha256:hash")
		let existingSHA: string | null = null;
		if (existingAsset.digest && existingAsset.digest.startsWith('sha256:')) {
			existingSHA = existingAsset.digest.substring('sha256:'.length);
		}

		if (existingSHA === newFeedSHA256) {
			console.log(`✓ ${FEED_ASSET_NAME} unchanged (SHA256: ${existingSHA.substring(0, 8)}...), skipping`);
		} else {
			feedChanged = true;
			console.log(`~ ${FEED_ASSET_NAME} changed, updating...`);
			await octokit.repos.deleteReleaseAsset({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				asset_id: existingAsset.id
			});
		}
	}

	if (feedChanged) {
		// Upload main feed asset
		console.log(`Uploading ${FEED_ASSET_NAME}...`);
		await octokit.repos.uploadReleaseAsset({
			owner: REPO_OWNER,
			repo: REPO_NAME,
			release_id: feedRelease.id,
			name: FEED_ASSET_NAME,
			data: feedBuffer as any,
			headers: {
				'content-type': 'application/json',
				'content-length': feedBuffer.length
			}
		});

		console.log(`✓ Feed uploaded successfully`);
	}

	// Create platform-specific feeds for auto-updater compatibility

	// 1. Squirrel.Mac feeds (for macOS)
	const darwinPlatforms = ['darwin-arm64', 'darwin-x64', 'darwin-universal'];
	for (const platform of darwinPlatforms) {
		if (feed.latest[platform]) {
			const latestVersion = feed.latest[platform].version;

			// Build releases array with all versions for this platform
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
				.sort((a, b) => b.version.localeCompare(a.version)); // Sort newest first

			// Squirrel.Mac format with currentRelease
			const squirrelFeed = {
				currentRelease: latestVersion,
				releases: releases
			};

			// Use simplified naming: latest-{platform}.json for all platforms
			const squirrelFileName = `latest-${platform}.json`;
			const squirrelContent = JSON.stringify(squirrelFeed, null, 2);
			const squirrelBuffer = Buffer.from(squirrelContent, 'utf8');

			// Check if existing feed needs updating
			const existingSquirrel = feedRelease.assets?.find((a: any) => a.name === squirrelFileName);
			const needsUpdate = await shouldUpdateAsset(existingSquirrel, squirrelContent);

			if (!needsUpdate) {
				const existingSHA = existingSquirrel.digest?.substring('sha256:'.length) || 'unknown';
				console.log(`✓ ${squirrelFileName} unchanged (SHA256: ${existingSHA.substring(0, 8)}...), skipping`);
				continue;
			}

			// Delete existing if it exists
			if (existingSquirrel) {
				console.log(`~ ${squirrelFileName} changed, updating...`);
				await octokit.repos.deleteReleaseAsset({
					owner: REPO_OWNER,
					repo: REPO_NAME,
					asset_id: existingSquirrel.id
				});
			}

			// Upload new Squirrel feed
			console.log(`Uploading ${squirrelFileName}...`);
			await octokit.repos.uploadReleaseAsset({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				release_id: feedRelease.id,
				name: squirrelFileName,
				data: squirrelBuffer as any,
				headers: {
					'content-type': 'application/json',
					'content-length': squirrelBuffer.length
				}
			});

			console.log(`✓ Uploaded Squirrel.Mac feed: ${squirrelFileName}`);
		}
	}

	// 2. Linux/Windows feeds (IUpdate format) - prepare for future
	const otherPlatforms = ['linux-x64', 'linux-arm64', 'linux-armhf', 'win32-x64', 'win32-arm64'];
	for (const platform of otherPlatforms) {
		if (feed.latest[platform]) {
			// VS Code IUpdate format for Linux/Windows
			const iUpdateFeed: UpdateFeedEntry = {
				version: feed.latest[platform].commit || feed.latest[platform].version, // Commit hash for Linux/Windows
				productVersion: feed.latest[platform].version,
				timestamp: feed.latest[platform].timestamp,
				url: feed.latest[platform].url,
				sha256hash: feed.latest[platform].sha256hash,
				size: feed.latest[platform].size,
				supportsFastUpdate: feed.latest[platform].supportsFastUpdate,
				quality: feed.latest[platform].quality
			};

			const platformFileName = `latest-${platform}.json`;
			const platformContent = JSON.stringify(iUpdateFeed, null, 2);
			const platformBuffer = Buffer.from(platformContent, 'utf8');

			// Check if existing feed needs updating
			const existingPlatform = feedRelease.assets?.find((a: any) => a.name === platformFileName);
			const needsUpdate = await shouldUpdateAsset(existingPlatform, platformContent);

			if (!needsUpdate) {
				const existingSHA = existingPlatform.digest?.substring('sha256:'.length) || 'unknown';
				console.log(`✓ ${platformFileName} unchanged (SHA256: ${existingSHA.substring(0, 8)}...), skipping`);
				continue;
			}

			// Delete existing if it exists
			if (existingPlatform) {
				console.log(`~ ${platformFileName} changed, updating...`);
				await octokit.repos.deleteReleaseAsset({
					owner: REPO_OWNER,
					repo: REPO_NAME,
					asset_id: existingPlatform.id
				});
			}

			// Upload platform feed
			console.log(`Uploading ${platformFileName}...`);
			await octokit.repos.uploadReleaseAsset({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				release_id: feedRelease.id,
				name: platformFileName,
				data: platformBuffer as any,
				headers: {
					'content-type': 'application/json',
					'content-length': platformBuffer.length
				}
			});

			console.log(`✓ Uploaded ${platform} feed: ${platformFileName}`);
		}
	}
}

// Function to generate feed URL for product.json
export function getFeedUrl(): string {
	return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${FEED_RELEASE_TAG}/${FEED_ASSET_NAME}`;
}

// Helper function to check if asset needs updating based on SHA256
async function shouldUpdateAsset(existingAsset: any, newContent: string): Promise<boolean> {
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
export async function updateReleaseFeed(octokit?: Octokit): Promise<void> {
	if (!octokit) {
		const token = getGitHubToken();
		octokit = new Octokit({ auth: token });
	}

	const feed = await generateUpdateFeed(octokit);
	await uploadFeedAsset(octokit, feed);
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0] || 'generate';

	// Initialize GitHub API client
	const token = getGitHubToken();
	const octokit = new Octokit({ auth: token });

	switch (command) {
		case 'generate':
			{
				console.log('Generating update feed from GitHub releases...');
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

				await uploadFeedAsset(octokit, feed);

				console.log(`\nFeed generated and uploaded successfully!`);
				console.log(`\nStatic feed URL for product.json:`);
				console.log(`  "updateUrl": "${getFeedUrl()}"`);
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

		case 'url':
			// Just print the feed URL
			console.log(getFeedUrl());
			break;

		default:
			console.log('Usage:');
			console.log('  ts-node update-feed-generator.ts generate     - Generate and upload feed');
			console.log('  ts-node update-feed-generator.ts platform [platform] [quality] - Test platform query');
			console.log('  ts-node update-feed-generator.ts url          - Print feed URL');
	}
}

// Run if executed directly
if (require.main === module) {
	main().catch(error => {
		console.error('Error:', error);
		process.exit(1);
	});
}
