# Unbroken Code Versioning Scheme

## Overview

Unbroken Code uses a three-part semantic versioning scheme: `MAJOR.MINOR.PATCH`

- **MAJOR.MINOR**: Inherited from upstream VS Code (e.g., 1.104)
- **PATCH**: Unbroken Code release number (increments with each release)

## Version Management

### Files

- `package.json`: Contains the full version (e.g., `1.104.1`)
- `unbroken.version`: Tracks only the patch number (e.g., `1`)

### Updating Version

To create a new release version:

```bash
./build-unbroken-code.sh --new-version
```

This command will:
1. Read the current patch version from `unbroken.version`
2. Increment the patch version by 1
3. Update `package.json` with the new version
4. Save the new patch version to `unbroken.version`
5. Run `npm install` to update `package-lock.json` and other dependency files

### After Rebasing on Upstream

When rebasing on a new upstream VS Code version:
1. The MAJOR.MINOR version will automatically update from upstream
2. The PATCH version in `unbroken.version` is preserved
3. Run `./build-unbroken-code.sh --new-version` to apply the patch version to the new base version

### Example Workflow

1. Current version: `1.104.1` (upstream 1.104, Unbroken patch 1)
2. Rebase on upstream `1.105.0`
3. Run `./build-unbroken-code.sh --new-version`
4. New version: `1.105.2` (upstream 1.105, Unbroken patch 2)

## Release Process

### Quick Release (Recommended)

One command to update version, build, and create a draft release:
```bash
./build-unbroken-code.sh --new-version --release
```

Then commit the version change:
```bash
git add package.json package-lock.json unbroken.version
git commit -m "Version bump to X.Y.Z"
git push
```

### Manual Step-by-Step

1. Update version:
   ```bash
   ./build-unbroken-code.sh --new-version
   ```

2. Commit the version change:
   ```bash
   git add package.json package-lock.json unbroken.version
   git commit -m "Version bump to X.Y.Z"
   ```

3. Build and create release:
   ```bash
   ./build-unbroken-code.sh --release
   ```

### Build Script Options

- `--new-version`: Increment the patch version
- `--release`: Create a draft GitHub release after building
- `--publish`: Create and immediately publish the release (non-draft)
- `--skip-build`: Skip the build process (use with --release for existing builds)
- `--help`: Show usage information

### Common Workflows

```bash
# Build only
./build-unbroken-code.sh

# Update version only
./build-unbroken-code.sh --new-version

# Full release cycle (version, build, draft release)
./build-unbroken-code.sh --new-version --release

# Build and publish release immediately
./build-unbroken-code.sh --release --publish

# Create release from existing build
./build-unbroken-code.sh --skip-build --release
```

## Benefits

- **Preserves upstream compatibility**: Users can easily identify the base VS Code version
- **Independent release cadence**: Unbroken Code can release updates without waiting for upstream
- **Survives rebases**: The patch version persists across upstream updates
- **Clear version history**: Each Unbroken Code release has a unique version number