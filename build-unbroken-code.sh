#!/usr/bin/env bash

set -euo pipefail

# Parse command line arguments
NEW_VERSION=false
CREATE_RELEASE=false
PUBLISH_RELEASE=false
SKIP_BUILD=false
REGENERATE_DMG=false

for arg in "$@"; do
	case $arg in
		--new-version)
			NEW_VERSION=true
			shift
			;;
		--release)
			CREATE_RELEASE=true
			shift
			;;
		--publish)
			PUBLISH_RELEASE=true
			CREATE_RELEASE=true
			shift
			;;
		--skip-build)
			SKIP_BUILD=true
			shift
			;;
		--regenerate-dmg)
			REGENERATE_DMG=true
			shift
			;;
		--help)
			echo "Usage: $0 [OPTIONS]"
			echo ""
			echo "Options:"
			echo "  --new-version    Increment version number before building"
			echo "  --release        Create GitHub release (draft) after building"
			echo "  --publish        Create and publish GitHub release (non-draft)"
			echo "  --skip-build     Skip the build process (only for --release)"
			echo "  --regenerate-dmg Force regeneration of DMG files even if they exist"
			echo "  --help           Show this help message"
			echo ""
			echo "Examples:"
			echo "  $0                           # Build only"
			echo "  $0 --new-version             # Update version only"
			echo "  $0 --new-version --release   # Update version, build, and create draft release"
			echo "  $0 --release --publish       # Build and create published release"
			echo "  $0 --skip-build --release    # Create release from existing build"
			echo "  $0 --regenerate-dmg --release # Regenerate DMG files and create release"
			exit 0
			;;
		*)
			echo "Unknown option: $arg"
			echo "Use --help for usage information"
			exit 1
			;;
	esac
done

# Function to update version
function Update_Version()
{
	echo "Updating Unbroken Code version..."
	
	# Read current patch version from unbroken.version
	if [ -f "unbroken.version" ]; then
		PATCH_VERSION=$(cat unbroken.version)
	else
		PATCH_VERSION=0
	fi
	
	# Increment patch version
	PATCH_VERSION=$((PATCH_VERSION + 1))
	
	# Save new patch version
	echo $PATCH_VERSION > unbroken.version
	
	# Get major.minor from package.json
	CURRENT_VERSION=$(node -p "require('./package.json').version")
	MAJOR_MINOR=$(echo $CURRENT_VERSION | cut -d. -f1,2)
	
	# Create new version string
	NEW_VERSION_STRING="${MAJOR_MINOR}.${PATCH_VERSION}"
	
	echo "Updating version from $CURRENT_VERSION to $NEW_VERSION_STRING"
	
	# Update package.json
	node -e "
		const fs = require('fs');
		const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
		pkg.version = '${NEW_VERSION_STRING}';
		fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
	"
	
	# Run npm install to update package-lock.json and other files
	echo "Running npm install to update dependency files..."
	npm install
	
	echo "Version updated to $NEW_VERSION_STRING"
	echo "Patch version $PATCH_VERSION saved to unbroken.version"
	
	# Commit the version change
	echo ""
	echo "To commit the version change, run:"
	echo "  git add package.json package-lock.json unbroken.version"
	echo "  git commit -m \"Version bump to $NEW_VERSION_STRING\""
}

# Function to create GitHub release
function Create_GitHub_Release()
{
	echo ""
	echo "Creating GitHub release..."
	
	# Get GitHub token from git credentials if not already set
	if [ -z "${GITHUB_TOKEN:-}" ]; then
		GITHUB_TOKEN=$(echo "url=https://github.com" | git credential fill | grep "^password=" | cut -d= -f2)
		if [ -n "$GITHUB_TOKEN" ]; then
			export GITHUB_TOKEN
			echo "Using GitHub token from git credentials"
		fi
	fi
	
	# Build command with options
	RELEASE_CMD="node build/release/create-github-release.js"
	
	if $PUBLISH_RELEASE; then
		RELEASE_CMD="$RELEASE_CMD --publish"
	fi
	
	if $REGENERATE_DMG; then
		RELEASE_CMD="$RELEASE_CMD --regenerate-dmg"
	fi
	
	# Check if release should be published or draft
	if $PUBLISH_RELEASE; then
		echo "Creating PUBLISHED release..."
	else
		echo "Creating DRAFT release..."
	fi
	
	if $REGENERATE_DMG; then
		echo "Will regenerate DMG files..."
	fi
	
	# Execute the release command
	$RELEASE_CMD
	
	if [ $? -eq 0 ]; then
		echo "GitHub release created successfully!"
	else
		echo "Failed to create GitHub release"
		exit 1
	fi
}

