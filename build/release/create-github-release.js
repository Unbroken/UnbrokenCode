"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDMG = createDMG;
exports.createZip = createZip;
exports.getFileHash = getFileHash;
exports.getFileSize = getFileSize;
exports.getGitHubToken = getGitHubToken;
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const rest_1 = require("@octokit/rest");
const create_dmg_installer_1 = require("./create-dmg-installer");
const REPO_OWNER = 'Unbroken';
const REPO_NAME = 'UnbrokenCode';
const repoPath = path.dirname(path.dirname(__dirname));
const DEBUG = process.env.RELEASE_DEBUG === '1' || process.argv.includes('--debug');
function debugLog(...args) {
    if (DEBUG) {
        console.log('[release:debug]', ...args);
    }
}
function getProductInfo() {
    const productPath = path.join(__dirname, '../../product.json');
    return JSON.parse(fs.readFileSync(productPath, 'utf8'));
}
function getBuiltCommit() {
    // Get commit from all built product.json files and ensure they match
    const distDir = path.join(__dirname, '../../.dist');
    const architectures = ['arm64', 'x64', 'universal'];
    const commits = [];
    for (const arch of architectures) {
        // Check macOS builds
        const macOSProductPath = path.join(distDir, `VSCode-darwin-${arch}`, 'Unbroken Code.app', 'Contents', 'Resources', 'app', 'product.json');
        if (fs.existsSync(macOSProductPath)) {
            const product = JSON.parse(fs.readFileSync(macOSProductPath, 'utf8'));
            if (product.commit) {
                commits.push({ arch: `darwin-${arch}`, commit: product.commit });
            }
        }
        // Check Windows builds (skip universal for Windows)
        if (arch !== 'universal') {
            const windowsProductPath = path.join(distDir, `VSCode-win32-${arch}`, 'resources', 'app', 'product.json');
            if (fs.existsSync(windowsProductPath)) {
                const product = JSON.parse(fs.readFileSync(windowsProductPath, 'utf8'));
                if (product.commit) {
                    commits.push({ arch: `win32-${arch}`, commit: product.commit });
                }
            }
            // Check Linux builds (skip universal for Linux)
            const linuxProductPath = path.join(distDir, `VSCode-linux-${arch}`, 'resources', 'app', 'product.json');
            if (fs.existsSync(linuxProductPath)) {
                const product = JSON.parse(fs.readFileSync(linuxProductPath, 'utf8'));
                if (product.commit) {
                    commits.push({ arch: `linux-${arch}`, commit: product.commit });
                }
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
function getReleaseTagsFromGit() {
    try {
        // Fetch tags from origin to ensure we have the latest
        (0, child_process_1.execSync)('git fetch origin --tags --prune-tags', { stdio: 'pipe' });
        const output = (0, child_process_1.execSync)('git tag -l "release/*"', { encoding: 'utf8' }).trim();
        const tags = output ? output.split('\n') : [];
        debugLog('Found release tags:', tags);
        return tags;
    }
    catch (error) {
        console.warn('Warning: Could not get release tags from git');
        return [];
    }
}
function sortReleaseTagsByVersion(tags) {
    return tags.sort((a, b) => {
        // Extract version numbers from tags like "release/1.104.2"
        const versionA = a.replace('release/', '');
        const versionB = b.replace('release/', '');
        // Parse version numbers for proper comparison
        const parseVersion = (version) => {
            const parts = version.split('.').map(part => parseInt(part, 10));
            return parts;
        };
        const partsA = parseVersion(versionA);
        const partsB = parseVersion(versionB);
        // Compare each part of the version number
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const partA = partsA[i] || 0;
            const partB = partsB[i] || 0;
            if (partA !== partB) {
                return partB - partA; // Descending order (newest first)
            }
        }
        return 0;
    });
}
function getCommitsBetween(fromCommit, toCommit, excludeMerges = true) {
    try {
        const noMerges = excludeMerges ? ' --no-merges' : '';
        const output = (0, child_process_1.execSync)(`git rev-list --reverse${noMerges} ${fromCommit}..${toCommit}`, { encoding: 'utf8' }).trim();
        return output ? output.split('\n') : [];
    }
    catch (error) {
        console.warn(`Warning: Could not get commits between ${fromCommit} and ${toCommit}`);
        return [];
    }
}
function getCommitSetBetween(fromCommit, toCommit) {
    const result = new Set();
    if (!fromCommit || !toCommit || fromCommit === toCommit) {
        return result;
    }
    try {
        const output = (0, child_process_1.execSync)(`git rev-list ${fromCommit}..${toCommit}`, { encoding: 'utf8' }).trim();
        if (output) {
            for (const sha of output.split('\n')) {
                result.add(sha);
            }
        }
    }
    catch (error) {
        // ignore
    }
    return result;
}
function getCommitMessage(commit) {
    try {
        return (0, child_process_1.execSync)(`git log -1 --pretty=format:"%B" ${commit}`, { encoding: 'utf8' }).trim();
    }
    catch (error) {
        console.warn(`Warning: Could not get commit message for ${commit}`);
        return '';
    }
}
function getCommitSubjectsBetween(fromCommit, toCommit) {
    const subjects = new Set();
    try {
        const output = (0, child_process_1.execSync)(`git log --no-merges --format=%s ${fromCommit}..${toCommit}`, { encoding: 'utf8' }).trim();
        if (output) {
            for (const line of output.split('\n')) {
                const subject = line.trim();
                if (subject) {
                    subjects.add(subject);
                }
            }
        }
    }
    catch (error) {
        // ignore
    }
    return subjects;
}
function isAncestor(ancestor, descendant) {
    try {
        (0, child_process_1.execSync)(`git merge-base --is-ancestor ${ancestor} ${descendant}`, { stdio: 'pipe' });
        return true;
    }
    catch (error) {
        return false;
    }
}
function getMergeBase(commitA, commitB) {
    try {
        return (0, child_process_1.execSync)(`git merge-base ${commitA} ${commitB}`, { encoding: 'utf8' }).trim();
    }
    catch (error) {
        return null;
    }
}
function remoteExists(remote) {
    try {
        (0, child_process_1.execSync)(`git remote get-url ${remote}`, { stdio: 'pipe' });
        return true;
    }
    catch (error) {
        return false;
    }
}
function getUpstreamSets() {
    const shaSet = new Set();
    const subjectSet = new Set();
    debugLog('Checking for upstream remote...');
    if (!remoteExists('upstream')) {
        debugLog('No upstream remote configured. Skipping upstream filtering.');
        return { shaSet, subjectSet };
    }
    try {
        (0, child_process_1.execSync)('git fetch upstream --tags --prune', { stdio: 'pipe' });
        // Ensure branch exists
        (0, child_process_1.execSync)('git rev-parse --verify upstream/main', { stdio: 'pipe' });
        debugLog('Fetched upstream/main successfully');
    }
    catch (error) {
        debugLog('Failed to fetch/verify upstream/main. Skipping upstream filtering.', error?.message ?? String(error));
        return { shaSet, subjectSet };
    }
    try {
        const shasOutput = (0, child_process_1.execSync)('git rev-list upstream/main', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 }).trim();
        if (shasOutput) {
            for (const sha of shasOutput.split('\n')) {
                shaSet.add(sha);
            }
        }
        debugLog('Upstream SHA set size:', shaSet.size);
    }
    catch (error) {
        debugLog('Error building upstream SHA set:', error?.message ?? String(error));
    }
    try {
        const subjectsOutput = (0, child_process_1.execSync)('git log --format=%s upstream/main', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 }).trim();
        if (subjectsOutput) {
            for (const subj of subjectsOutput.split('\n')) {
                subjectSet.add(subj.trim());
            }
        }
        debugLog('Upstream subject set size:', subjectSet.size);
    }
    catch (error) {
        debugLog('Error building upstream subject set:', error?.message ?? String(error));
    }
    return { shaSet, subjectSet };
}
async function generateReleaseNotes(buildCommit, currentTag) {
    const releaseTags = getReleaseTagsFromGit();
    // Filter out the current tag we're creating
    const filteredTags = releaseTags.filter(tag => tag !== currentTag);
    if (filteredTags.length === 0) {
        console.log('No previous release tags found, no release notes to generate');
        return [];
    }
    const sortedTags = sortReleaseTagsByVersion(filteredTags);
    const latestReleaseTag = sortedTags[0];
    console.log(`Generating release notes from ${latestReleaseTag} to current build commit`);
    // Get commit hash for the latest release tag
    let latestReleaseCommit;
    try {
        latestReleaseCommit = (0, child_process_1.execSync)(`git rev-list -n 1 ${latestReleaseTag}`, { encoding: 'utf8' }).trim();
    }
    catch (error) {
        console.warn(`Warning: Could not get commit for tag ${latestReleaseTag}`);
        return [];
    }
    debugLog('Latest release tag:', latestReleaseTag, 'latestReleaseCommit:', latestReleaseCommit, 'buildCommit:', buildCommit);
    const rebased = !isAncestor(latestReleaseCommit, buildCommit);
    let baseForRange = latestReleaseCommit;
    let mergeBaseNew = null;
    let mergeBasePrev = null;
    let upstreamSegment = null;
    let prevReleaseSubjects = null;
    if (rebased) {
        mergeBaseNew = getMergeBase(latestReleaseCommit, buildCommit);
        if (mergeBaseNew) {
            baseForRange = mergeBaseNew;
        }
        try {
            if (remoteExists('upstream')) {
                (0, child_process_1.execSync)('git fetch upstream main --tags --prune', { stdio: 'pipe' });
                mergeBasePrev = getMergeBase('upstream/main', latestReleaseCommit);
                upstreamSegment = getCommitSetBetween(mergeBasePrev, latestReleaseCommit);
            }
        }
        catch (error) {
            // ignore
        }
        // Build subject set for previous release range (mergeBaseNew..latestReleaseCommit)
        prevReleaseSubjects = getCommitSubjectsBetween(mergeBaseNew || latestReleaseCommit, latestReleaseCommit);
        debugLog('Rebase detected. mergeBaseNew:', mergeBaseNew, 'mergeBasePrev:', mergeBasePrev, 'upstreamSegmentSize:', upstreamSegment ? upstreamSegment.size : 0, 'prevReleaseSubjects:', prevReleaseSubjects.size, 'baseForRange:', baseForRange);
    }
    else {
        debugLog('No rebase detected. Base for range is previous release commit.');
    }
    const commits = getCommitsBetween(baseForRange, buildCommit, true);
    const { shaSet: upstreamShaSet, subjectSet: upstreamSubjectSet } = getUpstreamSets();
    debugLog('Candidate commits count:', commits.length);
    debugLog('Upstream filter sizes:', { shas: upstreamShaSet.size, subjects: upstreamSubjectSet.size });
    const releaseNotes = [];
    const seenSubjects = new Set();
    for (const commit of commits) {
        const message = getCommitMessage(commit);
        if (!message) {
            debugLog('Skipping commit with empty message:', commit.substring(0, 7));
            continue;
        }
        // Take only the first line of the commit message
        const firstLine = message.split('\n')[0].trim();
        // Skip obvious non-notes
        if (!firstLine || firstLine === 'Bump version') {
            debugLog('[skip trivial]', commit.substring(0, 7), firstLine);
            continue;
        }
        if (message.toLowerCase().includes('[no release notes]')) {
            debugLog('[skip tag no release notes]', commit.substring(0, 7), firstLine);
            continue;
        }
        // Exclude commits that come from upstream (by SHA or by subject if available)
        if (upstreamShaSet.size > 0 && upstreamShaSet.has(commit)) {
            debugLog('[skip upstream-sha]', commit.substring(0, 7), firstLine);
            continue;
        }
        if (upstreamSubjectSet.size > 0 && upstreamSubjectSet.has(firstLine)) {
            debugLog('[skip upstream-subject]', commit.substring(0, 7), firstLine);
            continue;
        }
        // On rebase: exclude commit subjects that were already in previous release range (mergeBaseNew..latestReleaseCommit)
        if (rebased && prevReleaseSubjects && prevReleaseSubjects.has(firstLine)) {
            debugLog('[skip prev-release-subject]', commit.substring(0, 7), firstLine);
            continue;
        }
        // De-duplicate within current set by subject
        if (seenSubjects.has(firstLine)) {
            debugLog('[skip duplicate-current]', commit.substring(0, 7), firstLine);
            continue;
        }
        seenSubjects.add(firstLine);
        releaseNotes.push(firstLine);
        debugLog('[add]', commit.substring(0, 7), firstLine);
    }
    if (rebased) {
        // Add a note indicating the rebase occurred
        releaseNotes.unshift('Rebased on upstream');
        debugLog('Added rebase note to release notes');
    }
    debugLog('Final release notes count:', releaseNotes.length);
    return releaseNotes;
}
function getFileHash(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}
function getFileSize(filePath) {
    return fs.statSync(filePath).size;
}
function sortAssetKeys(assets) {
    const sorted = {};
    const keys = Object.keys(assets).sort();
    for (const key of keys) {
        sorted[key] = assets[key];
    }
    return sorted;
}
function createDMG(appPath, dmgPath, volumeName) {
    // Generate background image if it doesn't exist
    const scriptDir = __dirname;
    const backgroundImage = path.join(scriptDir, 'dmg-background.png');
    // Try to generate the background if it doesn't exist
    if (!fs.existsSync(backgroundImage)) {
        try {
            (0, child_process_1.execSync)(`"${path.join(scriptDir, 'generate-dmg-background.sh')}"`, { stdio: 'inherit' });
        }
        catch (error) {
            console.log('Could not generate DMG background image, continuing without it');
        }
    }
    // Use the enhanced DMG creator
    (0, create_dmg_installer_1.createDMGWithInstaller)({
        appPath,
        dmgPath,
        volumeName,
        backgroundImage: fs.existsSync(backgroundImage) ? backgroundImage : undefined,
        windowWidth: 600,
        windowHeight: 428, // Increased to account for status bar
        iconSize: 100,
        appIconX: 175,
        appIconY: 200,
        applicationsIconX: 425,
        applicationsIconY: 200
    });
}
function createZip(appPath, zipPath) {
    console.log(`Creating ZIP from ${appPath} to ${zipPath}`);
    // Use ditto to create a ZIP archive (preserves macOS metadata)
    (0, child_process_1.execSync)(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, {
        stdio: 'inherit'
    });
}
function getGitHubToken() {
    // Try environment variables in order of preference
    const token = process.env.GITHUB_TOKEN ||
        process.env.GH_TOKEN ||
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) {
        throw new Error('GitHub token not found. Set GITHUB_TOKEN, GH_TOKEN, or GITHUB_PERSONAL_ACCESS_TOKEN environment variable.');
    }
    return token;
}
async function findExistingRelease(octokit, tagName, releaseName) {
    let existingRelease = null;
    // First try to find by tag (for published releases)
    try {
        const { data } = await octokit.repos.getReleaseByTag({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            tag: tagName
        });
        existingRelease = data;
        console.log(`Found existing published release by tag`);
    }
    catch (error) {
        if (error.status === 404) {
            // Tag not found, check for draft releases with same name
            console.log(`No published release found, checking for drafts...`);
            try {
                const { data: releases } = await octokit.repos.listReleases({
                    owner: REPO_OWNER,
                    repo: REPO_NAME,
                    per_page: 50
                });
                // Look for draft release with matching name
                existingRelease = releases.find(r => r.name === releaseName);
                if (existingRelease) {
                    console.log(`Found existing draft release: ${existingRelease.name}`);
                }
            }
            catch (listError) {
                console.log(`Failed to list releases:`, listError);
            }
        }
    }
    return existingRelease;
}
async function createGitHubRelease(octokit, tagName, releaseName, body, targetCommit, draft = true) {
    console.log(`Checking for existing release: ${tagName}`);
    console.log(`Target commit: ${targetCommit}`);
    // Use the provided target commit
    // Check if the commit exists on origin/main
    try {
        (0, child_process_1.execSync)(`git fetch origin main`, { stdio: 'pipe' });
        (0, child_process_1.execSync)(`git merge-base --is-ancestor ${targetCommit} origin/main`, { stdio: 'pipe' });
    }
    catch (error) {
        console.error(`\nERROR: The commit ${targetCommit} from the built product.json is not on origin/main.`);
        console.error('Please push your commits to GitHub before creating a release.');
        console.error('\nRun: git push origin main');
        process.exit(1);
    }
    // Ensure Git tag exists (for both create and update paths)
    console.log(`Ensuring Git tag exists: ${tagName} at commit ${targetCommit}`);
    try {
        await octokit.git.createRef({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            ref: `refs/tags/${tagName}`,
            sha: targetCommit
        });
        console.log(`Successfully created Git tag: ${tagName}`);
    }
    catch (error) {
        if (error.status === 422 && error.response?.data?.message?.includes('already exists')) {
            console.log(`Git tag ${tagName} already exists, continuing...`);
            // Update the tag to point to the new commit if needed
            try {
                await octokit.git.updateRef({
                    owner: REPO_OWNER,
                    repo: REPO_NAME,
                    ref: `tags/${tagName}`,
                    sha: targetCommit,
                    force: true
                });
                console.log(`Updated Git tag ${tagName} to point to commit ${targetCommit}`);
            }
            catch (updateError) {
                console.log(`Could not update tag: ${updateError.message}`);
            }
        }
        else {
            console.error(`Failed to create Git tag: ${error.message}`);
            throw error;
        }
    }
    // Try to get existing release first
    let release;
    const existingRelease = await findExistingRelease(octokit, tagName, releaseName);
    if (existingRelease) {
        console.log(`Updating existing release...`);
        console.log(`Existing release commit: ${existingRelease.target_commitish}`);
        console.log(`Existing assets count: ${existingRelease.assets?.length || 0}`);
        // Update the existing release - ensure it's associated with the tag
        const updateResult = await octokit.repos.updateRelease({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            release_id: existingRelease.id,
            tag_name: tagName, // Ensure the release is associated with the tag
            name: releaseName,
            body: body,
            draft: draft,
            prerelease: false,
            target_commitish: targetCommit
        });
        // Create ExtendedRelease object with existing assets
        release = {
            ...updateResult.data,
            existingAssets: existingRelease.assets || []
        };
    }
    else {
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
    }
    console.log(`Release ready: ${release.html_url}`);
    return release;
}
async function optimizeAssetUploads(octokit, release, assets) {
    if (!release.existingAssets || release.existingAssets.length === 0) {
        console.log(`No existing assets, uploading all ${assets.length} assets`);
        return assets;
    }
    const assetsToDelete = [];
    const assetsToUpload = [];
    // Check each new asset against existing ones
    for (const newAsset of assets) {
        const existingAsset = release.existingAssets.find(a => a.name === newAsset.name);
        if (!existingAsset) {
            // New asset, needs to be uploaded
            assetsToUpload.push(newAsset);
        }
        else {
            // Calculate SHA256 of new asset to compare with existing
            const newAssetSHA256 = getFileHash(newAsset.path);
            // Extract SHA256 from GitHub's digest property (format: "sha256:hash")
            let existingSHA = null;
            if (existingAsset.digest && existingAsset.digest.startsWith('sha256:')) {
                existingSHA = existingAsset.digest.substring('sha256:'.length);
            }
            if (!existingSHA || existingSHA !== newAssetSHA256) {
                // Asset changed or no SHA available, delete old and upload new
                console.log(`  ~ ${newAsset.name} changed (SHA256 mismatch), updating`);
                assetsToDelete.push({ id: existingAsset.id, name: existingAsset.name });
                assetsToUpload.push(newAsset);
            }
            else {
                // Asset unchanged, skip uploading
                console.log(`  ✓ ${existingAsset.name} unchanged (SHA256: ${existingSHA.substring(0, 8)}...), skipping`);
            }
        }
    }
    // Determine which platform we're building for based on the assets
    const hasDarwinAssets = assets.some(asset => asset.name.includes('darwin'));
    const hasWindowsAssets = assets.some(asset => asset.name.includes('win32') || asset.name.includes('Setup'));
    const hasLinuxAssets = assets.some(asset => asset.name.includes('linux'));
    console.log(`Current build includes: ${hasDarwinAssets ? 'macOS' : ''} ${hasWindowsAssets ? 'Windows' : ''} ${hasLinuxAssets ? 'Linux' : ''}`.trim());
    // IMPORTANT: Only delete assets from the current platform to preserve cross-platform builds
    // Check for assets that no longer exist in new list, but only for the current platform
    for (const existingAsset of release.existingAssets) {
        const newAsset = assets.find(a => a.name === existingAsset.name);
        if (!newAsset) {
            // Check if this asset belongs to the current build platform
            const isDarwinAsset = existingAsset.name.includes('darwin');
            const isWindowsAsset = existingAsset.name.includes('win32') || existingAsset.name.includes('Setup');
            const isLinuxAsset = existingAsset.name.includes('linux');
            const isGenericAsset = existingAsset.name === 'updates.json'; // Always update generic assets
            // For Linux, check specific architecture to preserve cross-architecture builds
            let shouldDelete = false;
            if (isLinuxAsset && hasLinuxAssets) {
                // Only delete Linux assets that match the architectures we're currently building
                const isLinuxX64Asset = existingAsset.name.includes('linux-x64');
                const isLinuxArm64Asset = existingAsset.name.includes('linux-arm64');
                const buildingX64 = assets.some(a => a.name.includes('linux-x64'));
                const buildingArm64 = assets.some(a => a.name.includes('linux-arm64'));
                // Only delete if we're building that specific architecture
                shouldDelete = (isLinuxX64Asset && buildingX64) || (isLinuxArm64Asset && buildingArm64);
                if (!shouldDelete && (isLinuxX64Asset || isLinuxArm64Asset)) {
                    console.log(`  ✓ Preserving ${existingAsset.name} (different Linux architecture)`);
                }
            }
            else if (isDarwinAsset && hasDarwinAssets) {
                shouldDelete = true;
            }
            else if (isWindowsAsset && hasWindowsAssets) {
                shouldDelete = true;
            }
            else if (isGenericAsset) {
                shouldDelete = true;
            }
            if (shouldDelete) {
                console.log(`  - Removing ${existingAsset.name} (no longer generated by current build)`);
                assetsToDelete.push({ id: existingAsset.id, name: existingAsset.name });
            }
            else if (!isLinuxAsset || !hasLinuxAssets) {
                console.log(`  ✓ Preserving ${existingAsset.name} (from other platform)`);
            }
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
    }
    else {
        console.log(`Uploading ${assetsToUpload.length} new/changed assets...`);
    }
    return assetsToUpload;
}
async function uploadReleaseAsset(octokit, releaseId, asset) {
    console.log(`Uploading ${asset.name}...`);
    const fileContent = fs.readFileSync(asset.path);
    try {
        await octokit.repos.uploadReleaseAsset({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            release_id: releaseId,
            name: asset.name,
            data: fileContent,
            headers: {
                'content-type': asset.contentType,
                'content-length': fileContent.length
            }
        });
        console.log(`  ✓ Uploaded ${asset.name}`);
    }
    catch (error) {
        if (error.status === 422 && error.message.includes('already_exists')) {
            console.log(`  ⚠ ${asset.name} already exists, skipping...`);
        }
        else {
            throw error;
        }
    }
}
async function main() {
    const shouldPublish = process.argv.includes('--publish');
    const regenerateDMG = process.argv.includes('--regenerate-dmg');
    const distDir = path.join(__dirname, '../../.dist');
    const product = getProductInfo();
    // Get version from built product.json - this ensures we're releasing what was actually built
    const architectures = ['arm64', 'x64', 'universal'];
    const foundVersions = [];
    // Check for built product.json in all architecture builds (macOS, Windows, and Linux)
    for (const arch of architectures) {
        // Check macOS builds
        const macOSProductPath = path.join(distDir, `VSCode-darwin-${arch}`, 'Unbroken Code.app', 'Contents', 'Resources', 'app', 'product.json');
        if (fs.existsSync(macOSProductPath)) {
            try {
                const builtProduct = JSON.parse(fs.readFileSync(macOSProductPath, 'utf8'));
                const archVersion = builtProduct.version;
                console.log(`Found version ${archVersion} in darwin-${arch} build`);
                foundVersions.push({ arch: `darwin-${arch}`, version: archVersion });
            }
            catch (error) {
                console.error(`Failed to read version from ${macOSProductPath}:`, error);
                process.exit(1);
            }
        }
        // Check Windows builds (skip universal for Windows)
        if (arch !== 'universal') {
            const windowsProductPath = path.join(distDir, `VSCode-win32-${arch}`, 'resources', 'app', 'product.json');
            if (fs.existsSync(windowsProductPath)) {
                try {
                    const builtProduct = JSON.parse(fs.readFileSync(windowsProductPath, 'utf8'));
                    const archVersion = builtProduct.version;
                    console.log(`Found version ${archVersion} in win32-${arch} build`);
                    foundVersions.push({ arch: `win32-${arch}`, version: archVersion });
                }
                catch (error) {
                    console.error(`Failed to read version from ${windowsProductPath}:`, error);
                    process.exit(1);
                }
            }
            // Check Linux builds (skip universal for Linux)
            const linuxProductPath = path.join(distDir, `VSCode-linux-${arch}`, 'resources', 'app', 'product.json');
            if (fs.existsSync(linuxProductPath)) {
                try {
                    const builtProduct = JSON.parse(fs.readFileSync(linuxProductPath, 'utf8'));
                    const archVersion = builtProduct.version;
                    console.log(`Found version ${archVersion} in linux-${arch} build`);
                    foundVersions.push({ arch: `linux-${arch}`, version: archVersion });
                }
                catch (error) {
                    console.error(`Failed to read version from ${linuxProductPath}:`, error);
                    process.exit(1);
                }
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
            if (arch !== 'universal') {
                console.error(`  - .dist/VSCode-win32-${arch}/resources/app/product.json`);
                console.error(`  - .dist/VSCode-linux-${arch}/resources/app/product.json`);
            }
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
    // Get the commit from built product.json - this is what was actually built
    const builtCommit = getBuiltCommit();
    const tagName = `release/${version}`;
    console.log(`Creating GitHub release for ${product.nameLong} ${version}`);
    console.log(`Built commit: ${builtCommit}`);
    // Initialize GitHub API client
    const token = getGitHubToken();
    const octokit = new rest_1.Octokit({ auth: token });
    // Prepare release assets
    const assets = [];
    // Check for macOS builds
    const darwinArchitectures = ['arm64', 'x64', 'universal'];
    const hasDarwinBuilds = darwinArchitectures.some(arch => {
        const appPath = path.join(distDir, `VSCode-darwin-${arch}`, 'Unbroken Code.app');
        return fs.existsSync(appPath);
    });
    // Check for Windows builds
    const windowsArchitectures = ['x64', 'arm64'];
    const hasWindowsBuilds = windowsArchitectures.some(arch => {
        const winPath = path.join(distDir, `VSCode-win32-${arch}`);
        return fs.existsSync(winPath);
    });
    // Check for Linux builds
    const linuxArchitectures = ['x64', 'arm64'];
    const hasLinuxBuilds = linuxArchitectures.some(arch => {
        const linuxPath = path.join(distDir, `VSCode-linux-${arch}`);
        return fs.existsSync(linuxPath);
    });
    if (!hasDarwinBuilds && !hasWindowsBuilds && !hasLinuxBuilds) {
        console.error('ERROR: No builds found!');
        console.error('Please build at least one platform before creating a release.');
        process.exit(1);
    }
    // Process macOS architectures if available
    if (hasDarwinBuilds) {
        console.log('Processing macOS builds...');
        for (const arch of darwinArchitectures) {
            const appDir = path.join(distDir, `VSCode-darwin-${arch}`);
            const appPath = path.join(appDir, 'Unbroken Code.app');
            if (!fs.existsSync(appPath)) {
                console.log(`  Skipping macOS ${arch} (not built)`);
                continue;
            }
            // Create DMG
            const dmgName = `UnbrokenCode-darwin-${arch}-${version}.dmg`;
            const dmgPath = path.join(distDir, dmgName);
            if (regenerateDMG && fs.existsSync(dmgPath)) {
                console.log(`Removing existing DMG: ${dmgPath}`);
                fs.unlinkSync(dmgPath);
            }
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
            // Check for CLI binary package
            const cliPackageName = `unbroken_code_cli_darwin_${arch}_cli.zip`;
            const cliPackagePath = path.join(distDir, cliPackageName);
            if (fs.existsSync(cliPackagePath)) {
                assets.push({
                    name: cliPackageName,
                    path: cliPackagePath,
                    contentType: 'application/zip'
                });
                console.log(`  Added macOS ${arch} CLI package`);
            }
        }
        // Check for universal CLI package
        const universalCliPackageName = 'unbroken_code_cli_darwin_universal_cli.zip';
        const universalCliPackagePath = path.join(distDir, universalCliPackageName);
        if (fs.existsSync(universalCliPackagePath)) {
            assets.push({
                name: universalCliPackageName,
                path: universalCliPackagePath,
                contentType: 'application/zip'
            });
            console.log(`  Added macOS universal CLI package`);
        }
    }
    // Process Windows architectures if available
    if (hasWindowsBuilds) {
        console.log('Processing Windows builds...');
        // Collect zip creation tasks to run in parallel
        const zipTasks = [];
        const zipAssets = [];
        for (const arch of windowsArchitectures) {
            const winDir = path.join(distDir, `VSCode-win32-${arch}`);
            if (!fs.existsSync(winDir)) {
                console.log(`  Skipping Windows ${arch} (not built)`);
                continue;
            }
            // Create ZIP archive of the Windows build
            const zipName = `UnbrokenCode-win32-${arch}-${version}.zip`;
            const zipPath = path.join(distDir, zipName);
            zipAssets.push({
                name: zipName,
                path: zipPath,
                contentType: 'application/zip'
            });
            if (!fs.existsSync(zipPath)) {
                console.log(`Creating Windows ${arch} ZIP archive...`);
                // Create promise for parallel execution
                const zipTask = new Promise((resolve, reject) => {
                    const powershell = (0, child_process_1.spawn)('powershell', [
                        '-Command',
                        `Compress-Archive -Path '${distDir}/VSCode-win32-${arch}/*' -DestinationPath '${zipPath}' -Force`
                    ], {
                        stdio: 'inherit'
                    });
                    powershell.on('close', (code) => {
                        if (code === 0) {
                            resolve();
                        }
                        else {
                            reject(new Error(`ZIP creation failed for ${arch} with code ${code}`));
                        }
                    });
                    powershell.on('error', reject);
                });
                zipTasks.push(zipTask);
            }
        }
        // Wait for all zip creation tasks to complete
        if (zipTasks.length > 0) {
            console.log(`Creating ${zipTasks.length} ZIP archives in parallel...`);
            await Promise.all(zipTasks);
            console.log('All ZIP archives created successfully!');
        }
        // Add all zip assets to the main assets array
        assets.push(...zipAssets);
        // Add CLI binary packages for Windows
        for (const arch of windowsArchitectures) {
            const winDir = path.join(distDir, `VSCode-win32-${arch}`);
            if (!fs.existsSync(winDir)) {
                continue;
            }
            // Check for CLI binary package
            const cliPackageName = `unbroken_code_cli_win32_${arch}_cli.zip`;
            const cliPackagePath = path.join(distDir, cliPackageName);
            if (fs.existsSync(cliPackagePath)) {
                assets.push({
                    name: cliPackageName,
                    path: cliPackagePath,
                    contentType: 'application/zip'
                });
                console.log(`  Added Windows ${arch} CLI package`);
            }
        }
        // Process installers sequentially (they're usually quick)
        for (const arch of windowsArchitectures) {
            const winDir = path.join(distDir, `VSCode-win32-${arch}`);
            if (!fs.existsSync(winDir)) {
                continue;
            }
            // Check for installers
            const targets = ['user', 'system'];
            for (const target of targets) {
                const setupDir = path.join(repoPath, '.build', `win32-${arch}`, `${target}-setup`);
                const installerName = `UnbrokenCodeSetup-${arch}-${target}-${version}.exe`;
                // Look for any .exe installer in the setup directory
                if (fs.existsSync(setupDir)) {
                    const files = fs.readdirSync(setupDir);
                    const exeFile = files.find(f => f.endsWith('.exe'));
                    if (exeFile) {
                        const sourceInstallerPath = path.join(setupDir, exeFile);
                        const destInstallerPath = path.join(distDir, installerName);
                        // Copy installer to dist directory with proper name
                        fs.copyFileSync(sourceInstallerPath, destInstallerPath);
                        assets.push({
                            name: installerName,
                            path: destInstallerPath,
                            contentType: 'application/x-msdownload'
                        });
                        console.log(`  Added Windows ${arch} ${target} installer`);
                    }
                }
            }
        }
    }
    // Process Linux architectures if available
    if (hasLinuxBuilds) {
        console.log('Processing Linux builds...');
        for (const arch of linuxArchitectures) {
            const linuxDir = path.join(distDir, `VSCode-linux-${arch}`);
            if (!fs.existsSync(linuxDir)) {
                console.log(`  Skipping Linux ${arch} (not built)`);
                continue;
            }
            // Check for tar.gz archive
            const tarGzName = `UnbrokenCode-linux-${arch}.tar.gz`;
            const tarGzPath = path.join(distDir, tarGzName);
            if (fs.existsSync(tarGzPath)) {
                // Rename with version for release
                const versionedTarGzName = `UnbrokenCode-linux-${arch}-${version}.tar.gz`;
                const versionedTarGzPath = path.join(distDir, versionedTarGzName);
                if (!fs.existsSync(versionedTarGzPath)) {
                    fs.copyFileSync(tarGzPath, versionedTarGzPath);
                }
                assets.push({
                    name: versionedTarGzName,
                    path: versionedTarGzPath,
                    contentType: 'application/gzip'
                });
                console.log(`  Added Linux ${arch} tar.gz archive`);
            }
            // Check for .deb package
            const debDir = path.join(repoPath, '.build', 'linux', 'deb');
            if (fs.existsSync(debDir)) {
                const debArch = arch === 'x64' ? 'amd64' : arch;
                const debFiles = fs.readdirSync(debDir, { recursive: true });
                const debFile = debFiles.find(f => f.endsWith('.deb') && f.includes(debArch));
                if (debFile) {
                    const sourceDebPath = path.join(debDir, debFile);
                    const destDebName = `UnbrokenCode-linux-${arch}-${version}.deb`;
                    const destDebPath = path.join(distDir, destDebName);
                    if (!fs.existsSync(destDebPath)) {
                        fs.copyFileSync(sourceDebPath, destDebPath);
                    }
                    assets.push({
                        name: destDebName,
                        path: destDebPath,
                        contentType: 'application/vnd.debian.binary-package'
                    });
                    console.log(`  Added Linux ${arch} .deb package`);
                }
            }
            // Check for .rpm package
            const rpmDir = path.join(repoPath, '.build', 'linux', 'rpm');
            if (fs.existsSync(rpmDir)) {
                const rpmArch = arch === 'x64' ? 'x86_64' : 'aarch64';
                const rpmFiles = fs.readdirSync(rpmDir, { recursive: true });
                const rpmFile = rpmFiles.find(f => f.endsWith('.rpm') && f.includes(rpmArch));
                if (rpmFile) {
                    const sourceRpmPath = path.join(rpmDir, rpmFile);
                    const destRpmName = `UnbrokenCode-linux-${arch}-${version}.rpm`;
                    const destRpmPath = path.join(distDir, destRpmName);
                    if (!fs.existsSync(destRpmPath)) {
                        fs.copyFileSync(sourceRpmPath, destRpmPath);
                    }
                    assets.push({
                        name: destRpmName,
                        path: destRpmPath,
                        contentType: 'application/x-rpm'
                    });
                    console.log(`  Added Linux ${arch} .rpm package`);
                }
            }
            // Check for CLI binary package
            const cliPackageName = `unbroken_code_cli_linux_${arch}_cli.tar.gz`;
            const cliPackagePath = path.join(distDir, cliPackageName);
            if (fs.existsSync(cliPackagePath)) {
                assets.push({
                    name: cliPackageName,
                    path: cliPackagePath,
                    contentType: 'application/gzip'
                });
                console.log(`  Added Linux ${arch} CLI package`);
            }
        }
    }
    // Create update manifest JSON for auto-updater
    // IMPORTANT: macOS auto-updater (Squirrel.Mac) requires ZIP files, not DMG!
    // Windows auto-updater also uses this manifest
    // Use deterministic timestamp based on built product.json to avoid unnecessary updates
    let builtProductPath = path.join(distDir, `VSCode-darwin-universal`, 'Unbroken Code.app', 'Contents', 'Resources', 'app', 'product.json');
    if (!fs.existsSync(builtProductPath)) {
        // Fallback to any available built product.json
        for (const arch of ['arm64', 'x64']) {
            builtProductPath = path.join(distDir, `VSCode-darwin-${arch}`, 'Unbroken Code.app', 'Contents', 'Resources', 'app', 'product.json');
            if (fs.existsSync(builtProductPath)) {
                break;
            }
            builtProductPath = path.join(distDir, `VSCode-win32-${arch}`, 'resources', 'app', 'product.json');
            if (fs.existsSync(builtProductPath)) {
                break;
            }
            builtProductPath = path.join(distDir, `VSCode-linux-${arch}`, 'resources', 'app', 'product.json');
            if (fs.existsSync(builtProductPath)) {
                break;
            }
        }
    }
    const builtProduct = fs.existsSync(builtProductPath) ? JSON.parse(fs.readFileSync(builtProductPath, 'utf8')) : {};
    const buildTimestamp = new Date(builtProduct.date || Date.now()).getTime();
    // Start with existing manifest if it exists (for multi-platform builds)
    let updateManifest = {
        version: version,
        productVersion: version,
        commit: builtCommit,
        timestamp: buildTimestamp,
        quality: 'stable',
        assets: {}
    };
    // Download existing updates.json from the release to merge with our changes
    console.log('Checking for existing updates.json from previous builds...');
    const existingRelease = await findExistingRelease(octokit, tagName, `${product.nameLong} ${version}`);
    const existingUpdatesAsset = existingRelease?.assets?.find((asset) => asset.name === 'updates.json');
    if (existingRelease && existingUpdatesAsset) {
        console.log('Found existing updates.json, downloading for merge via API...');
        const assetUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingUpdatesAsset.id}`;
        const response = await fetch(assetUrl, {
            headers: {
                'Accept': 'application/octet-stream',
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                'User-Agent': 'Unbroken-Code-Release-Script'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to download existing updates.json: ${response.status} ${response.statusText}`);
        }
        const existingManifest = await response.json();
        // Merge existing assets, preserving assets from other platforms
        updateManifest = {
            ...existingManifest,
            version: version,
            productVersion: version,
            commit: builtCommit,
            timestamp: buildTimestamp,
            assets: { ...existingManifest.assets }
        };
        console.log('Merged existing updates.json with current build');
    }
    // Add macOS assets to update manifest (will overwrite existing macOS entries)
    for (const arch of darwinArchitectures) {
        const zipName = `UnbrokenCode-darwin-${arch}-${version}.zip`;
        const zipPath = path.join(distDir, zipName);
        if (fs.existsSync(zipPath)) {
            updateManifest.assets[`darwin-${arch}`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${zipName}`,
                sha256hash: getFileHash(zipPath),
                size: getFileSize(zipPath),
                supportsFastUpdate: true
            };
        }
        // Add DMG file for macOS
        const dmgName = `UnbrokenCode-darwin-${arch}-${version}.dmg`;
        const dmgPath = path.join(distDir, dmgName);
        if (fs.existsSync(dmgPath)) {
            updateManifest.assets[`darwin-${arch}-dmg`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${dmgName}`,
                sha256hash: getFileHash(dmgPath),
                size: getFileSize(dmgPath),
                supportsFastUpdate: false
            };
        }
        // Add CLI package for macOS
        const cliPackageName = `unbroken_code_cli_darwin_${arch}_cli.zip`;
        const cliPackagePath = path.join(distDir, cliPackageName);
        if (fs.existsSync(cliPackagePath)) {
            updateManifest.assets[`darwin-${arch}-cli`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${cliPackageName}`,
                sha256hash: getFileHash(cliPackagePath),
                size: getFileSize(cliPackagePath),
                supportsFastUpdate: false
            };
        }
    }
    // Add universal CLI package for macOS
    const universalCliPackageName = 'unbroken_code_cli_darwin_universal_cli.zip';
    const universalCliPackagePath = path.join(distDir, universalCliPackageName);
    if (fs.existsSync(universalCliPackagePath)) {
        updateManifest.assets['darwin-universal-cli'] = {
            url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${universalCliPackageName}`,
            sha256hash: getFileHash(universalCliPackagePath),
            size: getFileSize(universalCliPackagePath),
            supportsFastUpdate: false
        };
    }
    // Add Windows assets to update manifest (will overwrite existing Windows entries)
    for (const arch of windowsArchitectures) {
        const zipName = `UnbrokenCode-win32-${arch}-${version}.zip`;
        const zipPath = path.join(distDir, zipName);
        if (fs.existsSync(zipPath)) {
            updateManifest.assets[`win32-${arch}`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${zipName}`,
                sha256hash: getFileHash(zipPath),
                size: getFileSize(zipPath),
                supportsFastUpdate: true
            };
        }
        // Add installer URLs for convenience (not used by auto-updater)
        const targets = ['user', 'system'];
        for (const target of targets) {
            const installerName = `UnbrokenCodeSetup-${arch}-${target}-${version}.exe`;
            const installerPath = path.join(distDir, installerName);
            if (fs.existsSync(installerPath)) {
                updateManifest.assets[`win32-${arch}-${target}-setup`] = {
                    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${installerName}`,
                    sha256hash: getFileHash(installerPath),
                    size: getFileSize(installerPath),
                    supportsFastUpdate: false
                };
            }
        }
        // Add CLI package for Windows
        const cliPackageName = `unbroken_code_cli_win32_${arch}_cli.zip`;
        const cliPackagePath = path.join(distDir, cliPackageName);
        if (fs.existsSync(cliPackagePath)) {
            updateManifest.assets[`win32-${arch}-cli`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${cliPackageName}`,
                sha256hash: getFileHash(cliPackagePath),
                size: getFileSize(cliPackagePath),
                supportsFastUpdate: false
            };
        }
    }
    // Add Linux assets to update manifest (will overwrite existing Linux entries)
    for (const arch of linuxArchitectures) {
        const tarGzName = `UnbrokenCode-linux-${arch}-${version}.tar.gz`;
        const tarGzPath = path.join(distDir, tarGzName);
        if (fs.existsSync(tarGzPath)) {
            updateManifest.assets[`linux-${arch}`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${tarGzName}`,
                sha256hash: getFileHash(tarGzPath),
                size: getFileSize(tarGzPath),
                supportsFastUpdate: true
            };
        }
        // Add .deb and .rpm URLs for convenience (not used by auto-updater)
        const debName = `UnbrokenCode-linux-${arch}-${version}.deb`;
        const debPath = path.join(distDir, debName);
        if (fs.existsSync(debPath)) {
            updateManifest.assets[`linux-${arch}-deb`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${debName}`,
                sha256hash: getFileHash(debPath),
                size: getFileSize(debPath),
                supportsFastUpdate: false
            };
        }
        const rpmName = `UnbrokenCode-linux-${arch}-${version}.rpm`;
        const rpmPath = path.join(distDir, rpmName);
        if (fs.existsSync(rpmPath)) {
            updateManifest.assets[`linux-${arch}-rpm`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${rpmName}`,
                sha256hash: getFileHash(rpmPath),
                size: getFileSize(rpmPath),
                supportsFastUpdate: false
            };
        }
        // Add CLI package for Linux
        const cliPackageName = `unbroken_code_cli_linux_${arch}_cli.tar.gz`;
        const cliPackagePath = path.join(distDir, cliPackageName);
        if (fs.existsSync(cliPackagePath)) {
            updateManifest.assets[`linux-${arch}-cli`] = {
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${cliPackageName}`,
                sha256hash: getFileHash(cliPackagePath),
                size: getFileSize(cliPackagePath),
                supportsFastUpdate: false
            };
        }
    }
    // Sort the assets keys for deterministic output (ensures consistent SHA)
    updateManifest.assets = sortAssetKeys(updateManifest.assets);
    // Save update manifest
    const manifestPath = path.join(distDir, 'updates.json');
    fs.writeFileSync(manifestPath, JSON.stringify(updateManifest, null, 2));
    assets.push({
        name: 'updates.json',
        path: manifestPath,
        contentType: 'application/json'
    });
    // Generate release notes  
    const releaseNotes = await generateReleaseNotes(builtCommit, tagName);
    // Create release body
    const releaseBodyParts = [
        `Commit: \`${builtCommit}\``
    ];
    // Add release notes if any were found
    if (releaseNotes.length > 0) {
        releaseBodyParts.push('', '## What\'s New', '', ...releaseNotes.map(note => `- ${note}`));
    }
    // Check which platforms are available in the final merged manifest (for install instructions)
    const hasManifestDarwinBuilds = Object.keys(updateManifest.assets).some(key => key.startsWith('darwin-'));
    const hasManifestWindowsBuilds = Object.keys(updateManifest.assets).some(key => key.startsWith('win32-'));
    const hasManifestLinuxBuilds = Object.keys(updateManifest.assets).some(key => key.startsWith('linux-'));
    // Generate download links for available assets
    const generateDownloadLink = (filename) => `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${encodeURIComponent(tagName)}/${filename}`;
    // Helper function to get CLI download link for a given platform and architecture
    const getCliDownloadLink = (platform, arch) => {
        const manifestAssetKeys = Object.keys(updateManifest.assets);
        const getFilenameFromUrl = (url) => url.split('/').pop() || '';
        const cliAssetKey = manifestAssetKeys.find(key => key === `${platform}-${arch}-cli`);
        if (cliAssetKey) {
            const filename = getFilenameFromUrl(updateManifest.assets[cliAssetKey].url);
            return ` [CLI](${generateDownloadLink(filename)})`;
        }
        return '';
    };
    // Add installation instructions based on available platforms
    releaseBodyParts.push('', '---', '### Installation', '');
    if (hasManifestDarwinBuilds) {
        const macOSDownloads = [];
        // Find available macOS assets from update manifest
        const manifestAssetKeys = Object.keys(updateManifest.assets);
        // Extract filenames from update manifest URLs
        const getFilenameFromUrl = (url) => url.split('/').pop() || '';
        // Look for DMG files first (preferred for manual download), fallback to ZIP
        const arm64Asset = manifestAssetKeys.find(key => key === 'darwin-arm64-dmg') || manifestAssetKeys.find(key => key === 'darwin-arm64');
        const x64Asset = manifestAssetKeys.find(key => key === 'darwin-x64-dmg') || manifestAssetKeys.find(key => key === 'darwin-x64');
        const universalAsset = manifestAssetKeys.find(key => key === 'darwin-universal-dmg') || manifestAssetKeys.find(key => key === 'darwin-universal');
        if (arm64Asset) {
            const filename = getFilenameFromUrl(updateManifest.assets[arm64Asset].url);
            const cliLink = getCliDownloadLink('darwin', 'arm64');
            macOSDownloads.push(`- **Apple Silicon**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        if (x64Asset) {
            const filename = getFilenameFromUrl(updateManifest.assets[x64Asset].url);
            const cliLink = getCliDownloadLink('darwin', 'x64');
            macOSDownloads.push(`- **Intel**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        if (universalAsset) {
            const filename = getFilenameFromUrl(updateManifest.assets[universalAsset].url);
            const cliLink = getCliDownloadLink('darwin', 'universal');
            macOSDownloads.push(`- **Universal** (works on both): [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        releaseBodyParts.push(
        // allow-any-unicode-next-line
        '## 🖥️ macOS Installation', '', 'Download the DMG file for your architecture:', ...macOSDownloads, '', 'Open the DMG and drag Unbroken Code to your Applications folder.', '', 
        // allow-any-unicode-next-line
        '### 💡 Recommended: Disable Font Smoothing for Pixel-Perfect Rendering', 'For the best experience with Unbroken Code\'s crisp font rendering, disable font smoothing:', '', '```bash', 'defaults -currentHost write -g AppleFontSmoothing -int 0', '```', '', 'To re-enable: `defaults -currentHost delete -g AppleFontSmoothing`', '', '**Why?** Apple\'s font smoothing makes text appear bold and blurry. [Learn more](https://tonsky.me/blog/monitors/#turn-off-font-smoothing)', '');
    }
    if (hasManifestWindowsBuilds) {
        const windowsZips = [];
        // Find available Windows assets from update manifest
        const manifestAssetKeys = Object.keys(updateManifest.assets);
        // Extract filenames from update manifest URLs
        const getFilenameFromUrl = (url) => url.split('/').pop() || '';
        // Find ZIP assets
        const x64ZipAsset = manifestAssetKeys.find(key => key === 'win32-x64');
        const arm64ZipAsset = manifestAssetKeys.find(key => key === 'win32-arm64');
        // Find setup assets
        const x64UserSetupAsset = manifestAssetKeys.find(key => key === 'win32-x64-user-setup');
        const x64SystemSetupAsset = manifestAssetKeys.find(key => key === 'win32-x64-system-setup');
        const arm64UserSetupAsset = manifestAssetKeys.find(key => key === 'win32-arm64-user-setup');
        const arm64SystemSetupAsset = manifestAssetKeys.find(key => key === 'win32-arm64-system-setup');
        // User installers
        const userInstallers = [];
        if (x64UserSetupAsset) {
            const filename = getFilenameFromUrl(updateManifest.assets[x64UserSetupAsset].url);
            const cliLink = getCliDownloadLink('win32', 'x64');
            userInstallers.push(`- **x64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        if (arm64UserSetupAsset) {
            const filename = getFilenameFromUrl(updateManifest.assets[arm64UserSetupAsset].url);
            const cliLink = getCliDownloadLink('win32', 'arm64');
            userInstallers.push(`- **ARM64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        // System installers
        const systemInstallers = [];
        if (x64SystemSetupAsset) {
            const filename = getFilenameFromUrl(updateManifest.assets[x64SystemSetupAsset].url);
            const cliLink = getCliDownloadLink('win32', 'x64');
            systemInstallers.push(`- **x64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        if (arm64SystemSetupAsset) {
            const filename = getFilenameFromUrl(updateManifest.assets[arm64SystemSetupAsset].url);
            const cliLink = getCliDownloadLink('win32', 'arm64');
            systemInstallers.push(`- **ARM64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        // Portable ZIPs
        if (x64ZipAsset) {
            const filename = getFilenameFromUrl(updateManifest.assets[x64ZipAsset].url);
            const cliLink = getCliDownloadLink('win32', 'x64');
            windowsZips.push(`- **x64 Portable**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        if (arm64ZipAsset) {
            const filename = getFilenameFromUrl(updateManifest.assets[arm64ZipAsset].url);
            const cliLink = getCliDownloadLink('win32', 'arm64');
            windowsZips.push(`- **ARM64 Portable**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
        }
        const installSections = [
            '',
            // allow-any-unicode-next-line
            '## 💻 Windows Installation',
            '',
            'Choose your installation method:'
        ];
        // Add user installer section if available
        if (userInstallers.length > 0) {
            installSections.push('', 
            // allow-any-unicode-next-line
            '### 👤 User Install (Recommended)', 'No admin privileges required. Installs only for the current user.', ...userInstallers);
        }
        // Add system installer section if available
        if (systemInstallers.length > 0) {
            installSections.push('', 
            // allow-any-unicode-next-line
            '### 🔧 System Install', 'Requires administrator privileges. Installs for all users on the system.', ...systemInstallers);
        }
        // Add portable section if available
        if (windowsZips.length > 0) {
            installSections.push('', 
            // allow-any-unicode-next-line
            '### 📁 Portable ZIP', 'No installation required. Extract and run directly.', ...windowsZips, '', 'Extract the ZIP and run `Code.exe` from the extracted folder.');
        }
        installSections.push('');
        releaseBodyParts.push(...installSections);
    }
    if (hasManifestLinuxBuilds) {
        const linuxSections = [
            '',
            // allow-any-unicode-next-line
            '## 🐧 Linux Installation',
            '',
            'Choose your installation method:'
        ];
        // Find available Linux assets from update manifest
        const manifestAssetKeys = Object.keys(updateManifest.assets);
        // Extract filenames from update manifest URLs
        const getFilenameFromUrl = (url) => url.split('/').pop() || '';
        // Check for .deb packages
        const x64DebAsset = manifestAssetKeys.find(key => key === 'linux-x64-deb');
        const arm64DebAsset = manifestAssetKeys.find(key => key === 'linux-arm64-deb');
        if (x64DebAsset || arm64DebAsset) {
            linuxSections.push('', 
            // allow-any-unicode-next-line
            '### 📦 Debian/Ubuntu (.deb)', 'For Debian, Ubuntu, and derivatives:');
            if (x64DebAsset) {
                const filename = getFilenameFromUrl(updateManifest.assets[x64DebAsset].url);
                const cliLink = getCliDownloadLink('linux', 'x64');
                linuxSections.push(`- **x64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
            }
            if (arm64DebAsset) {
                const filename = getFilenameFromUrl(updateManifest.assets[arm64DebAsset].url);
                const cliLink = getCliDownloadLink('linux', 'arm64');
                linuxSections.push(`- **ARM64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
            }
            linuxSections.push('', 'Install with: `sudo dpkg -i UnbrokenCode-linux-*.deb`');
        }
        // Check for .rpm packages
        const x64RpmAsset = manifestAssetKeys.find(key => key === 'linux-x64-rpm');
        const arm64RpmAsset = manifestAssetKeys.find(key => key === 'linux-arm64-rpm');
        if (x64RpmAsset || arm64RpmAsset) {
            linuxSections.push('', 
            // allow-any-unicode-next-line
            '### 📦 RedHat/Fedora (.rpm)', 'For RedHat, Fedora, SUSE, and derivatives:');
            if (x64RpmAsset) {
                const filename = getFilenameFromUrl(updateManifest.assets[x64RpmAsset].url);
                const cliLink = getCliDownloadLink('linux', 'x64');
                linuxSections.push(`- **x64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
            }
            if (arm64RpmAsset) {
                const filename = getFilenameFromUrl(updateManifest.assets[arm64RpmAsset].url);
                const cliLink = getCliDownloadLink('linux', 'arm64');
                linuxSections.push(`- **ARM64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
            }
            linuxSections.push('', 'Install with: `sudo rpm -i UnbrokenCode-linux-*.rpm`');
        }
        // Check for tar.gz archives
        const x64TarAsset = manifestAssetKeys.find(key => key === 'linux-x64');
        const arm64TarAsset = manifestAssetKeys.find(key => key === 'linux-arm64');
        if (x64TarAsset || arm64TarAsset) {
            linuxSections.push('', 
            // allow-any-unicode-next-line
            '### 📁 Universal Archive (.tar.gz)', 'For any Linux distribution:');
            if (x64TarAsset) {
                const filename = getFilenameFromUrl(updateManifest.assets[x64TarAsset].url);
                const cliLink = getCliDownloadLink('linux', 'x64');
                linuxSections.push(`- **x64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
            }
            if (arm64TarAsset) {
                const filename = getFilenameFromUrl(updateManifest.assets[arm64TarAsset].url);
                const cliLink = getCliDownloadLink('linux', 'arm64');
                linuxSections.push(`- **ARM64**: [${filename}](${generateDownloadLink(filename)})${cliLink}`);
            }
            linuxSections.push('', 'Extract with: `tar -xzf UnbrokenCode-linux-*.tar.gz`', 'Run with: `./UnbrokenCode-linux-*/bin/code`');
        }
        linuxSections.push('');
        releaseBodyParts.push(...linuxSections);
    }
    releaseBodyParts.push(
    // allow-any-unicode-next-line
    '## 🔄 Auto-Update', 'This release supports automatic updates. Once installed, Unbroken Code will check for updates automatically.');
    const releaseBody = releaseBodyParts.join('\n');
    // Check for command line flags
    // Always create as draft first to upload all artifacts before it's visible
    const release = await createGitHubRelease(octokit, tagName, `${product.nameLong} ${version}`, releaseBody, builtCommit, true // Always create as draft initially
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
        }
        catch (error) {
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
    }
    catch (error) {
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
//# sourceMappingURL=create-github-release.js.map