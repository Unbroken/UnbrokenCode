# Building Unbroken Code

This document describes how to build Unbroken Code for different platforms.

## Quick Start

The build script automatically detects your platform:

### macOS
```bash
./build-unbroken-code.sh      # Builds macOS binaries
```

### Windows (Git Bash)
```bash
./build-unbroken-code.sh      # Builds Windows binaries
```

## Multi-Platform Release Process

The recommended workflow for creating releases with both macOS and Windows binaries:

### Step 1: Create Release with macOS Builds (macOS machine)

```bash
# Update version and create draft release with macOS builds
./build-unbroken-code.sh --new-version --release
```

This will:
- Increment the version number
- Build macOS binaries (arm64, x64, universal)
- Create DMG and ZIP files
- Create a draft GitHub release
- Upload macOS artifacts
- Create initial `updates.json` manifest

### Step 2: Add Windows Builds (Windows machine with Git Bash)

```bash
# Add Windows builds to the existing draft release
./build-unbroken-code.sh --release
```

This will:
- Build Windows binaries (x64, arm64)
- Create ZIP files and installers
- Download existing `updates.json` and merge Windows entries
- Upload Windows artifacts to the existing draft release
- Preserve all macOS assets

### Step 3: Publish Release (any machine)

```bash
# Publish the complete release
./build-unbroken-code.sh --skip-build --publish
```

This will:
- Publish the draft release (make it public)
- Update the release feed for automatic updates

## Platform-Specific Notes

### macOS Requirements
- Xcode command line tools
- Node.js (version specified in `.nvmrc`)
- Code signing certificate (for distribution)
- Notarization credentials (for distribution)

### Windows Requirements
- Node.js (version specified in `.nvmrc`)
- Visual Studio Build Tools or Visual Studio
- Windows SDK
- InnoSetup (for creating installers)

## Continuous Integration

For automated builds, consider using GitHub Actions:

```yaml
# .github/workflows/build.yml
name: Build
on: [push, pull_request]

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: ./build-unbroken-code.sh --release
      
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: ./build-unbroken-code.sh --windows
      - run: ./build-unbroken-code.sh --upload-artifacts
```

## Troubleshooting

### Cross-compilation Issues
If you encounter native module compilation errors when trying to build Windows binaries on macOS, this is expected. Use the multi-machine approach instead.

### Wine Issues
We previously attempted to use Wine for Windows builds on macOS, but this approach is unreliable. Native Windows builds are recommended.

### Version Synchronization
Ensure all machines are building the same commit:
```bash
git fetch origin
git checkout origin/main
```

### Artifact Upload Failures
If artifact upload fails, ensure:
- You have a valid GitHub token
- The release exists and is in draft state
- The artifacts exist in the `.dist` directory