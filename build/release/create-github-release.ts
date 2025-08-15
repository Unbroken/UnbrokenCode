/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';

const REPO_OWNER = 'Unbroken';
const REPO_NAME = 'UnbrokenCode';

interface ReleaseAsset {
	name: string;
	path: string;
	contentType: string;
}

type GitHubRelease = RestEndpointMethodTypes['repos']['createRelease']['response']['data'];
type GitHubAssetBase = RestEndpointMethodTypes['repos']['listReleaseAssets']['response']['data'][0];

// Extend GitHubAsset to include digest property that's not in the types
interface GitHubAsset extends GitHubAssetBase {
	digest?: string; // Format: "sha256:hash"
}

interface ExtendedRelease extends GitHubRelease {
	existingAssets?: GitHubAsset[];
}

function getProductInfo(): any {
	const productPath = path.join(__dirname, '../../product.json');
	return JSON.parse(fs.readFileSync(productPath, 'utf8'));
}


function getCurrentCommit(): string {
	return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
}

function getBuiltCommit(): string {
	// Get commit from all built product.json files and ensure they match
	const distDir = path.join(__dirname, '../../.dist');
	const architectures = ['arm64', 'x64', 'universal'];
	const commits: { arch: string; commit: string }[] = [];

	for (const arch of architectures) {
		const productPath = path.join(distDir, `VSCode-darwin-${arch}`, 'Unbroken Code.app', 'Contents', 'Resources', 'app', 'product.json');
		if (fs.existsSync(productPath)) {
			const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
			if (product.commit) {
				commits.push({ arch, commit: product.commit });
			}
		}
	}

	if (commits.length === 0) {
		console.error('ERROR: No built product.json found with commit information.');
		console.error('Please build the application first before creating a release.');
		process.exit(1);
	}

	// Check all commits are the same
	const uniqueCommits = [...new Set(commits.map(c => c.commit))];
	if (uniqueCommits.length > 1) {
		console.error('ERROR: Different architectures have different commits!');
		for (const { arch, commit } of commits) {
			console.error(`  ${arch}: ${commit}`);
		}
		console.error('Please rebuild all architectures with the same commit.');
		process.exit(1);
	}

	return uniqueCommits[0];
}

function getFileHash(filePath: string): string {
	const fileBuffer = fs.readFileSync(filePath);
	const hashSum = crypto.createHash('sha256');
	hashSum.update(fileBuffer);
	return hashSum.digest('hex');
}

function getFileSize(filePath: string): number {
	return fs.statSync(filePath).size;
}

function createDMG(appPath: string, dmgPath: string, volumeName: string): void {
	console.log(`Creating DMG from ${appPath} to ${dmgPath}`);

	// Use hdiutil to create a DMG
	const tempDmg = dmgPath.replace('.dmg', '.temp.dmg');

	// Create DMG
	execSync(`hdiutil create -volname "${volumeName}" -srcfolder "${appPath}" -ov -format UDRW "${tempDmg}"`, {
		stdio: 'inherit'
	});

	// Convert to compressed DMG
	execSync(`hdiutil convert "${tempDmg}" -format UDZO -o "${dmgPath}"`, {
		stdio: 'inherit'
	});

	// Remove temp DMG
	fs.unlinkSync(tempDmg);
}

function createZip(appPath: string, zipPath: string): void {
	console.log(`Creating ZIP from ${appPath} to ${zipPath}`);

	// Use ditto to create a ZIP archive (preserves macOS metadata)
	execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, {
		stdio: 'inherit'
	});
}

function getGitHubToken(): string {
	// Try environment variables in order of preference
	const token = process.env.GITHUB_TOKEN ||
		process.env.GH_TOKEN ||
		process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

	if (!token) {
		throw new Error('GitHub token not found. Set GITHUB_TOKEN, GH_TOKEN, or GITHUB_PERSONAL_ACCESS_TOKEN environment variable.');
	}

	return token;
}