# If only --new-version flag is set (without --release), just update version and exit
if $NEW_VERSION && ! $CREATE_RELEASE; then
	Update_Version
	exit 0
fi

# If --new-version is set with other flags, update version first
if $NEW_VERSION; then
	Update_Version
	echo ""
	echo "Continuing with build process..."
	echo ""
fi

# 1) Load NVM (handles common install locations)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then # macOS (Apple Silicon via Homebrew)
	export NVM_DIR="${NVM_DIR:-/opt/homebrew/opt/nvm}"
	. "/opt/homebrew/opt/nvm/nvm.sh"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then     # macOS (Intel via Homebrew)
	export NVM_DIR="${NVM_DIR:-/usr/local/opt/nvm}"
	. "/usr/local/opt/nvm/nvm.sh"
else
	echo "nvm not found. Ensure NVM is installed and NVM_DIR is set." >&2
	exit 1
fi

# 2) Respect .nvmrc (nearest one in the directory tree)
#    - Installs the version if needed (no output unless errors)
#    - Uses 'default' if no .nvmrc is found
if nvmrc_path="$(nvm_find_nvmrc)"; then
	# Install (if missing) and use the version from .nvmrc
	nvm install --no-progress
	nvm use
else
	# No .nvmrc here; use your default if set
	nvm use default || true
fi

echo "Using Node $(node -v) at $(command -v node)"

# Set a common build date for all architectures
export VSCODE_BUILD_DATE=$(node -e "console.log(new Date().toISOString())")
echo "Using build date: $VSCODE_BUILD_DATE"

export VSCODE_QUALITY=stable

function Build_macOS()
{
	DO_BUILD=true
	DO_SIGN=true
	DO_NOTARIZE=true

	which npm
	which node

	# Create .dist directory in current directory
	DIST_DIR="$PWD/.dist"
	mkdir -p "$DIST_DIR"
	echo "Using distribution directory: $DIST_DIR"

	# Build both architectures with the same date
	if $DO_BUILD; then
		# Set environment variable to build directly to .dist directory
		export VSCODE_BUILD_OUTPUT_DIR="$DIST_DIR"
		
		npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm ci --cpu arm64
		npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm run gulp vscode-darwin-arm64

		npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm ci --cpu x64
		npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm run gulp vscode-darwin-x64

		rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Makefile"
		rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/config.gypi"
		rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Release/obj.target"
		rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/binding.Makefile"
		rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/gyp-mac-tool"

		rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Makefile"
		rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/config.gypi"
		rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Release/obj.target"
		rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/binding.Makefile"
		rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/gyp-mac-tool"

		cp -r "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode/vsce-sign-darwin-arm64" "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode"
		cp -r "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode/vsce-sign-darwin-x64" "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode"

		DEBUG="*" VSCODE_ARCH=universal node build/darwin/create-universal-app.js "$DIST_DIR"
	fi

	export AGENT_TEMPDIRECTORY=`mktemp -d`
	echo "AGENT_TEMPDIRECTORY: $AGENT_TEMPDIRECTORY"

	export CODESIGN_IDENTITY="E9944AF714BFA859585C2217AF833B286AB09E31"

	# Set the keychain profile for notarization
	export APPLE_KEYCHAIN_PROFILE="Unbroken Notary"

	# Sign all architectures
	if $DO_SIGN; then
		VSCODE_ARCH=arm64 node build/darwin/sign.js "$DIST_DIR" &
		VSCODE_ARCH=x64 node build/darwin/sign.js "$DIST_DIR" &
		VSCODE_ARCH=universal node build/darwin/sign.js "$DIST_DIR" &
		wait
	fi

	# Notarize and staple all architectures
	if $DO_NOTARIZE; then
		echo "Starting notarization process..."
		VSCODE_ARCH=arm64 node build/darwin/notarize.js "$DIST_DIR" &
		VSCODE_ARCH=x64 node build/darwin/notarize.js "$DIST_DIR" &
		VSCODE_ARCH=universal node build/darwin/notarize.js "$DIST_DIR" &

		wait
	fi
}

# Skip build if --skip-build flag is set
if ! $SKIP_BUILD; then
	Build_macOS &
	wait
	echo ""
	echo "Build completed successfully!"
else
	echo "Skipping build process (--skip-build flag set)"
fi

# Create GitHub release if --release flag is set
if $CREATE_RELEASE; then
	Create_GitHub_Release
fi

echo ""
echo "All tasks completed successfully!"