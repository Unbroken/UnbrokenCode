# Unbroken Code Auto-Update System

## Current Status

✅ **Auto-update system is fully implemented and ready for use.**

The auto-update infrastructure has been successfully modified to work with static GitHub releases feeds. All necessary components are in place and functional.

## What's Implemented

### 1. Release Creation
- Automated release creation with `./build-unbroken-code.sh --release`
- Creates DMG and ZIP files for all architectures (arm64, x64)
- Generates update manifest with version info and SHA256 hashes

### 2. Update Feed Generation
- Static JSON feeds hosted on GitHub releases
- Platform manifests: `https://github.com/Unbroken/UnbrokenCode/releases/download/update-feed/latest-{platform}.json`
- Squirrel.Mac compatible feeds for each platform

### 3. Feed Structure
The feed generator creates platform-specific feeds:

#### macOS (Squirrel.Mac format)
Files: `latest-darwin-{arm64|x64}.json`

Universal builds are deprecated. `latest-darwin-universal.json` stays frozen on `1.144.66`, the last Universal release, which must be kept. Older installs read that feed, update to `1.144.66`, and from there to the build for their architecture.
```json
{
  "currentRelease": "1.104.1",
  "releases": [
    {
      "version": "1.104.1",
      "updateTo": {
        "version": "1.104.1",
        "name": "1.104.1",
        "notes": "Update to Unbroken Code 1.104.1",
        "pub_date": "2025-01-15T12:00:00Z",
        "url": "https://github.com/.../UnbrokenCode-darwin-arm64-1.104.1.zip"
      }
    }
  ]
}
```

#### Linux/Windows (IUpdate format)
Files: `latest-{linux-x64|linux-arm64|win32-x64|win32-arm64}.json`
```json
{
  "version": "abc123...",  // Commit hash
  "productVersion": "1.104.1",
  "timestamp": 1736950000000,
  "url": "https://github.com/.../UnbrokenCode-linux-x64-1.104.1.tar.gz",
  "sha256hash": "...",
  "size": 123456789,
  "supportsFastUpdate": true,
  "quality": "stable"
}
```

#### Release notes
File: `release-notes.json`, attached to each release

Publishing a release attaches the "What's New" lists of the release and the 9 releases before it, read from the release descriptions. A stable release has only the stable releases before it; a pre-release also has pre-releases. To attach it to a published release by hand: `node build/release/update-feed-generator.ts release-notes [tag]`, which defaults to the latest release.

The app downloads the file of the version it needs in the main process, once per session. It falls back to the file of the latest release (`releases/latest/download/release-notes.json`) when that version's release has none, such as for builds that aren't released. It shows the release notes in an editor:
- After an update, everything since the version it was updated from.
- Before an update, from the Release Notes button of the update indicator in the title bar or Show Update Release Notes in the Manage menu, what the update brings.
- From Help → Show Release Notes, the running version.

Each page also shows the earlier releases in the file, and links to all releases on GitHub.

Builds from sources aren't released, so to see the release notes of the version being built, run `./build-unbroken-code.sh --show-release-notes`. Besides printing the "What's New" list, it writes it to `.build/release-notes.json`, which builds from sources show for their version, with the releases before it from the latest release. They are the notes of the release being prepared, so a simulated update to a newer version that isn't released shows them as that update's.

To see the update UI and the release notes of an update without one, run **Developer: Simulate Update...**, which puts the update indicator in the title bar, its tooltip and the Manage menu in the state of an update you pick, such as Available for Download or Ready to Restart, for a version you enter. Its actions do nothing while simulating; **Stop Simulating** goes back to the real state.

Release notes open by themselves only at the first start after the version goes up, which builds from sources usually don't have, since a profile that has run the version before doesn't count as an update. To see them as they are after an update, run **Developer: Simulate Restart After Update...** and enter the version to have updated from.
```json
{
  "releasesUrl": "https://github.com/Unbroken/UnbrokenCode/releases",
  "releases": [
    {
      "version": "1.146.71",
      "date": "2026-11-17T19:34:54Z",
      "prerelease": false,
      "url": "https://github.com/Unbroken/UnbrokenCode/releases/tag/release/1.146.71",
      "notes": ["Show the code in the messages of the Problems view in the code font"]
    }
  ]
}
```

## How It Works

### Update URL Configuration
The `product.json` contains:
```json
"updateUrl": "https://github.com/Unbroken/UnbrokenCode/releases/download/update-feed"
```

The updater reads the platform-specific manifests (for example `latest-darwin-arm64.json`, `latest-linux-x64.json`) hosted in the `update-feed` release.

### Modified Update Service
We've modified VS Code's `createUpdateURL` function in `abstractUpdateService.ts` to generate correct URLs for our static feeds:

#### All Platforms
- URL pattern: `https://github.com/Unbroken/UnbrokenCode/releases/download/update-feed/latest-{platform}.json`
- macOS: `latest-darwin-{arm64|x64}.json` (Squirrel.Mac format)
- Linux: `latest-linux-{x64|arm64|armhf}.json` (IUpdate format)
- Windows: `latest-win32-{x64|arm64}.json` (IUpdate format)
- Format: VS Code IUpdate JSON (with version, url, sha256hash, etc.)
- Compatible with VS Code's update mechanism

## How Auto-Updates Work Now

### No Additional Services Required
The update system now works directly with static GitHub releases feeds. The modified `createUpdateURL` function generates the correct feed URLs without requiring any redirect service or proxy.

### Update Check Process
1. **Automatic Checks**: VS Code checks for updates periodically (every hour by default)
2. **Manual Checks**: Users can check via Help → Check for Updates
3. **Feed Request**: The app requests the appropriate platform-specific feed from GitHub
4. **Version Comparison**: If a newer version is available, the update is downloaded
5. **Installation**: User is prompted to restart to apply the update

## Testing Auto-Updates

Once the redirect service is set up:

1. Build a version with incremented patch number:
```bash
./build-unbroken-code.sh --new-version --release
```

2. Update the feed:
```bash
node build/release/update-feed-generator.js generate
```

3. Test in an older version:
- Open Unbroken Code
- Help → Check for Updates
- Should detect and download the new version

## Implementation Status

✅ Version management system
✅ Build automation
✅ Release creation
✅ Feed generation
✅ Squirrel.Mac compatible JSON
✅ Modified update service to use static feeds
✅ Cross-platform feed format support
✅ Automatic feed updates on release

## Usage Instructions

### For Release Managers

1. **Create a New Release**:
```bash
# Increment version, build all platforms, create release
./build-unbroken-code.sh --new-version --release

# Or just create release from existing build
./build-unbroken-code.sh --skip-build --release
```

2. **Update Feed** (happens automatically with --release):
```bash
# Manual feed update if needed
node build/release/update-feed-generator.js generate
```

### For Users

Auto-updates work automatically! The app will:
- Check for updates periodically
- Download updates in the background
- Prompt to restart when ready

Users can also manually check: **Help → Check for Updates**

## Troubleshooting

### If Updates Aren't Detected
1. Verify the feed exists: https://github.com/Unbroken/UnbrokenCode/releases/download/update-feed/latest-darwin-arm64.json
2. Check update settings: Preferences → Settings → Update Mode
3. Look for errors in: Help → Toggle Developer Tools → Console

### Update Settings
Users can control update behavior in settings:
- `"update.mode": "default"` - Check and download automatically
- `"update.mode": "start"` - Check on startup only
- `"update.mode": "manual"` - Only check when requested
- `"update.mode": "none"` - Disable updates
