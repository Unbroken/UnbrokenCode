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
const PLATFORM_MANIFEST_FILENAMES = {
    'windows-x64': 'manifest-windows-x64.json',
    'windows-arm64': 'manifest-windows-arm64.json',
    'linux-x64': 'manifest-linux-x64.json',
    'linux-arm64': 'manifest-linux-arm64.json',
    'macos-x64': 'manifest-macos-x64.json',
    'macos-arm64': 'manifest-macos-arm64.json',
    'macos-universal': 'manifest-macos-universal.json'
};
const PLATFORM_FROM_KEY = {
    'windows-x64': 'windows',
    'windows-arm64': 'windows',
    'linux-x64': 'linux',
    'linux-arm64': 'linux',
    'macos-x64': 'macos',
    'macos-arm64': 'macos',
    'macos-universal': 'macos'
};
const ARCH_FROM_KEY = {
    'windows-x64': 'x64',
    'windows-arm64': 'arm64',
    'linux-x64': 'x64',
    'linux-arm64': 'arm64',
    'macos-x64': 'x64',
    'macos-arm64': 'arm64',
    'macos-universal': 'universal'
};
function getProductInfo() {
    const productPath = path.join(__dirname, '../../product.json');
    return JSON.parse(fs.readFileSync(productPath, 'utf8'));
}
function getPackageInfo() {
    const packagePath = path.join(__dirname, '../../package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
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
        (0, child_process_1.execSync)('git fetch origin --tags --prune --prune-tags --force', { stdio: 'pipe' });
        const output = (0, child_process_1.execSync)('git tag -l "release/*"', { encoding: 'utf8' }).trim();
        const tags = output ? output.split('\n') : [];
        debugLog('Found release tags:', tags);
        return tags;
    }
    catch (error) {
        console.warn(`Warning: Could not get release tags from git: ${error}`);
        throw error;
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
function getManifestFilenameFromKey(key) {
    return PLATFORM_MANIFEST_FILENAMES[key];
}
function manifestKeyFromFilename(filename) {
    for (const [key, value] of Object.entries(PLATFORM_MANIFEST_FILENAMES)) {
        if (value === filename) {
            return key;
        }
    }
    return null;
}
function manifestKeyFromPlatform(platform, arch) {
    const key = `${platform}-${arch}`;
    if (!PLATFORM_MANIFEST_FILENAMES[key]) {
        throw new Error(`Unsupported platform/arch combination: ${platform}-${arch}`);
    }
    return key;
}
function ensureManifestConsistency(map) {
    const versions = new Set();
    const commits = new Set();
    for (const manifest of map.values()) {
        versions.add(manifest.version);
        if (manifest.commit) {
            commits.add(manifest.commit);
        }
    }
    if (versions.size !== 1) {
        throw new Error(`Manifest versions are inconsistent: ${Array.from(versions).join(', ')}`);
    }
    const commit = commits.size === 1 ? Array.from(commits)[0] : '';
    return { version: Array.from(versions)[0], commit };
}
function makeAssetEntry(tagName, fileName, filePath, supportsFastUpdate) {
    return {
        url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tagName}/${fileName}`,
        sha256hash: getFileHash(filePath),
        size: getFileSize(filePath),
        supportsFastUpdate
    };
}
function resolveManifestTimestamp(metadata, fallbackTimestamp) {
    if (metadata && metadata.date) {
        const parsed = new Date(metadata.date);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.getTime();
        }
    }
    return fallbackTimestamp;
}
function combineManifests(map) {
    if (map.size === 0) {
        return null;
    }
    let reference = null;
    const combinedAssets = {};
    let maxTimestamp = 0;
    for (const manifest of map.values()) {
        if (!reference) {
            reference = manifest;
        }
        if (manifest.timestamp > maxTimestamp) {
            maxTimestamp = manifest.timestamp;
        }
        for (const [key, value] of Object.entries(manifest.assets)) {
            const compositeKey = `${manifest.platform}-${manifest.arch}-${key}`;
            combinedAssets[compositeKey] = value;
        }
    }
    if (!reference) {
        return null;
    }
    return {
        version: reference.version,
        productVersion: reference.productVersion,
        commit: reference.commit,
        quality: reference.quality,
        timestamp: maxTimestamp || reference.timestamp,
        assets: sortAssetKeys(combinedAssets)
    };
}
function writeManifestToDist(manifest, distDir) {
    const key = manifestKeyFromPlatform(manifest.platform, manifest.arch);
    const filename = getManifestFilenameFromKey(key);
    const manifestPath = path.join(distDir, filename);
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, assets: sortAssetKeys(manifest.assets) }, null, 2));
    return {
        path: manifestPath,
        asset: {
            name: filename,
            path: manifestPath,
            contentType: 'application/json'
        }
    };
}
async function downloadManifestAsset(octokit, assetId, filename) {
    const { data } = await octokit.repos.getReleaseAsset({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        asset_id: assetId,
        headers: { Accept: 'application/octet-stream' }
    });
    let content;
    if (Buffer.isBuffer(data)) {
        content = data.toString('utf8');
    }
    else if (data instanceof ArrayBuffer) {
        content = Buffer.from(data).toString('utf8');
    }
    else if (typeof data === 'string') {
        content = data;
    }
    else {
        content = JSON.stringify(data);
    }
    const parsed = JSON.parse(content);
    const key = manifestKeyFromFilename(filename);
    if (key) {
        parsed.platform = PLATFORM_FROM_KEY[key];
        parsed.arch = ARCH_FROM_KEY[key];
    }
    parsed.assets = sortAssetKeys(parsed.assets);
    return parsed;
}
async function fetchManifestsFromRelease(octokit, release) {
    const map = new Map();
    if (!release?.assets) {
        return map;
    }
    for (const asset of release.assets) {
        if (!asset?.name?.startsWith('manifest-') || !asset.name.endsWith('.json')) {
            continue;
        }
        const key = manifestKeyFromFilename(asset.name);
        if (!key) {
            continue;
        }
        try {
            const manifest = await downloadManifestAsset(octokit, asset.id, asset.name);
            map.set(key, manifest);
        }
        catch (error) {
            console.warn(`Failed to download manifest ${asset.name}:`, error);
        }
    }
    return map;
}
async function publishExistingRelease(octokit, release, manifestMap, draft, releaseBody) {
    const combinedManifest = combineManifests(manifestMap);
    const tagName = release.tag_name;
    const commit = combinedManifest?.commit || release.target_commitish;
    if (!commit) {
        throw new Error('Unable to determine commit for release notes');
    }
    await octokit.repos.updateRelease({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        release_id: release.id,
        tag_name: tagName,
        name: release.name || tagName,
        body: releaseBody,
        draft: draft,
        target_commitish: release.target_commitish || commit
    });
    console.log('Release updated successfully!');
}
function getAssetFilenameFromManifest(manifest, assetKey) {
    if (!manifest) {
        return null;
    }
    const asset = manifest.assets[assetKey];
    if (!asset) {
        return null;
    }
    return asset.url.split('/').pop() || null;
}
function buildReleaseBody(manifestMap, tagName, commit, releaseNotes) {
    const releaseBodyParts = [`Commit: \`${commit}\``];
    if (releaseNotes.length > 0) {
        releaseBodyParts.push('', '## What\'s New', '', ...releaseNotes.map(note => `- ${note}`));
    }
    const generateDownloadLink = (filename) => `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${encodeURIComponent(tagName)}/${filename}`;
    const getFileExtension = (filename) => {
        if (filename.includes('.dmg')) {
            return 'dmg';
        }
        if (filename.includes('.zip')) {
            return 'zip';
        }
        if (filename.includes('.tar.gz')) {
            return 'tar.gz';
        }
        if (filename.includes('.deb')) {
            return 'deb';
        }
        if (filename.includes('.rpm')) {
            return 'rpm';
        }
        if (filename.includes('.exe')) {
            return 'exe';
        }
        return '';
    };
    const createDownloadCell = (filename) => {
        if (!filename) {
            return '';
        }
        const extension = getFileExtension(filename);
        return `[${extension}](${generateDownloadLink(filename)})`;
    };
    const createMultiDownloadCell = (filenames) => {
        const links = filenames
            .filter((f) => !!f)
            .map(f => createDownloadCell(f))
            .filter(link => link !== '');
        return links.join(' ');
    };
    const manifestFor = (platform, arch) => manifestMap.get(manifestKeyFromPlatform(platform, arch));
    const macUniversal = manifestFor('macos', 'universal');
    const macX64 = manifestFor('macos', 'x64');
    const macArm64 = manifestFor('macos', 'arm64');
    const winX64 = manifestFor('windows', 'x64');
    const winArm64 = manifestFor('windows', 'arm64');
    const linuxX64 = manifestFor('linux', 'x64');
    const linuxArm64 = manifestFor('linux', 'arm64');
    const macosAppUniversalDmg = getAssetFilenameFromManifest(macUniversal, 'app-dmg');
    const macosAppUniversalZip = getAssetFilenameFromManifest(macUniversal, 'app-zip');
    const macosAppX64Dmg = getAssetFilenameFromManifest(macX64, 'app-dmg');
    const macosAppX64Zip = getAssetFilenameFromManifest(macX64, 'app-zip');
    const macosAppArm64Dmg = getAssetFilenameFromManifest(macArm64, 'app-dmg');
    const macosAppArm64Zip = getAssetFilenameFromManifest(macArm64, 'app-zip');
    const macosCliUniversal = getAssetFilenameFromManifest(macUniversal, 'cli');
    const macosCliX64 = getAssetFilenameFromManifest(macX64, 'cli');
    const macosCliArm64 = getAssetFilenameFromManifest(macArm64, 'cli');
    const winAppX64Zip = getAssetFilenameFromManifest(winX64, 'app-zip');
    const winAppX64User = getAssetFilenameFromManifest(winX64, 'installer-user');
    const winAppX64System = getAssetFilenameFromManifest(winX64, 'installer-system');
    const winCliX64 = getAssetFilenameFromManifest(winX64, 'cli');
    const winAppArm64Zip = getAssetFilenameFromManifest(winArm64, 'app-zip');
    const winAppArm64User = getAssetFilenameFromManifest(winArm64, 'installer-user');
    const winAppArm64System = getAssetFilenameFromManifest(winArm64, 'installer-system');
    const winCliArm64 = getAssetFilenameFromManifest(winArm64, 'cli');
    const linuxAppX64Tar = getAssetFilenameFromManifest(linuxX64, 'app-tar');
    const linuxAppX64Deb = getAssetFilenameFromManifest(linuxX64, 'deb');
    const linuxAppX64Rpm = getAssetFilenameFromManifest(linuxX64, 'rpm');
    const linuxCliX64 = getAssetFilenameFromManifest(linuxX64, 'cli');
    const linuxAppArm64Tar = getAssetFilenameFromManifest(linuxArm64, 'app-tar');
    const linuxAppArm64Deb = getAssetFilenameFromManifest(linuxArm64, 'deb');
    const linuxAppArm64Rpm = getAssetFilenameFromManifest(linuxArm64, 'rpm');
    const linuxCliArm64 = getAssetFilenameFromManifest(linuxArm64, 'cli');
    const tableHeader = '| Platform | Universal | x64 | arm64 | CLI Universal | CLI x64 | CLI arm64 |';
    const tableDivider = '|----------|-----------|-----|-------|---------------|---------|-----------|';
    const rows = [tableHeader, tableDivider];
    if (macosAppUniversalDmg || macosAppUniversalZip || macosAppX64Dmg || macosAppX64Zip || macosAppArm64Dmg || macosAppArm64Zip || macosCliUniversal || macosCliX64 || macosCliArm64) {
        rows.push(`| **🖥️ macOS** | ${createMultiDownloadCell([macosAppUniversalDmg, macosAppUniversalZip])} | ${createMultiDownloadCell([macosAppX64Dmg, macosAppX64Zip])} | ${createMultiDownloadCell([macosAppArm64Dmg, macosAppArm64Zip])} | ${createDownloadCell(macosCliUniversal)} | ${createDownloadCell(macosCliX64)} | ${createDownloadCell(macosCliArm64)} |`);
    }
    if (winAppX64Zip || winAppX64User || winAppX64System || winAppArm64Zip || winAppArm64User || winAppArm64System || winCliX64 || winCliArm64) {
        rows.push(`| **💻 Windows** | | ${createMultiDownloadCell([winAppX64User, winAppX64System, winAppX64Zip])} | ${createMultiDownloadCell([winAppArm64User, winAppArm64System, winAppArm64Zip])} | | ${createDownloadCell(winCliX64)} | ${createDownloadCell(winCliArm64)} |`);
    }
    if (linuxAppX64Tar || linuxAppX64Deb || linuxAppX64Rpm || linuxAppArm64Tar || linuxAppArm64Deb || linuxAppArm64Rpm || linuxCliX64 || linuxCliArm64) {
        rows.push(`| **🐧 Linux** | | ${createMultiDownloadCell([linuxAppX64Deb, linuxAppX64Rpm, linuxAppX64Tar])} | ${createMultiDownloadCell([linuxAppArm64Deb, linuxAppArm64Rpm, linuxAppArm64Tar])} | | ${createDownloadCell(linuxCliX64)} | ${createDownloadCell(linuxCliArm64)} |`);
    }
    releaseBodyParts.push('', '---', '## Downloads', '', ...rows);
    releaseBodyParts.push('', '## Installation Instructions', '', '### 🖥️ macOS', '- **App**: Download dmg for easy installation or zip for portable use', '- **CLI**: Download CLI package and add to PATH', '', '### 💻 Windows', '- **App**: Download exe for installer or zip for portable use', '- **CLI**: Download CLI package and add to PATH', '', '### 🐧 Linux', '- **Debian/Ubuntu**: Download deb and run `sudo dpkg -i UnbrokenCode-*.deb`', '- **RedHat/Fedora**: Download rpm and run `sudo rpm -i UnbrokenCode-*.rpm`', '- **Other**: Download tar.gz and extract', '- **CLI**: Download CLI package and add to PATH', '', '## 🔄 Auto-Update', 'This release supports automatic updates. Once installed, Unbroken Code will check for updates automatically.');
    return releaseBodyParts.join('\n');
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
function isReleaseAlreadyExistsError(error) {
    if (!error || error.status !== 422) {
        return false;
    }
    const errors = error.response?.data?.errors;
    if (Array.isArray(errors) && errors.some((err) => err?.code === 'already_exists')) {
        return true;
    }
    const message = error.response?.data?.message ?? error.message;
    return typeof message === 'string' && message.toLowerCase().includes('already exists');
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
    const updateExistingRelease = async (releaseToUpdate) => {
        console.log(`Updating existing release...`);
        console.log(`Existing release commit: ${releaseToUpdate.target_commitish}`);
        console.log(`Existing assets count: ${releaseToUpdate.assets?.length || 0}`);
        const updateResult = await octokit.repos.updateRelease({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            release_id: releaseToUpdate.id,
            tag_name: tagName,
            name: releaseName,
            body: body,
            draft: draft,
            prerelease: false,
            target_commitish: targetCommit
        });
        return {
            ...updateResult.data,
            existingAssets: releaseToUpdate.assets || []
        };
    };
    if (existingRelease) {
        release = await updateExistingRelease(existingRelease);
    }
    else {
        // Release doesn't exist, create it
        console.log(`Creating new release: ${tagName}`);
        try {
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
        catch (error) {
            if (isReleaseAlreadyExistsError(error)) {
                console.log(`Release already exists, switching to update path...`);
                const fallbackExistingRelease = await findExistingRelease(octokit, tagName, releaseName);
                if (!fallbackExistingRelease) {
                    console.error(`Release ${tagName} reported as existing but could not be retrieved.`);
                    throw error;
                }
                release = await updateExistingRelease(fallbackExistingRelease);
            }
            else {
                console.error(`Failed to create GitHub release: ${error.message}`);
                throw error;
            }
        }
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
    // Delete outdated assets
    if (assetsToDelete.length > 0) {
        console.log(`Removing ${assetsToDelete.length} changed/removed assets...`);
        for (const asset of assetsToDelete) {
            console.log(`  - Deleting ${asset.name}`);
            await deleteReleaseAssetWithRetry(octokit, asset.id, asset.name);
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
function isRetryableAssetError(error) {
    if (!error) {
        return false;
    }
    const status = error.status;
    if (typeof status === 'number') {
        if (status === 408 || status === 429 || status >= 500) {
            return true;
        }
    }
    const codes = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED']);
    const cause = (error.cause ?? error);
    const causeCode = cause?.code || cause?.errno;
    return typeof causeCode === 'string' && codes.has(causeCode);
}
async function uploadReleaseAsset(octokit, releaseId, asset) {
    const maxAttempts = 4;
    const fileContent = fs.readFileSync(asset.path);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt === 1) {
            console.log(`Uploading ${asset.name}...`);
        }
        else {
            console.log(`Retrying upload of ${asset.name} (attempt ${attempt}/${maxAttempts})...`);
        }
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
            return;
        }
        catch (error) {
            if (error.status === 422 && error.message.includes('already_exists')) {
                console.log(`  ⚠ ${asset.name} already exists, skipping...`);
                return;
            }
            if (attempt === maxAttempts || !isRetryableAssetError(error)) {
                throw error;
            }
            const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            console.log(`  ⚠ Upload failed (attempt ${attempt}/${maxAttempts}): ${error.message ?? error}`);
            console.log(`    Waiting ${delayMs}ms before retrying...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}
async function deleteReleaseAssetWithRetry(octokit, assetId, assetName) {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
            console.log(`    Retrying delete of ${assetName} (attempt ${attempt}/${maxAttempts})...`);
        }
        try {
            await octokit.repos.deleteReleaseAsset({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                asset_id: assetId
            });
            return;
        }
        catch (error) {
            if (attempt === maxAttempts || !isRetryableAssetError(error)) {
                throw error;
            }
            const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            console.log(`    ⚠ Failed to delete ${assetName} (attempt ${attempt}/${maxAttempts}): ${error.message ?? error}`);
            console.log(`      Waiting ${delayMs}ms before retrying...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}
async function main() {
    const shouldPublish = process.argv.includes('--publish');
    const regenerateDMG = process.argv.includes('--regenerate-dmg');
    const generateDescriptionOnly = process.argv.includes('--generate-release-description');
    const distDir = path.join(__dirname, '../../.dist');
    const product = getProductInfo();
    const packageInfo = getPackageInfo();
    const token = getGitHubToken();
    const octokit = new rest_1.Octokit({ auth: token });
    // Determine current version/tag from package.json
    const versionFromPackage = packageInfo.version;
    const tagNameFromVersion = `release/${versionFromPackage}`;
    // Publish-only path: download manifests and publish release without local builds
    if (shouldPublish || generateDescriptionOnly) {
        console.log(`Fetching release ${tagNameFromVersion} for ${shouldPublish ? 'publishing' : 'description generation'}...`);
        const releaseName = `${product.nameLong} ${versionFromPackage}`;
        const existingRelease = await findExistingRelease(octokit, tagNameFromVersion, releaseName);
        if (!existingRelease) {
            console.error(`Release ${tagNameFromVersion} not found`);
            process.exit(1);
        }
        const manifestMap = await fetchManifestsFromRelease(octokit, existingRelease);
        if (manifestMap.size === 0) {
            console.error('No manifests found on release; cannot continue');
            process.exit(1);
        }
        const consistency = ensureManifestConsistency(manifestMap);
        const combinedManifest = combineManifests(manifestMap);
        if (!combinedManifest) {
            console.error('Failed to combine manifests');
            process.exit(1);
        }
        const commitForNotes = combinedManifest.commit || consistency.commit || existingRelease.target_commitish;
        if (!commitForNotes) {
            throw new Error('Unable to determine commit for release notes');
        }
        const releaseNotes = await generateReleaseNotes(commitForNotes, tagNameFromVersion);
        const releaseBody = buildReleaseBody(manifestMap, tagNameFromVersion, commitForNotes, releaseNotes);
        if (!shouldPublish) {
            await publishExistingRelease(octokit, existingRelease, manifestMap, true, releaseBody);
            return;
        }
        await publishExistingRelease(octokit, existingRelease, manifestMap, false, releaseBody);
        // After publishing the release, update the feed
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
        return;
    }
    // Get version from built product.json - this ensures we're releasing what was actually built
    const architectures = ['arm64', 'x64', 'universal'];
    const foundVersions = [];
    const productMetadata = {};
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
                productMetadata[`darwin-${arch}`] = builtProduct;
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
                    productMetadata[`win32-${arch}`] = builtProduct;
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
                    productMetadata[`linux-${arch}`] = builtProduct;
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
    // Prepare release assets and manifests
    const assets = [];
    const quality = 'stable';
    const fallbackTimestamp = Date.now();
    const localManifestMap = new Map();
    const ensureLocalManifest = (platform, arch, metadataKey) => {
        const metadata = productMetadata[metadataKey] || {};
        const key = manifestKeyFromPlatform(platform, arch);
        if (!localManifestMap.has(key)) {
            localManifestMap.set(key, {
                platform,
                arch,
                version,
                productVersion: version,
                commit: builtCommit,
                quality,
                timestamp: resolveManifestTimestamp(metadata, fallbackTimestamp),
                assets: {}
            });
        }
        return localManifestMap.get(key);
    };
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
            const manifest = ensureLocalManifest('macos', arch, `darwin-${arch}`);
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
            manifest.assets['app-dmg'] = makeAssetEntry(tagName, dmgName, dmgPath, false);
            assets.push({
                name: zipName,
                path: zipPath,
                contentType: 'application/zip'
            });
            manifest.assets['app-zip'] = makeAssetEntry(tagName, zipName, zipPath, true);
            const cliPackageName = `unbroken_code_cli_darwin_${arch}_cli.zip`;
            const cliPackagePath = path.join(distDir, cliPackageName);
            if (fs.existsSync(cliPackagePath)) {
                assets.push({
                    name: cliPackageName,
                    path: cliPackagePath,
                    contentType: 'application/zip'
                });
                console.log(`  Added macOS ${arch} CLI package`);
                manifest.assets['cli'] = makeAssetEntry(tagName, cliPackageName, cliPackagePath, false);
            }
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
            ensureLocalManifest('windows', arch, `win32-${arch}`);
            // Create ZIP archive of the Windows build
            const zipName = `UnbrokenCode-win32-${arch}-${version}.zip`;
            const zipPath = path.join(distDir, zipName);
            zipAssets.push({
                name: zipName,
                path: zipPath,
                arch
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
        // Add all zip assets to the main assets array and update manifests
        for (const zipAsset of zipAssets) {
            assets.push({
                name: zipAsset.name,
                path: zipAsset.path,
                contentType: 'application/zip'
            });
            const manifest = ensureLocalManifest('windows', zipAsset.arch, `win32-${zipAsset.arch}`);
            manifest.assets['app-zip'] = makeAssetEntry(tagName, zipAsset.name, zipAsset.path, true);
        }
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
                const manifest = ensureLocalManifest('windows', arch, `win32-${arch}`);
                manifest.assets['cli'] = makeAssetEntry(tagName, cliPackageName, cliPackagePath, false);
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
                        const manifest = ensureLocalManifest('windows', arch, `win32-${arch}`);
                        const manifestKey = target === 'user' ? 'installer-user' : 'installer-system';
                        manifest.assets[manifestKey] = makeAssetEntry(tagName, installerName, destInstallerPath, false);
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
            const manifest = ensureLocalManifest('linux', arch, `linux-${arch}`);
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
                manifest.assets['app-tar'] = makeAssetEntry(tagName, versionedTarGzName, versionedTarGzPath, true);
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
                    manifest.assets['deb'] = makeAssetEntry(tagName, destDebName, destDebPath, false);
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
                    manifest.assets['rpm'] = makeAssetEntry(tagName, destRpmName, destRpmPath, false);
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
                manifest.assets['cli'] = makeAssetEntry(tagName, cliPackageName, cliPackagePath, false);
            }
        }
    }
    // Persist manifests for the platforms built locally
    for (const manifest of localManifestMap.values()) {
        const { asset } = writeManifestToDist(manifest, distDir);
        assets.push(asset);
    }
    // Always create as draft first to upload all artifacts before it's visible
    const release = await createGitHubRelease(octokit, tagName, `${product.nameLong} ${version}`, 'TBD', builtCommit, true);
    // Optimize asset uploads (only upload changed assets)
    console.log('\nOptimizing asset uploads...');
    const assetsToUpload = await optimizeAssetUploads(octokit, release, assets);
    // Upload only the assets that need updating
    for (const asset of assetsToUpload) {
        await uploadReleaseAsset(octokit, release.id, asset);
    }
    console.log('\nRelease preparation complete!');
    console.log(`Release URL: ${release.html_url}`);
    if (!shouldPublish) {
        console.log('\nRelease created as DRAFT. To publish:');
        console.log(`  - Visit ${release.html_url} and click "Publish release"`);
        console.log(`  - Or run: node build/release/create-github-release.js --publish`);
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