async function createGitHubRelease(octokit: Octokit, tagName: string, releaseName: string, body: string, draft: boolean = true): Promise<ExtendedRelease> {
	console.log(`Checking for existing release: ${tagName}`);

	// Get the commit from the built product.json files
	const targetCommit = getBuiltCommit();

	// Check if the commit exists on origin/main
	try {
		execSync(`git fetch origin main`, { stdio: 'pipe' });
		execSync(`git merge-base --is-ancestor ${targetCommit} origin/main`, { stdio: 'pipe' });
	} catch (error) {
		console.error(`\nERROR: The commit ${targetCommit} from the built product.json is not on origin/main.`);
		console.error('Please push your commits to GitHub before creating a release.');
		console.error('\nRun: git push origin main');
		process.exit(1);
	}

	// Try to get existing release first
	let release: ExtendedRelease;
	try {
		const { data } = await octokit.repos.getReleaseByTag({
			owner: REPO_OWNER,
			repo: REPO_NAME,
			tag: tagName
		});
		console.log(`Found existing release, updating...`);

		// Update the existing release
		const updateResult = await octokit.repos.updateRelease({
			owner: REPO_OWNER,
			repo: REPO_NAME,
			release_id: data.id,
			name: releaseName,
			body: body,
			draft: draft,
			prerelease: false
		});

		// Create ExtendedRelease object with existing assets
		release = {
			...updateResult.data,
			existingAssets: data.assets || []
		};
	} catch (error: any) {
		if (error.status === 404) {
			// Release doesn't exist, create it
			console.log(`Creating new release: ${tagName}`);
			const createResult = await octokit.repos.createRelease({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				tag_name: tagName,
				name: releaseName,
				body: body,
				draft: draft,
				prerelease: false,
				target_commitish: targetCommit
			});

			// Create ExtendedRelease object for new release
			release = {
				...createResult.data,
				existingAssets: [] // No existing assets for new releases
			};
		} else {
			throw error;
		}
	}

	console.log(`Release ready: ${release.html_url}`);
	return release;
}

async function optimizeAssetUploads(octokit: Octokit, release: ExtendedRelease, assets: ReleaseAsset[]): Promise<ReleaseAsset[]> {
	if (!release.existingAssets || release.existingAssets.length === 0) {
		console.log(`No existing assets, uploading all ${assets.length} assets`);
		return assets;
	}

	const assetsToDelete: Array<{ id: number; name: string }> = [];
	const assetsToUpload: ReleaseAsset[] = [];

	// Check each new asset against existing ones
	for (const newAsset of assets) {
		const existingAsset = release.existingAssets.find(a => a.name === newAsset.name);

		if (!existingAsset) {
			// New asset, needs to be uploaded
			assetsToUpload.push(newAsset);
		} else {
			// Calculate SHA256 of new asset to compare with existing
			const newAssetSHA256 = getFileHash(newAsset.path);

			// Extract SHA256 from GitHub's digest property (format: "sha256:hash")
			let existingSHA: string | null = null;
			if (existingAsset.digest && existingAsset.digest.startsWith('sha256:')) {
				existingSHA = existingAsset.digest.substring('sha256:'.length);
			}

			if (!existingSHA || existingSHA !== newAssetSHA256) {
				// Asset changed or no SHA available, delete old and upload new
				console.log(`  ~ ${newAsset.name} changed (SHA256 mismatch), updating`);
				assetsToDelete.push({ id: existingAsset.id, name: existingAsset.name });
				assetsToUpload.push(newAsset);
			} else {
				// Asset unchanged, skip uploading
				console.log(`  ✓ ${existingAsset.name} unchanged (SHA256: ${existingSHA.substring(0, 8)}...), skipping`);
			}
		}
	}

	// Check for assets that no longer exist in new list
	for (const existingAsset of release.existingAssets) {
		const newAsset = assets.find(a => a.name === existingAsset.name);
		if (!newAsset) {
			// Asset was removed, delete it
			assetsToDelete.push({ id: existingAsset.id, name: existingAsset.name });
		}
	}

	// Delete outdated assets
	if (assetsToDelete.length > 0) {
		console.log(`Removing ${assetsToDelete.length} changed/removed assets...`);
		for (const asset of assetsToDelete) {
			console.log(`  - Deleting ${asset.name}`);
			await octokit.repos.deleteReleaseAsset({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				asset_id: asset.id
			});
		}
	}

	if (assetsToUpload.length === 0) {
		console.log(`All assets are up to date, nothing to upload`);
	} else {
		console.log(`Uploading ${assetsToUpload.length} new/changed assets...`);
	}

	return assetsToUpload;
}

async function uploadReleaseAsset(octokit: Octokit, releaseId: number, asset: ReleaseAsset): Promise<void> {
	console.log(`Uploading ${asset.name}...`);

	const fileContent = fs.readFileSync(asset.path);

	try {
		await octokit.repos.uploadReleaseAsset({
			owner: REPO_OWNER,
			repo: REPO_NAME,
			release_id: releaseId,
			name: asset.name,
			data: fileContent as any,
			headers: {
				'content-type': asset.contentType,
				'content-length': fileContent.length
			}
		});

		console.log(`  ✓ Uploaded ${asset.name}`);
	} catch (error: any) {
		if (error.status === 422 && error.message.includes('already_exists')) {
			console.log(`  ⚠ ${asset.name} already exists, skipping...`);
		} else {
			throw error;
		}
	}
}

