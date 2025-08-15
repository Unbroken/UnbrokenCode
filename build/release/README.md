# Release Scripts

This directory contains scripts for managing Unbroken Code releases on GitHub.

## Scripts

### create-github-release.ts
Creates a GitHub release with all platform assets (DMG, ZIP files).

**Usage:**
```bash
# Create a draft release
node build/release/create-github-release.js

# Create and publish immediately
node build/release/create-github-release.js --publish
```

**Features:**
- Reads version from built product.json files
- Verifies all architectures have the same version
- Creates DMG and ZIP files for distribution
- Uploads all assets to GitHub
- Automatically updates the release feed

### update-feed-generator.ts
Generates and maintains update feeds for automatic updates.

**Usage:**
```bash
# Generate and upload feed
node build/release/update-feed-generator.js generate

# Test platform-specific feed
node build/release/update-feed-generator.js platform darwin-universal stable

# Get feed URL
node build/release/update-feed-generator.js url
```

**Generated Files:**
- `updates-feed.json` - Main feed with all platforms and versions
- `latest-darwin-{arch}.json` - Squirrel.Mac format for macOS
- `latest-{platform}.json` - IUpdate format for Linux/Windows

## Integration

These scripts are integrated with the main build script:

```bash
# Full release cycle (version, build, create release)
./build-unbroken-code.sh --new-version --release

# Just create release from existing build
./build-unbroken-code.sh --skip-build --release
```

## Requirements

- Node.js and npm
- GitHub personal access token (set as GITHUB_TOKEN environment variable)
- Built applications in `.dist` directory

## Feed URLs

- Main feed: `https://github.com/Unbroken/UnbrokenCode/releases/download/update-feed/updates-feed.json`
- Platform feeds: `https://github.com/Unbroken/UnbrokenCode/releases/download/update-feed/latest-{platform}.json`