async function main() {
	const distDir = path.join(__dirname, '../../.dist');
	const product = getProductInfo();
	const commit = getCurrentCommit();

	// Get version from built product.json - this ensures we're releasing what was actually built
	const architectures = ['arm64', 'x64', 'universal'];
	const foundVersions: { arch: string; version: string }[] = [];

	// Check for built product.json in all architecture builds
	for (const arch of architectures) {
		const builtProductPath = path.join(distDir, `VSCode-darwin-${arch}`, 'Unbroken Code.app', 'Contents', 'Resources', 'app', 'product.json');
		if (fs.existsSync(builtProductPath)) {
			try {
				const builtProduct = JSON.parse(fs.readFileSync(builtProductPath, 'utf8'));
				const archVersion = builtProduct.version;
				console.log(`Found version ${archVersion} in ${arch} build`);
				foundVersions.push({ arch, version: archVersion });
			} catch (error) {
				console.error(`Failed to read version from ${builtProductPath}:`, error);
				process.exit(1);
			}
		}
	}

	// Error if no built product.json found
	if (foundVersions.length === 0) {
		console.error('ERROR: No built product.json found in .dist directory');
		console.error('Please run the build script first before creating a release.');
		console.error('Expected locations:');
		for (const arch of architectures) {
			console.error(`  - .dist/VSCode-darwin-${arch}/Unbroken Code.app/Contents/Resources/app/product.json`);
		}
		process.exit(1);
	}

	// Check that all architectures have the same version
	const uniqueVersions = [...new Set(foundVersions.map(v => v.version))];
	if (uniqueVersions.length > 1) {
		console.error('ERROR: Different architectures have different versions!');
		for (const { arch, version } of foundVersions) {
			console.error(`  - ${arch}: ${version}`);
		}
		console.error('All architectures must have the same version. Please rebuild all architectures.');
		process.exit(1);
	}

	const version = foundVersions[0].version;
	console.log(`\nAll architectures have consistent version: ${version}`);

	const tagName = `release/${version}`;

	console.log(`Creating GitHub release for ${product.nameLong} ${version}`);
	console.log(`Commit: ${commit}`);

	// Initialize GitHub API client
	const token = getGitHubToken();
	const octokit = new Octokit({ auth: token });

	// Prepare release assets
	const assets: ReleaseAsset[] = [];
	const releaseNotes: string[] = [];

	// Verify all architectures are built
	const missingArchitectures: string[] = [];
	for (const arch of architectures) {
		const appDir = path.join(distDir, `VSCode-darwin-${arch}`);
		const appPath = path.join(appDir, 'Unbroken Code.app');
		if (!fs.existsSync(appPath)) {
			missingArchitectures.push(arch);
		}
	}

	if (missingArchitectures.length > 0) {
		console.error('ERROR: Not all architectures are built!');
		console.error('Missing architectures:', missingArchitectures.join(', '));
		console.error('All architectures (arm64, x64, universal) must be built before creating a release.');
		process.exit(1);
	}

	// Process each architecture
	for (const arch of architectures) {
		const appDir = path.join(distDir, `VSCode-darwin-${arch}`);
		const appPath = path.join(appDir, 'Unbroken Code.app');

		// Create DMG
		const dmgName = `UnbrokenCode-darwin-${arch}-${version}.dmg`;
		const dmgPath = path.join(distDir, dmgName);
		if (!fs.existsSync(dmgPath)) {
			createDMG(appPath, dmgPath, `Unbroken Code ${version}`);
		}

		// Create ZIP
		const zipName = `UnbrokenCode-darwin-${arch}-${version}.zip`;
		const zipPath = path.join(distDir, zipName);
		if (!fs.existsSync(zipPath)) {
			createZip(appPath, zipPath);
		}

		// Add assets
		assets.push({
			name: dmgName,
			path: dmgPath,
			contentType: 'application/x-apple-diskimage'
		});

		assets.push({
			name: zipName,
			path: zipPath,
			contentType: 'application/zip'
		});

		// Generate metadata for release notes
		const dmgHash = getFileHash(dmgPath);
		const zipHash = getFileHash(zipPath);
		const dmgSize = getFileSize(dmgPath);
		const zipSize = getFileSize(zipPath);

		releaseNotes.push(`### macOS ${arch}`);
		releaseNotes.push(`- **DMG**: \`${dmgName}\` (${(dmgSize / 1024 / 1024).toFixed(2)} MB)`);
		releaseNotes.push(`  - SHA256: \`${dmgHash}\``);
		releaseNotes.push(`- **ZIP**: \`${zipName}\` (${(zipSize / 1024 / 1024).toFixed(2)} MB)`);
		releaseNotes.push(`  - SHA256: \`${zipHash}\``);
		releaseNotes.push('');
	}

	// Create update manifest JSON for auto-updater
	// IMPORTANT: macOS auto-updater (Squirrel.Mac) requires ZIP files, not DMG!
	// Use deterministic timestamp based on built product.json to avoid unnecessary updates
	const builtProductPath = path.join(distDir, `VSCode-darwin-universal`, 'Unbroken Code.app', 'Contents', 'Resources', 'app', 'product.json');
	const builtProduct = JSON.parse(fs.readFileSync(builtProductPath, 'utf8'));
	const buildTimestamp = new Date(builtProduct.date || Date.now()).getTime();

	const updateManifest = {
		version: version,
		productVersion: version,
		commit: commit,
		timestamp: buildTimestamp,
		quality: 'stable',
		assets: architectures.reduce((acc, arch) => {
			const zipName = `UnbrokenCode-darwin-${arch}-${version}.zip`;
			const zipPath = path.join(distDir, zipName);
			if (fs.existsSync(zipPath)) {
				acc[`darwin-${arch}`] = {
					url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${zipName}`,
					sha256hash: getFileHash(zipPath),
					size: getFileSize(zipPath),
					supportsFastUpdate: true
				};
			}
			return acc;
		}, {} as any)
	};

	// Save update manifest
	const manifestPath = path.join(distDir, 'updates.json');
	fs.writeFileSync(manifestPath, JSON.stringify(updateManifest, null, 2));

	assets.push({
		name: 'updates.json',
		path: manifestPath,
		contentType: 'application/json'
	});

	// Create release body
	const releaseBody = [
		`## ${product.nameLong} ${version}`,
		'',
		`Commit: \`${commit}\``,
		'',
		...releaseNotes,
		'---',
		'### Installation',
		'',
		'**macOS**: Download the DMG file for your architecture:',
		'- Apple Silicon: `UnbrokenCode-darwin-arm64-*.dmg`',
		'- Intel: `UnbrokenCode-darwin-x64-*.dmg`',
		'- Universal (works on both): `UnbrokenCode-darwin-universal-*.dmg`',
		'',
		'Open the DMG and drag Unbroken Code to your Applications folder.',
		'',
		'### Auto-Update',
		'This release supports automatic updates. Once installed, Unbroken Code will check for updates automatically.'
	].join('\n');

	// Check for --publish flag
	const shouldPublish = process.argv.includes('--publish');

	// Always create as draft first to upload all artifacts before it's visible
	const release = await createGitHubRelease(
		octokit,
		tagName,
		`${product.nameLong} ${version}`,
		releaseBody,
		true // Always create as draft initially
	);

	// Optimize asset uploads (only upload changed assets)
	console.log('\nOptimizing asset uploads...');
	const assetsToUpload = await optimizeAssetUploads(octokit, release, assets);

	// Upload only the assets that need updating
	for (const asset of assetsToUpload) {
		await uploadReleaseAsset(octokit, release.id, asset);
	}

	// If --publish flag was provided, publish the draft release
	if (shouldPublish) {
		console.log('\nPublishing release...');
		try {
			await octokit.repos.updateRelease({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				release_id: release.id,
				draft: false
			});
			console.log('Release published successfully!');
		} catch (error: any) {
			console.error('Error publishing release:', error.message);
			process.exit(1);
		}
	}

	console.log('\nRelease preparation complete!');
	console.log(`Release URL: ${release.html_url}`);

	if (!shouldPublish) {
		console.log('\nRelease created as DRAFT. To publish:');
		console.log(`  - Visit ${release.html_url} and click "Publish release"`);
		console.log(`  - Or run: node build/release/create-github-release.js --publish`);
	}

	// After creating release, update the feed
	console.log('\nUpdating release feed...');
	try {
		const { updateReleaseFeed } = await import('./update-feed-generator.js');
		await updateReleaseFeed(octokit);
		console.log('Release feed updated');
	} catch (error) {
		console.warn('Could not update release feed:', error);
		console.log('Run manually: node build/release/update-feed-generator.js');
	}
}

// Run if executed directly
if (require.main === module) {
	main().catch(error => {
		console.error('Error creating release:', error);
		process.exit(1);
	});
}

export { createDMG, createZip, getFileHash, getFileSize, getGitHubToken };
