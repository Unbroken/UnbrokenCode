#!/usr/bin/env bash

set -euo pipefail

# Parse command line arguments
NEW_VERSION=false
CREATE_RELEASE=false
PUBLISH_RELEASE=false
SKIP_BUILD=false
SKIP_GULP_BUILD=false
SKIP_EXTENSIONS=false
EXTENSIONS_ONLY=false
REGENERATE_DMG=false
GENERATE_RELEASE_DESCRIPTION=false
SHOW_RELEASE_NOTES=false
BUILD_WINDOWS=false
BUILD_MACOS=true
BUILD_MACOS_X64=true
BUILD_MACOS_ARM64=true
BUILD_LINUX=false
IGNORE_SUBMODULE_CHECK=false
WINDOWS_BUILD_ARCHES=()
WINDOWS_ENV_INITIALIZED=false
WINDOWS_DIST_INITIALIZED=false
WINDOWS_DIST_DIR=""
WINDOWS_RUST_READY=false
RUST_SETUP_DONE=false
USE_NPM_CI=${USE_NPM_CI:-true}

# Helper to evaluate truthy environment/flag values (accepts 1, true, yes, on)
function is_truthy()
{
	local value="${1:-}"
	value="$(echo "$value" | tr '[:upper:]' '[:lower:]')"
	case "$value" in
		1|true|yes|on)
			return 0
			;;
		*)
			return 1
			;;
	esac
}

function ensure_windows_env()
{
	if $WINDOWS_ENV_INITIALIZED; then
		return 0
	fi

	export PERL=/c/Strawberry/perl/bin/perl.exe
	export OPENSSL_SRC_PERL=/c/Strawberry/perl/bin/perl.exe
	hash -r

	WINDOWS_ENV_INITIALIZED=true
}

function ensure_windows_dist_dir()
{
	if $WINDOWS_DIST_INITIALIZED; then
		return 0
	fi

	WINDOWS_DIST_DIR="$PWD/.dist"
	if ! $SKIP_GULP_BUILD; then
		rm -rf "$WINDOWS_DIST_DIR"
	fi
	mkdir -p "$WINDOWS_DIST_DIR"
	export VSCODE_BUILD_OUTPUT_DIR="$WINDOWS_DIST_DIR"
	echo "Using distribution directory: $WINDOWS_DIST_DIR"
	WINDOWS_DIST_INITIALIZED=true
}

function ensure_windows_rust()
{
	if $WINDOWS_RUST_READY; then
		return 0
	fi

	if ! command -v cargo &> /dev/null; then
		echo "Installing Rust for CLI build..."
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
		source "$HOME/.cargo/env"
	fi

	WINDOWS_RUST_READY=true
}

# Unified rust setup for building extensions and CLI
# Installs Rust if needed and adds all necessary targets for the platforms being built
function ensure_rust_setup()
{
	# Return early if rust setup has already been completed
	if $RUST_SETUP_DONE; then
		return 0
	fi

	echo "Setting up Rust for extension builds..."

	# Check if Rust is installed
	if ! command -v cargo &> /dev/null; then
		echo "Installing Rust..."
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
		source "$HOME/.cargo/env"
	fi

	# Add rustup targets for all platforms being built
	if $BUILD_WINDOWS; then
		echo "Adding Windows Rust targets..."
		local win_arches=("${WINDOWS_BUILD_ARCHES[@]}")
		if [ ${#win_arches[@]} -eq 0 ]; then
			win_arches=(x64 arm64)
		fi
		for arch in "${win_arches[@]}"; do
			case "$arch" in
				x64|amd64|X64)
					rustup target add x86_64-pc-windows-msvc
					;;
				arm64|aarch64|ARM64)
					rustup target add aarch64-pc-windows-msvc
					;;
			esac
		done
	fi

	if $BUILD_MACOS; then
		echo "Adding macOS Rust targets..."
		if $BUILD_MACOS_X64; then
			rustup target add x86_64-apple-darwin
		fi
		if $BUILD_MACOS_ARM64; then
			rustup target add aarch64-apple-darwin
		fi
	fi

	if $BUILD_LINUX; then
		echo "Adding Linux Rust targets..."
		# Determine which architectures to build for
		if [ -n "${LINUX_BUILD_ARCH:-}" ]; then
			LINUX_ARCHES=("$LINUX_BUILD_ARCH")
		else
			LINUX_ARCHES=("x64" "arm64")
		fi

		for arch in "${LINUX_ARCHES[@]}"; do
			case "$arch" in
				x64|amd64|X64)
					rustup target add x86_64-unknown-linux-gnu
					;;
				arm64|aarch64|ARM64)
					rustup target add aarch64-unknown-linux-gnu
					;;
			esac
		done
	fi

	RUST_SETUP_DONE=true
	echo "Rust setup complete"
}

# Install platform-specific prerequisites when enabled
function ensure_platform_prerequisites()
{
	if ! is_truthy "${INSTALL_PLATFORM_PREREQS:-0}"; then
		return 0
	fi

	local uname_s="$(uname -s 2>/dev/null || echo unknown)"
	case "$uname_s" in
		Linux)
			if command -v apt-get >/dev/null 2>&1; then
				echo "Installing Linux prerequisites via apt-get..."
				sudo apt-get update
				sudo DEBIAN_FRONTEND=noninteractive apt-get install -y rpm pkg-config libssl-dev dpkg-dev rpm libkrb5-dev
			elif command -v dnf >/dev/null 2>&1; then
				echo "Installing Linux prerequisites via dnf..."
				sudo dnf install -y rpm-build pkgconf-pkg-config openssl-devel krb5-devel
			else
				echo "Warning: No supported package manager found for installing Linux prerequisites" >&2
			fi
			;;
		darwin*)
			echo "macOS prerequisites are managed separately; nothing to install"
			;;
		MINGW*|MSYS*|CYGWIN*)
			echo "Windows prerequisites handled externally; nothing to install"
			;;
		*)
			echo "Unknown platform '$uname_s'; skipping automatic prerequisite installation" >&2
			;;
	esac
}

# Ensure the active Node.js version matches the value declared in .nvmrc
function ensure_node_version_matches()
{
	if [ ! -f ".nvmrc" ]; then
		return 0
	fi

	local expected_raw expected actual
	expected_raw="$(tr -d ' \t\r\n' < .nvmrc)"
	if [ -z "$expected_raw" ]; then
		return 0
	fi
	if [[ "$expected_raw" == v* ]]; then
		expected="$expected_raw"
	else
		expected="v$expected_raw"
	fi

	if ! command -v node >/dev/null 2>&1; then
		echo "Node.js is not available; required version from .nvmrc is $expected" >&2
		exit 1
	fi

	actual="$(node -v 2>/dev/null || echo "")"
	if [ -z "$actual" ]; then
		echo "Unable to determine active Node.js version" >&2
		exit 1
	fi

	if [ "$actual" != "$expected" ]; then
		echo "Active Node.js version $actual does not match required $expected from .nvmrc" >&2
		echo "Install the correct version or disable SKIP_NVM_SETUP" >&2
		exit 1
	fi
}

# Extension build functions

# Build malterlib extension as VSIX
function build_extension_malterlib()
{
	local ext_dir="$PWD/extensions/malterlib"

	if [ ! -d "$ext_dir" ]; then
		echo "Warning: malterlib extension directory not found at $ext_dir" >&2
		return 1
	fi

	echo "Building malterlib extension..."

	# Create temporary build directory outside the main project to avoid parent node_modules
	local temp_build_dir=$(mktemp -d)
	echo "Building in isolated directory: $temp_build_dir"

	# Ensure cleanup on exit (success or failure)
	trap "rm -rf '$temp_build_dir'" EXIT

	# Copy extension to temp directory, excluding .git and node_modules
	# Using tar instead of rsync for cross-platform compatibility
	(cd "$ext_dir" && tar cf - --exclude='.git' --exclude='node_modules' --exclude='AGENTS.md' .) | (cd "$temp_build_dir" && mkdir -p malterlib && cd malterlib && tar xf -)
	cd "$temp_build_dir/malterlib"

	# Update version to match CURRENT_VERSION and add " (Unbroken)" suffix to displayName
	echo "Setting malterlib version to $CURRENT_VERSION and updating displayName..."
	node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));pkg.version='$CURRENT_VERSION';if(pkg.displayName&&!pkg.displayName.includes('(Unbroken)'))pkg.displayName+=' (Unbroken)';fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');"

	# Install dependencies fresh (keeping package-lock.json for reproducibility)
	echo "Installing malterlib dependencies..."
	npm ci

	# Build and package
	npx vsce package --out "$PWD/malterlib.vsix"

	if [ ! -f "malterlib.vsix" ]; then
		echo "Error: Failed to build malterlib.vsix" >&2
		cd - > /dev/null
		return 1
	fi

	# Copy VSIX to temp directory
	cp "malterlib.vsix" "$VSIX_TEMP_DIR/malterlib.vsix"
	echo "Successfully built malterlib.vsix"

	# Return to original directory and cleanup will happen via trap
	cd - > /dev/null
	trap - EXIT  # Remove trap before normal exit
	rm -rf "$temp_build_dir"
}

# Build vscode-clangd extension as VSIX
function build_extension_vscode_clangd()
{
	local ext_dir="$PWD/extensions/vscode-clangd"

	if [ ! -d "$ext_dir" ]; then
		echo "Warning: vscode-clangd extension directory not found at $ext_dir" >&2
		return 1
	fi

	echo "Building vscode-clangd extension..."

	# Create temporary build directory outside the main project to avoid parent node_modules
	local temp_build_dir=$(mktemp -d)
	echo "Building in isolated directory: $temp_build_dir"

	# Ensure cleanup on exit (success or failure)
	trap "rm -rf '$temp_build_dir'" EXIT

	# Copy extension to temp directory, excluding .git and node_modules
	# Using tar instead of rsync for cross-platform compatibility
	(cd "$ext_dir" && tar cf - --exclude='.git' --exclude='node_modules' .) | (cd "$temp_build_dir" && mkdir -p vscode-clangd && cd vscode-clangd && tar xf -)
	cd "$temp_build_dir/vscode-clangd"

	# Update version to match CURRENT_VERSION and add " (Unbroken)" suffix to displayName
	echo "Setting vscode-clangd version to $CURRENT_VERSION and updating displayName..."
	node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));pkg.version='$CURRENT_VERSION';if(pkg.displayName&&!pkg.displayName.includes('(Unbroken)'))pkg.displayName+=' (Unbroken)';fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');"

	# Install dependencies fresh (keeping package-lock.json for reproducibility)
	echo "Installing vscode-clangd dependencies..."
	npm ci

	# Build and package with custom base images URL
	npx vsce package --baseImagesUrl https://raw.githubusercontent.com/Unbroken/vscode-clangd/master/ --out "$PWD/vscode-clangd.vsix"

	if [ ! -f "vscode-clangd.vsix" ]; then
		echo "Error: Failed to build vscode-clangd.vsix" >&2
		cd - > /dev/null
		return 1
	fi

	# Copy VSIX to temp directory
	cp "vscode-clangd.vsix" "$VSIX_TEMP_DIR/vscode-clangd.vsix"
	echo "Successfully built vscode-clangd.vsix"

	# Return to original directory and cleanup will happen via trap
	cd - > /dev/null
	trap - EXIT  # Remove trap before normal exit
	rm -rf "$temp_build_dir"
}

# Build codelldb extension as VSIX using the existing build script
function build_extension_codelldb()
{
	local platform="$1"  # darwin, win32, or linux
	local arch="$2"      # x64 or arm64
	local ext_dir="$PWD/extensions/codelldb"

	if [ ! -d "$ext_dir" ]; then
		echo "Warning: codelldb extension directory not found at $ext_dir" >&2
		return 1
	fi

	echo "Building codelldb extension for $platform-$arch..."

	# Create temporary build directory outside the main project to avoid parent node_modules
	local temp_build_dir=$(mktemp -d)
	echo "Building in isolated directory: $temp_build_dir"

	# Ensure cleanup on exit (success or failure)
	trap "rm -rf '$temp_build_dir'" EXIT

	# Copy extension to temp directory, excluding .git, node_modules, and build
	# Using tar instead of rsync for cross-platform compatibility
	(cd "$ext_dir" && tar cf - --exclude='.git' --exclude='node_modules' --exclude='build' .) | (cd "$temp_build_dir" && mkdir -p codelldb && cd codelldb && tar xf -)
	cd "$temp_build_dir/codelldb"

	# Update displayName in package.json to add " (Unbroken)" suffix
	echo "Setting codelldb displayName..."
	node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));if(pkg.displayName&&!pkg.displayName.includes('(Unbroken)'))pkg.displayName+=' (Unbroken)';fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');"

	# Update VERSION in CMakeLists.txt to match CURRENT_VERSION
	echo "Setting codelldb VERSION in CMakeLists.txt to $CURRENT_VERSION..."
	sed -i.bak "s/^set(VERSION \"[^\"]*\") # Base version/set(VERSION \"$CURRENT_VERSION\") # Base version/" CMakeLists.txt

	# Set environment variables for the build script
	export VSCODE_ARCH="$arch"
	export CODELLDB_BUILD_TARGET="vsix_full"

	# Run the existing build script
	local build_script="scripts/build-native.mjs"

	if [ ! -f "$build_script" ]; then
		echo "Error: Build script not found at $build_script" >&2
		cd - > /dev/null
		unset VSCODE_ARCH
		unset CODELLDB_BUILD_TARGET
		return 1
	fi

	# Execute the build script
	if ! node "$build_script"; then
		echo "Error: codelldb build failed for $platform-$arch" >&2
		cd - > /dev/null
		unset VSCODE_ARCH
		unset CODELLDB_BUILD_TARGET
		return 1
	fi

	# Find the generated VSIX in the build directory
	local build_dir="build"
	local vsix_file
	vsix_file=$(find "$build_dir" -name "*.vsix" -type f | head -n 1)

	if [ -z "$vsix_file" ] || [ ! -f "$vsix_file" ]; then
		echo "Error: Failed to find codelldb.vsix after build in $build_dir" >&2
		cd - > /dev/null
		unset VSCODE_ARCH
		unset CODELLDB_BUILD_TARGET
		return 1
	fi

	# Copy VSIX to temp directory with standardized name
	cp "$vsix_file" "$VSIX_TEMP_DIR/codelldb-$platform-$arch.vsix"
	echo "Successfully built codelldb-$platform-$arch.vsix"

	# Return to original directory and cleanup will happen via trap
	cd - > /dev/null
	unset VSCODE_ARCH
	unset CODELLDB_BUILD_TARGET
	trap - EXIT  # Remove trap before normal exit
	rm -rf "$temp_build_dir"
}

# Package extensions into a ZIP file for a specific platform and architecture
function package_extensions()
{
	local version="$1"
	local platform="$2"  # darwin, win32, or linux
	local arch="$3"      # x64 or arm64
	local output_dir="$4"

	echo "Packaging extensions for $platform-$arch..."

	local temp_dir="$output_dir/extensions-temp-$platform-$arch"
	mkdir -p "$temp_dir"

	# VSIX files are stored in .dist/temp directory
	local vsix_source_dir="$output_dir/temp"

	# Copy universal extensions (malterlib and vscode-clangd)
	local malterlib_vsix="$vsix_source_dir/malterlib.vsix"
	local clangd_vsix="$vsix_source_dir/vscode-clangd.vsix"

	if [ -f "$malterlib_vsix" ]; then
		cp "$malterlib_vsix" "$temp_dir/"
		echo "  Added malterlib.vsix"
	else
		echo "  Warning: malterlib.vsix not found, skipping"
	fi

	if [ -f "$clangd_vsix" ]; then
		cp "$clangd_vsix" "$temp_dir/"
		echo "  Added vscode-clangd.vsix"
	else
		echo "  Warning: vscode-clangd.vsix not found, skipping"
	fi

	# Copy platform/arch-specific codelldb
	local codelldb_vsix="$vsix_source_dir/codelldb-$platform-$arch.vsix"

	if [ -f "$codelldb_vsix" ]; then
		# Rename to just codelldb.vsix in the package
		cp "$codelldb_vsix" "$temp_dir/codelldb.vsix"
		echo "  Added codelldb.vsix ($platform-$arch)"
	else
		echo "  Warning: codelldb-$platform-$arch.vsix not found, skipping"
	fi

	# Create ZIP file
	local zip_name="unbroken-code-extensions-$version-$platform-$arch.zip"
	local zip_path="$output_dir/$zip_name"

	cd "$temp_dir"
	# Use PowerShell on Windows for compatibility
	if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
		local win_temp_dir
		win_temp_dir=$(cygpath -w "$temp_dir")
		local win_zip_path
		win_zip_path=$(cygpath -w "$zip_path")
		if powershell -Command "Compress-Archive -Path '$win_temp_dir\*.vsix' -DestinationPath '$win_zip_path' -Force"; then
			echo "Successfully created $zip_name"
		else
			echo "Error: Failed to create ZIP file for extensions" >&2
			cd - > /dev/null
			rm -rf "$temp_dir"
			return 1
		fi
	else
		if zip -r "$zip_path" *.vsix; then
			echo "Successfully created $zip_name"
		else
			echo "Error: Failed to create ZIP file for extensions" >&2
			cd - > /dev/null
			rm -rf "$temp_dir"
			return 1
		fi
	fi

	# Generate SHA256 checksum
	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$zip_path" | awk '{print $1}' > "$zip_path.sha256"
	elif command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$zip_path" | awk '{print $1}' > "$zip_path.sha256"
	fi

	cd - > /dev/null

	# Clean up temp directory
	rm -rf "$temp_dir"

	return 0
}

# Build all extensions for configured platforms
function build_all_extensions()
{
	echo ""
	echo "==================================="
	echo "Building Extensions"
	echo "==================================="

	# Ensure Rust is set up for all platforms being built
	# This is needed for codelldb extension which has native Rust code
	ensure_rust_setup

	# Get version from package.json
	CURRENT_VERSION=$(node -p "require('./package.json').version")

	# Determine output directory for extension packages
	EXTENSIONS_OUTPUT_DIR="$PWD/.dist"
	mkdir -p "$EXTENSIONS_OUTPUT_DIR"

	# Create temporary directory for VSIX files
	VSIX_TEMP_DIR="$EXTENSIONS_OUTPUT_DIR/temp"
	mkdir -p "$VSIX_TEMP_DIR"
	echo "VSIX files will be stored in: $VSIX_TEMP_DIR"

	# Build universal extensions (malterlib and vscode-clangd) once
	echo ""
	echo "Building universal extensions..."
	build_extension_malterlib
	build_extension_vscode_clangd

	# Build and package extensions for each built platform/architecture
	echo ""
	echo "Building platform-specific extensions and creating packages..."

	# macOS extensions
	if $BUILD_MACOS; then
		if $BUILD_MACOS_X64; then
			echo ""
			echo "Building codelldb for macOS x64..."
			build_extension_codelldb "darwin" "x64"
			package_extensions "$CURRENT_VERSION" "darwin" "x64" "$EXTENSIONS_OUTPUT_DIR"
		fi

		if $BUILD_MACOS_ARM64; then
			echo ""
			echo "Building codelldb for macOS arm64..."
			build_extension_codelldb "darwin" "arm64"
			package_extensions "$CURRENT_VERSION" "darwin" "arm64" "$EXTENSIONS_OUTPUT_DIR"
		fi
	fi

	# Windows extensions
	if $BUILD_WINDOWS; then
		local win_ext_arches=("${WINDOWS_BUILD_ARCHES[@]}")
		if [ ${#win_ext_arches[@]} -eq 0 ]; then
			win_ext_arches=(x64 arm64)
		fi
		for arch in "${win_ext_arches[@]}"; do
			echo ""
			echo "Building codelldb for Windows $arch..."
			build_extension_codelldb "win32" "$arch"
			package_extensions "$CURRENT_VERSION" "win32" "$arch" "$EXTENSIONS_OUTPUT_DIR"
		done
	fi

	# Linux extensions
	if $BUILD_LINUX; then
		# Detect architecture or use both
		if [ -n "${LINUX_BUILD_ARCH:-}" ]; then
			LINUX_ARCHES=("$LINUX_BUILD_ARCH")
		else
			LINUX_ARCHES=("x64" "arm64")
		fi

		for arch in "${LINUX_ARCHES[@]}"; do
			echo ""
			echo "Building codelldb for Linux $arch..."
			build_extension_codelldb "linux" "$arch"
			package_extensions "$CURRENT_VERSION" "linux" "$arch" "$EXTENSIONS_OUTPUT_DIR"
		done
	fi

	echo "Extension building completed!"
}

# Auto-detect platform if no explicit platform flags are given
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
	# We're on Windows (Git Bash), default to Windows build
	BUILD_WINDOWS=true
	BUILD_MACOS=false
	BUILD_LINUX=false
elif [[ "$OSTYPE" == "darwin"* ]]; then
	# We're on macOS, default to macOS build
	BUILD_WINDOWS=false
	BUILD_MACOS=true
	BUILD_LINUX=false
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
	# We're on Linux, default to Linux build
	BUILD_WINDOWS=false
	BUILD_MACOS=false
	BUILD_LINUX=true
fi

for arg in "$@"; do
	case $arg in
		--new-version)
			NEW_VERSION=true
			IGNORE_SUBMODULE_CHECK=true
			shift
			;;
		--release)
			CREATE_RELEASE=true
			shift
			;;
		--publish)
			PUBLISH_RELEASE=true
			SKIP_BUILD=true
			shift
			;;
		--skip-build)
			SKIP_BUILD=true
			shift
			;;
		--skip-gulp-build)
			SKIP_GULP_BUILD=true
			shift
			;;
		--skip-extensions)
			SKIP_EXTENSIONS=true
			shift
			;;
		--extensions-only)
			EXTENSIONS_ONLY=true
			SKIP_BUILD=true
			shift
			;;
		--regenerate-dmg)
			REGENERATE_DMG=true
			shift
			;;
		--generate-release-description)
			GENERATE_RELEASE_DESCRIPTION=true
			SKIP_BUILD=true
			shift
			;;
		--show-release-notes)
			SHOW_RELEASE_NOTES=true
			SKIP_BUILD=true
			IGNORE_SUBMODULE_CHECK=true
			shift
			;;
		--windows)
			BUILD_WINDOWS=true
			BUILD_MACOS=false
			BUILD_LINUX=false
			shift
			;;
		--windows-arch=*)
			BUILD_WINDOWS=true
			BUILD_MACOS=false
			BUILD_LINUX=false
			WINDOWS_BUILD_ARCHES+=("${arg#--windows-arch=}")
			shift
			;;
		--macos)
			BUILD_MACOS=true
			BUILD_WINDOWS=false
			BUILD_LINUX=false
			shift
			;;
		--macos-arch=*)
			BUILD_MACOS=true
			BUILD_WINDOWS=false
			BUILD_LINUX=false
			MACOS_ARCH="${arg#--macos-arch=}"
			if [ "$MACOS_ARCH" = "x64" ]; then
				BUILD_MACOS_X64=true
				BUILD_MACOS_ARM64=false
			elif [ "$MACOS_ARCH" = "arm64" ]; then
				BUILD_MACOS_X64=false
				BUILD_MACOS_ARM64=true
			else
				echo "Error: Invalid macOS architecture '$MACOS_ARCH'. Use 'x64' or 'arm64'."
				exit 1
			fi
			shift
			;;
		--linux)
			BUILD_LINUX=true
			BUILD_WINDOWS=false
			BUILD_MACOS=false
			shift
			;;
		--all-platforms)
			BUILD_WINDOWS=true
			BUILD_MACOS=true
			BUILD_LINUX=true
			shift
			;;
		--ignore-submodule-check)
			IGNORE_SUBMODULE_CHECK=true
			shift
			;;
		--help)
			echo "Usage: $0 [OPTIONS]"
			echo ""
			echo "Options:"
			echo "  --new-version    Increment version number before building"
			echo "  --release        Create/update GitHub release (draft) after building"
			echo "  --publish        Publish the GitHub release (make it public)"
			echo "  --skip-build     Skip the build process (only for release-related operations)"
			echo "  --skip-gulp-build Skip gulp build, only create installers/universal binary"
			echo "  --skip-extensions Skip building and packaging extensions (malterlib, vscode-clangd, codelldb)"
			echo "  --extensions-only Build only extensions, skip main application build"
			echo "  --regenerate-dmg Force regeneration of DMG files even if they exist"
			echo "  --generate-release-description  Update the draft release description without uploading assets"
			echo "  --show-release-notes  Show the \"What's New\" release notes without creating a release"
			echo "  --windows        Build Windows binaries (x64 and arm64)"
			echo "  --windows-arch=<arch>  Build only the specified Windows architecture (x64 or arm64)"
			echo "  --macos          Build macOS binaries (arm64, x64, universal)"
			echo "  --macos-arch=<arch>    Build only the specified macOS architecture (x64 or arm64)"
			echo "  --linux          Build Linux binaries (x64, arm64, deb, rpm, tar.gz, CLI)"
			echo "  --all-platforms  Build for all platforms (macOS, Windows, and Linux)"
			echo "  --ignore-submodule-check  Skip checking if submodules have new commits"
			echo "  --help           Show this help message"
			echo ""
			echo "Platform auto-detection:"
			echo "  - macOS: builds macOS binaries by default"
			echo "  - Windows (Git Bash): builds Windows binaries by default"
			echo "  - Linux: builds Linux binaries by default"
			echo ""
			echo "Multi-machine release workflow:"
			echo "  # Step 1: On macOS machine"
			echo "  $0 --new-version --release   # Create draft release with macOS builds"
			echo ""
			echo "  # Step 2: On Windows machine (Git Bash)"
			echo "  $0 --release                 # Add Windows builds to existing draft release"
			echo ""
			echo "  # Step 3: On any machine"
			echo "  $0 --skip-build --publish    # Publish the complete release"
			echo ""
			echo "Single-platform examples:"
			echo "  $0                           # Build for current platform"
			echo "  $0 --new-version             # Update version only"
			echo "  $0 --release                 # Build and create/update draft release"
			echo "  $0 --macos-arch=arm64        # Build only macOS arm64"
			echo "  $0 --macos-arch=x64          # Build only macOS x64"
			echo "  $0 --windows-arch=x64        # Build only Windows x64"
			exit 0
			;;
		*)
			echo "Unknown option: $arg"
			echo "Use --help for usage information"
			exit 1
			;;
	esac
done

if $BUILD_LINUX; then
	# Determine which architectures to build for
	CURRENT_ARCH=$(uname -m)
	if [ "$CURRENT_ARCH" = "aarch64" ]; then
		LINUX_BUILD_ARCH="arm64"
	else
		LINUX_BUILD_ARCH="x64"
	fi
fi

# Function to check if submodules have new commits on master
function Check_Submodule_Updates()
{
	echo "Checking if submodules have new commits..."
	local submodule_outdated=false
	local outdated_submodules=""

	# Check if there are any submodules
	if ! git submodule status >/dev/null 2>&1; then
		echo "No submodules found"
		return 0
	fi

	# Use git submodule foreach to check each submodule
	git submodule foreach --quiet '
		submodule_name="$name"
		submodule_path="$sm_path"

		echo "Checking submodule: $submodule_name at $submodule_path"

		# Fetch latest from remote (try both master and main)
		git fetch origin master >/dev/null 2>&1 || git fetch origin main >/dev/null 2>&1

		# Get current commit
		current_commit=$(git rev-parse HEAD)

		# Get latest commit on master/main
		remote_commit=$(git rev-parse --verify origin/master 2>/dev/null || git rev-parse --verify origin/main 2>/dev/null)

		if [ "$current_commit" != "$remote_commit" ]; then
			echo "  ⚠️  Submodule '\''$submodule_name'\'' is behind remote master/main"
			echo "     Current: $current_commit"
			echo "     Remote:  $remote_commit"
			echo "OUTDATED:$submodule_name"
		else
			echo "  ✅ Submodule '\''$submodule_name'\'' is up-to-date"
		fi
	' | while IFS= read -r line; do
		if [[ $line == OUTDATED:* ]]; then
			submodule_name="${line#OUTDATED:}"
			submodule_outdated=true
			outdated_submodules="$outdated_submodules $submodule_name"
		else
			echo "$line"
		fi
	done

	# Check if any submodules were outdated (using a different approach due to subshell)
	local check_result
	check_result=$(git submodule foreach --quiet '
		# Fetch latest from remote
		git fetch origin master >/dev/null 2>&1 || git fetch origin main >/dev/null 2>&1

		# Get current and remote commits
		current_commit=$(git rev-parse HEAD)
		remote_commit=$(git rev-parse --verify origin/master 2>/dev/null || git rev-parse --verify origin/main 2>/dev/null)

		if [ "$current_commit" != "$remote_commit" ]; then
			echo "OUTDATED:$name"
		fi
	' | grep "^OUTDATED:" | cut -d: -f2)

	if [ -n "$check_result" ]; then
		echo ""
		echo -e "\033[31mError:\033[0m The following submodules have new commits available: $check_result"
		echo "Please update them with: git submodule update --remote"
		echo "Or use --ignore-submodule-check to skip this check"
		echo ""
		return 1
	else
		echo "All submodules are up-to-date"
	fi

	return 0
}

# Function to wait for all background jobs and check for errors
function WaitWithErrorPropagation()
{
	local description="${1:-waiting for background jobs}"
	local job_failed=false
	local failed_jobs=""

	# Get all background job PIDs
	local pids=$(jobs -p)

	if [ -z "$pids" ]; then
		return 0
	fi

	# Wait for each job and check its exit status
	for pid in $pids; do
		if ! wait $pid; then
			job_failed=true
			failed_jobs="$failed_jobs $pid"
		fi
	done

	if $job_failed; then
		echo
		echo -e "\033[31mError:\033[0m Failed while $description (PIDs:$failed_jobs)"
		echo
		return 1
	fi

	return 0
}

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
	if $SHOW_RELEASE_NOTES; then
		echo "Showing release notes..."
	elif $GENERATE_RELEASE_DESCRIPTION && ! $PUBLISH_RELEASE; then
		echo "Generating GitHub release description..."
	else
		echo "Creating GitHub release..."
	fi

	# Get GitHub token from git credentials if not already set
	if [ -z "${GITHUB_TOKEN:-}" ]; then
		GITHUB_TOKEN=$(echo "url=https://github.com" | git credential fill | grep "^password=" | cut -d= -f2)
		if [ -n "$GITHUB_TOKEN" ]; then
			export GITHUB_TOKEN
			echo "Using GitHub token from git credentials"
		fi
	fi

	# Build command with options
	RELEASE_CMD="node build/release/create-github-release.ts"

	if $PUBLISH_RELEASE; then
		RELEASE_CMD="$RELEASE_CMD --publish"
	fi

	if $REGENERATE_DMG; then
		RELEASE_CMD="$RELEASE_CMD --regenerate-dmg"
	fi

	if $GENERATE_RELEASE_DESCRIPTION; then
		RELEASE_CMD="$RELEASE_CMD --generate-release-description"
	fi

	if $SHOW_RELEASE_NOTES; then
		RELEASE_CMD="$RELEASE_CMD --show-release-notes"

		# Execute the release command
		$RELEASE_CMD

		if ! [ $? -eq 0 ]; then
			echo "Failed to show release notes"
			exit 1
		fi

	else
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
	fi
}

# Ensure git submodules are initialized and updated
echo "Checking git submodules..."
if [ -f ".gitmodules" ] && ! $IGNORE_SUBMODULE_CHECK; then
	git submodule update --init --recursive
	echo "Git submodules updated"

	# Check if submodules have new commits (unless ignored)
	if ! $IGNORE_SUBMODULE_CHECK; then
		if ! Check_Submodule_Updates; then
			exit 1
		fi
	else
		echo "Skipping submodule update check (--ignore-submodule-check flag set)"
	fi
elif ! $IGNORE_SUBMODULE_CHECK; then
	echo "No .gitmodules file found"
fi

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
if $BUILD_WINDOWS ; then
	if is_truthy "${SKIP_NVM_SETUP:-0}"; then
		echo "Skipping NVM setup; using existing Node version"
		ensure_node_version_matches
	else
		nvm install `cat .nvmrc`
		nvm use `cat .nvmrc`
	fi
else
	if is_truthy "${SKIP_NVM_SETUP:-0}"; then
		echo "Skipping NVM setup; using existing Node version"
		if ! command -v node >/dev/null 2>&1; then
			echo "Node.js is not available; install it or disable SKIP_NVM_SETUP" >&2
			exit 1
		fi
		ensure_node_version_matches
	else
		export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

		# Check common NVM locations
		if [ -s "$NVM_DIR/nvm.sh" ]; then                 # Standard location (Linux & macOS)
			. "$NVM_DIR/nvm.sh"
		elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then  # macOS (Apple Silicon via Homebrew)
			export NVM_DIR="/opt/homebrew/opt/nvm"
			. "/opt/homebrew/opt/nvm/nvm.sh"
		elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then     # macOS (Intel via Homebrew)
			export NVM_DIR="/usr/local/opt/nvm"
			. "/usr/local/opt/nvm/nvm.sh"
		elif [ -s "$HOME/.nvm/nvm.sh" ]; then             # Fallback to home directory
			export NVM_DIR="$HOME/.nvm"
			. "$HOME/.nvm/nvm.sh"
		else
			echo "nvm not found. Ensure NVM is installed and NVM_DIR is set." >&2
			echo "To install nvm on Linux/macOS: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash" >&2
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
	fi
fi

ensure_platform_prerequisites
ensure_node_version_matches

echo "Using Node $(node -v) at $(command -v node)"

# Set a common build date for all architectures
export VSCODE_BUILD_DATE=$(node -e "console.log(new Date().toISOString())")
echo "Using build date: $VSCODE_BUILD_DATE"

export VSCODE_QUALITY=stable

function Run_Windows_Gulp_Build()
{
	local arch="$1"

	echo "Building Windows $arch..."

	$USE_NPM_CI && npm_config_arch=$arch NPM_ARCH=$arch VSCODE_ARCH=$arch npm ci --cpu=$arch

	# Temporarily rename node_modules/.bin/rc to avoid conflict with Windows Resource Compiler
	if [ -f "node_modules/.bin/rc" ]; then
		mv "node_modules/.bin/rc" "node_modules/.bin/rc.bak"
		mv "node_modules/.bin/rc.cmd" "node_modules/.bin/rc.cmd.bak" 2>/dev/null || true
		mv "node_modules/.bin/rc.ps1" "node_modules/.bin/rc.ps1.bak" 2>/dev/null || true
		echo "Temporarily renamed rc binaries to avoid conflict with Windows Resource Compiler"
	fi

	npm_config_arch=$arch NPM_ARCH=$arch VSCODE_ARCH=$arch npm run gulp vscode-win32-$arch

	# Restore rc binaries after build
	if [ -f "node_modules/.bin/rc.bak" ]; then
		mv "node_modules/.bin/rc.bak" "node_modules/.bin/rc"
		mv "node_modules/.bin/rc.cmd.bak" "node_modules/.bin/rc.cmd" 2>/dev/null || true
		mv "node_modules/.bin/rc.ps1.bak" "node_modules/.bin/rc.ps1" 2>/dev/null || true
		echo "Restored rc binaries"
	fi
}

function Build_Windows_Arch()
{
	local requested_arch="$1"
	if [ -z "$requested_arch" ]; then
		echo "Build_Windows_Arch requires an architecture (x64 or arm64)" >&2
		exit 1
	fi

	local arch=""
	case "$requested_arch" in
		x64|amd64|X64)
			arch="x64"
			;;
		arm64|aarch64|ARM64)
			arch="arm64"
			;;
		*)
			echo "Unsupported Windows architecture: $requested_arch" >&2
			exit 1
			;;
	esac

	ensure_windows_env
	ensure_windows_dist_dir
	local dist_dir="$WINDOWS_DIST_DIR"

	if ! $SKIP_GULP_BUILD; then
		Run_Windows_Gulp_Build "$arch"
	fi

	# Type check esbuild-based extensions
	if [[ "$arch" == "x64" ]]; then
		echo "Type checking extensions..."
		bash scripts/typecheck-extensions.sh
	fi

	echo "Downloading Explorer dlls for Windows $arch..."
	VSCODE_ARCH=$arch node build/win32/explorer-dll-fetcher.ts .build/win32/appx

	# Ensure Rust is set up
	ensure_rust_setup

	local cargo_target
	if [ "$arch" = "x64" ]; then
		cargo_target="x86_64-pc-windows-msvc"
	else
		cargo_target="aarch64-pc-windows-msvc"
	fi

	echo "Building CLI for Windows $arch..."
	(cd cli && cargo build --release --target "$cargo_target")

	echo "Integrating CLI into Windows $arch application..."
	local cli_app_name
	cli_app_name=$(cd "$dist_dir" && node -p "JSON.parse(require('fs').readFileSync('VSCode-win32-$arch/resources/app/product.json')).tunnelApplicationName || 'code-tunnel'")
	mkdir -p "$dist_dir/VSCode-win32-$arch/bin"
	cp "cli/target/$cargo_target/release/code.exe" "$dist_dir/VSCode-win32-$arch/bin/$cli_app_name.exe"
	echo "CLI integrated as $cli_app_name.exe ($arch)"

	echo "Creating Windows $arch installers..."
	VSCODE_ARCH=$arch npm run gulp vscode-win32-$arch-inno-updater

	local MAKEAPPX=""
	local SDK_BASE="/c/Program Files (x86)/Windows Kits/10/bin"
	if [ -d "$SDK_BASE" ]; then
		for sdk_dir in "$SDK_BASE"/10.0.*/x64; do
			if [ -f "$sdk_dir/makeappx.exe" ]; then
				MAKEAPPX="$sdk_dir/makeappx.exe"
			fi
		done
	fi

	if [ -n "$MAKEAPPX" ] && [ -d "$dist_dir/VSCode-win32-$arch/appx/manifest" ]; then
		echo "Found makeappx at: $MAKEAPPX"
		echo "Preparing appx package for $arch..."
		local appx_path="$dist_dir/VSCode-win32-$arch/appx/code_${arch}.appx"
		"$MAKEAPPX" pack -d "$dist_dir/VSCode-win32-$arch/appx/manifest" -p "$appx_path" -nv
		rm -rf "$dist_dir/VSCode-win32-$arch/appx/manifest"
	else
		echo "makeappx.exe not found or manifest missing for $arch; skipping appx packaging"
		echo "Looked in: $SDK_BASE"
		echo "To create appx packages, ensure Windows SDK is installed with Visual Studio."

		exit 1
	fi

	local explorer_dll_suffix="$arch"
	local explorer_dll=".build/win32/appx/code_explorer_command_${explorer_dll_suffix}.dll"
	if [ -f "$explorer_dll" ]; then
		cp "$explorer_dll" "$dist_dir/VSCode-win32-$arch/appx/"
	fi

	VSCODE_ARCH=$arch npm run gulp vscode-win32-$arch-user-setup &
	VSCODE_ARCH=$arch npm run gulp vscode-win32-$arch-system-setup &

	WaitWithErrorPropagation "creating Windows $arch installers"

	echo "Packaging Windows $arch CLI artifacts..."
	local cli_temp_dir="$dist_dir/temp_cli_win32_${arch}"
	mkdir -p "$cli_temp_dir"
	cp "cli/target/$cargo_target/release/code.exe" "$cli_temp_dir/unbroken-code.exe"

	local win_cli_temp_dir
	win_cli_temp_dir=$(cygpath -w "$cli_temp_dir")
	local win_zip_path
	win_zip_path=$(cygpath -w "$dist_dir/unbroken_code_cli_win32_${arch}_cli.zip")
	powershell -Command "Compress-Archive -Path '$win_cli_temp_dir\*' -DestinationPath '$win_zip_path' -Force"

	cp "cli/target/$cargo_target/release/code.exe" "$dist_dir/unbroken-code-cli-win32-$arch.exe"
	rm -rf "$cli_temp_dir"

	echo "Created unbroken_code_cli_win32_${arch}_cli.zip"

	if $SKIP_GULP_BUILD; then
		echo "Windows $arch installers created successfully!"
	else
		echo "Windows $arch binaries built successfully!"
	fi
}

function Build_Windows()
{
	local arches=("$@")
	if [ ${#arches[@]} -eq 0 ]; then
		arches=(x64 arm64)
	fi

	WINDOWS_DIST_INITIALIZED=false
	WINDOWS_DIST_DIR=""

	ensure_windows_env

	for arch in "${arches[@]}"; do
		Build_Windows_Arch "$arch"
	done
}

function Build_Linux()
{
	if $SKIP_GULP_BUILD; then
		echo "Skipping gulp build, only creating Linux packages..."
	else
		echo "Building Linux binaries..."
	fi

	# Create .dist directory for Linux builds
	DIST_DIR="$PWD/.dist"
	if ! $SKIP_GULP_BUILD; then
		rm -rf "$DIST_DIR"
	fi
	mkdir -p "$DIST_DIR"
	echo "Using distribution directory: $DIST_DIR"

	# Set environment variable to build directly to .dist directory
	export VSCODE_BUILD_OUTPUT_DIR="$DIST_DIR"

	# Check for required dependencies
	echo "Checking for required build dependencies..."
	MISSING_DEPS=""

	# Check for rpm (needed for RPM builds on Debian/Ubuntu)
	if ! command -v rpm &> /dev/null; then
		MISSING_DEPS="$MISSING_DEPS rpm"
	fi

	# Check for dpkg-deb (needed for DEB builds)
	if ! command -v dpkg-deb &> /dev/null; then
		MISSING_DEPS="$MISSING_DEPS dpkg-dev"
	fi

	# Check for rpmbuild (comes with rpm package on Debian/Ubuntu)
	if ! command -v rpmbuild &> /dev/null; then
		MISSING_DEPS="$MISSING_DEPS rpm"
	fi

	# Check for OpenSSL development packages (needed for CLI build)
	if ! pkg-config --exists openssl 2>/dev/null; then
		MISSING_DEPS="$MISSING_DEPS libssl-dev"
	fi

	# Check for pkg-config (needed to find OpenSSL)
	if ! command -v pkg-config &> /dev/null; then
		MISSING_DEPS="$MISSING_DEPS pkg-config"
	fi

	if [ -n "$MISSING_DEPS" ]; then
		echo "Warning: Missing dependencies:$MISSING_DEPS"
		echo "To install on Debian/Ubuntu: sudo apt-get install$MISSING_DEPS"
		echo "To install on Fedora/RedHat: sudo dnf install rpm-build alien openssl-devel pkgconf-pkg-config"
		echo ""
		echo "Continuing with available build targets..."
	fi

	if ! $SKIP_GULP_BUILD; then
		# Build for current architecture (non-minified)
		echo "Building Linux $LINUX_BUILD_ARCH (native)..."
		$USE_NPM_CI && npm_config_arch=$LINUX_BUILD_ARCH NPM_ARCH=$LINUX_BUILD_ARCH VSCODE_ARCH=$LINUX_BUILD_ARCH npm ci
		npm_config_arch=$LINUX_BUILD_ARCH NPM_ARCH=$LINUX_BUILD_ARCH VSCODE_ARCH=$LINUX_BUILD_ARCH npm run gulp vscode-linux-$LINUX_BUILD_ARCH
	fi

	# Type check esbuild-based extensions
	echo "Type checking extensions..."
	bash scripts/typecheck-extensions.sh

	# Build CLI for Linux
	echo "Building Linux CLI..."

	# Ensure Rust is set up
	ensure_rust_setup

	# Build CLI for current architecture
	echo "Building CLI for Linux $LINUX_BUILD_ARCH..."

	if [ "$LINUX_BUILD_ARCH" = "arm64" ]; then
		CLI_TARGET="aarch64-unknown-linux-gnu"
	else
		CLI_TARGET="x86_64-unknown-linux-gnu"
	fi

	(cd cli && cargo build --release --target $CLI_TARGET)

	# Integrate CLI into the main application (like VS Code does)
	echo "Integrating CLI into main application..."

	# Get the tunnel application name from product.json
	CLI_APP_NAME=$(node -p "require('$DIST_DIR/VSCode-linux-$LINUX_BUILD_ARCH/resources/app/product.json').tunnelApplicationName || 'code-tunnel'")

	# Create bin directory if it doesn't exist
	mkdir -p "$DIST_DIR/VSCode-linux-$LINUX_BUILD_ARCH/bin"

	# Copy CLI binary to the application's bin directory
	cp "cli/target/$CLI_TARGET/release/code" "$DIST_DIR/VSCode-linux-$LINUX_BUILD_ARCH/bin/$CLI_APP_NAME"
	chmod +x "$DIST_DIR/VSCode-linux-$LINUX_BUILD_ARCH/bin/$CLI_APP_NAME"

	echo "CLI integrated as $CLI_APP_NAME"

	# Create packages
	echo "Creating Linux packages..."

	# Build .deb packages
	if command -v dpkg-deb &> /dev/null; then
		echo "Building .deb package for $LINUX_BUILD_ARCH..."

		# Prepare and build deb for current architecture
		VSCODE_ARCH=$LINUX_BUILD_ARCH npm run gulp vscode-linux-$LINUX_BUILD_ARCH-prepare-deb
		VSCODE_ARCH=$LINUX_BUILD_ARCH npm run gulp vscode-linux-$LINUX_BUILD_ARCH-build-deb

		echo "DEB package created successfully!"
	else
		echo "Skipping .deb package creation (dpkg-deb not found)"
	fi

	# Build .rpm packages
	if command -v rpmbuild &> /dev/null; then
		echo "Building .rpm package for $LINUX_BUILD_ARCH..."

		# Prepare and build rpm for current architecture
		VSCODE_ARCH=$LINUX_BUILD_ARCH npm run gulp vscode-linux-$LINUX_BUILD_ARCH-prepare-rpm
		VSCODE_ARCH=$LINUX_BUILD_ARCH npm run gulp vscode-linux-$LINUX_BUILD_ARCH-build-rpm

		echo "RPM package created successfully!"
	else
		echo "Skipping .rpm package creation (rpmbuild not found)"
	fi

	# Create tar.gz archive for current architecture
	echo "Creating tar.gz archive for $LINUX_BUILD_ARCH..."

	# Create archive with renamed folder for current architecture
	if [ -d "$DIST_DIR/VSCode-linux-$LINUX_BUILD_ARCH" ]; then
		tar -czf "$DIST_DIR/UnbrokenCode-linux-$LINUX_BUILD_ARCH.tar.gz" -C "$DIST_DIR" --transform "s/^VSCode-linux-$LINUX_BUILD_ARCH/UnbrokenCode-linux-$LINUX_BUILD_ARCH/" "VSCode-linux-$LINUX_BUILD_ARCH"
		echo "Created UnbrokenCode-linux-$LINUX_BUILD_ARCH.tar.gz"
	fi

	# Create standalone CLI binary package
	echo "Creating CLI binary package..."

	if [ "$LINUX_BUILD_ARCH" = "arm64" ]; then
		CLI_TARGET="aarch64-unknown-linux-gnu"
	else
		CLI_TARGET="x86_64-unknown-linux-gnu"
	fi

	# Create temporary directory for CLI packaging
	CLI_TEMP_DIR="$DIST_DIR/temp_cli_linux_$LINUX_BUILD_ARCH"
	mkdir -p "$CLI_TEMP_DIR"

	# Copy CLI binary with Unbroken Code name
	cp "cli/target/$CLI_TARGET/release/code" "$CLI_TEMP_DIR/unbroken-code"
	chmod +x "$CLI_TEMP_DIR/unbroken-code"

	# Create tar.gz package
	(cd "$CLI_TEMP_DIR" && tar -czf "$DIST_DIR/unbroken_code_cli_linux_${LINUX_BUILD_ARCH}_cli.tar.gz" .)

	# Copy standalone binary
	cp "cli/target/$CLI_TARGET/release/code" "$DIST_DIR/unbroken-code-cli-linux-$LINUX_BUILD_ARCH"

	# Cleanup temp directory
	rm -rf "$CLI_TEMP_DIR"

	echo "Created unbroken_code_cli_linux_${LINUX_BUILD_ARCH}_cli.tar.gz"

	if $SKIP_GULP_BUILD; then
		echo "Linux packages created successfully!"
	else
		echo "Linux binaries and packages built successfully!"
	fi
}

function Build_macOS()
{
	DO_BUILD=true
	DO_SIGN=${DO_SIGN:-true}
	DO_NOTARIZE=${DO_NOTARIZE:-$DO_SIGN}

	if $SKIP_GULP_BUILD; then
		echo "Skipping gulp build, only creating universal binary..."
		DO_BUILD=false
	else
		echo "Building macOS binaries..."
	fi

	which npm
	which node

	# Create .dist directory in current directory
	DIST_DIR="$PWD/.dist"
	if ! $SKIP_GULP_BUILD; then
		rm -rf "$DIST_DIR"
	fi
	mkdir -p "$DIST_DIR"
	echo "Using distribution directory: $DIST_DIR"

	# Build CLI for macOS
	echo "Building macOS CLI..."

	# Ensure Rust is set up
	ensure_rust_setup

	# Build CLI for x64
	if $BUILD_MACOS_X64; then
		echo "Building CLI for macOS x64..."
		(cd cli && cargo build --release --target x86_64-apple-darwin)
	fi

	# Build CLI for arm64
	if $BUILD_MACOS_ARM64; then
		echo "Building CLI for macOS arm64..."
		(cd cli && cargo build --release --target aarch64-apple-darwin)
	fi

	# Build both architectures with the same date
	if $DO_BUILD; then
		# Set environment variable to build directly to .dist directory
		export VSCODE_BUILD_OUTPUT_DIR="$DIST_DIR"

		if $BUILD_MACOS_X64; then
			$USE_NPM_CI && npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm ci --cpu x64
			npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm run gulp vscode-darwin-x64
			touch "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app"

			rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Makefile"
			rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/config.gypi"
			rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Release/obj.target"
			rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/binding.Makefile"
			rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/gyp-mac-tool"
			rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/extensions/vscode-copilot-chat/dist/test-"*
			rm -rf "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/extensions/vscode-copilot-chat/dist/sanity-test-"*
		fi

		if $BUILD_MACOS_ARM64; then
			$USE_NPM_CI && npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm ci --cpu arm64
			npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm run gulp vscode-darwin-arm64
			touch "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app"

			rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Makefile"
			rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/config.gypi"
			rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/Release/obj.target"
			rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/binding.Makefile"
			rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/keytar/build/gyp-mac-tool"
			rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/extensions/vscode-copilot-chat/dist/test-"*
			rm -rf "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/extensions/vscode-copilot-chat/dist/sanity-test-"*
		fi

		# Only copy files between architectures if both are being built
		if $BUILD_MACOS_ARM64 && $BUILD_MACOS_X64; then
			cp -r "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/Assets.car" "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/"
			cp -r "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode/vsce-sign-darwin-arm64" "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode"
			cp -r "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode/vsce-sign-darwin-x64" "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/node_modules/@vscode"
		fi
	fi

	# Type check esbuild-based extensions
	echo "Type checking extensions..."
	bash scripts/typecheck-extensions.sh

	# Integrate CLI into the main applications
	if true; then
		if $BUILD_MACOS_X64; then
			echo "Integrating CLI into macOS x64 application..."

			# Get the tunnel application name from product.json
			CLI_APP_NAME=$(node -p "require('$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/product.json').tunnelApplicationName || 'code-tunnel'")

			# Create bin directory if it doesn't exist
			mkdir -p "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/bin"

			# Copy CLI binary to the application's bin directory
			cp "cli/target/x86_64-apple-darwin/release/code" "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/bin/$CLI_APP_NAME"
			chmod +x "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/bin/$CLI_APP_NAME"

			echo "CLI integrated as $CLI_APP_NAME (x64)"
		fi

		if $BUILD_MACOS_ARM64; then
			echo "Integrating CLI into macOS arm64 application..."

			# Get the tunnel application name from product.json
			CLI_APP_NAME=$(node -p "require('$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/product.json').tunnelApplicationName || 'code-tunnel'")

			# Create bin directory if it doesn't exist
			mkdir -p "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/bin"

			# Copy CLI binary to the application's bin directory
			cp "cli/target/aarch64-apple-darwin/release/code" "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/bin/$CLI_APP_NAME"
			chmod +x "$DIST_DIR/VSCode-darwin-arm64/Unbroken Code.app/Contents/Resources/app/bin/$CLI_APP_NAME"

			echo "CLI integrated as $CLI_APP_NAME (arm64)"
		fi
	fi

	if true; then
		# Create standalone CLI binary packages
		if $BUILD_MACOS_X64; then
			echo "Creating CLI binary package for x64..."

			# Create temporary directory for CLI packaging
			CLI_TEMP_DIR="$DIST_DIR/temp_cli_darwin_x64"
			mkdir -p "$CLI_TEMP_DIR"

			# Copy CLI binary with Unbroken Code name
			cp "cli/target/x86_64-apple-darwin/release/code" "$CLI_TEMP_DIR/unbroken-code"
			chmod +x "$CLI_TEMP_DIR/unbroken-code"

			# Create zip package (remove existing to avoid appending)
			rm -f "$DIST_DIR/unbroken_code_cli_darwin_x64_cli.zip"
			(cd "$CLI_TEMP_DIR" && zip -r "$DIST_DIR/unbroken_code_cli_darwin_x64_cli.zip" .)

			# Copy standalone binary
			cp "cli/target/x86_64-apple-darwin/release/code" "$DIST_DIR/unbroken-code-cli-darwin-x64"

			# Cleanup temp directory
			rm -rf "$CLI_TEMP_DIR"

			echo "Created unbroken_code_cli_darwin_x64_cli.zip"
		fi

		if $BUILD_MACOS_ARM64; then
			echo "Creating CLI binary package for arm64..."

			# Create temporary directory for CLI packaging
			CLI_TEMP_DIR="$DIST_DIR/temp_cli_darwin_arm64"
			mkdir -p "$CLI_TEMP_DIR"

			# Copy CLI binary with Unbroken Code name
			cp "cli/target/aarch64-apple-darwin/release/code" "$CLI_TEMP_DIR/unbroken-code"
			chmod +x "$CLI_TEMP_DIR/unbroken-code"

			# Create zip package (remove existing to avoid appending)
			rm -f "$DIST_DIR/unbroken_code_cli_darwin_arm64_cli.zip"
			(cd "$CLI_TEMP_DIR" && zip -r "$DIST_DIR/unbroken_code_cli_darwin_arm64_cli.zip" .)

			# Copy standalone binary
			cp "cli/target/aarch64-apple-darwin/release/code" "$DIST_DIR/unbroken-code-cli-darwin-arm64"

			# Cleanup temp directory
			rm -rf "$CLI_TEMP_DIR"

			echo "Created unbroken_code_cli_darwin_arm64_cli.zip"
		fi
	fi

	# Create universal binary (even when skipping gulp build) - only if both architectures are built
	if $BUILD_MACOS_ARM64 && $BUILD_MACOS_X64; then
		VSCODE_ARCH=universal node build/darwin/create-universal-app.ts "$DIST_DIR"

		# Create universal CLI binary if both architectures exist
		echo "Creating universal CLI binary..."
		lipo -create \
			"cli/target/x86_64-apple-darwin/release/code" \
			"cli/target/aarch64-apple-darwin/release/code" \
			-output "$DIST_DIR/unbroken-code-cli-darwin-universal"
		echo "Created universal CLI binary"

		# Create universal CLI binary package
		CLI_TEMP_DIR="$DIST_DIR/temp_cli_darwin_universal"
		mkdir -p "$CLI_TEMP_DIR"

		# Copy universal CLI binary with Unbroken Code name
		cp "$DIST_DIR/unbroken-code-cli-darwin-universal" "$CLI_TEMP_DIR/unbroken-code"
		chmod +x "$CLI_TEMP_DIR/unbroken-code"

		# Create zip package (remove existing to avoid appending)
		rm -f "$DIST_DIR/unbroken_code_cli_darwin_universal_cli.zip"
		(cd "$CLI_TEMP_DIR" && zip -r "$DIST_DIR/unbroken_code_cli_darwin_universal_cli.zip" .)

		# Cleanup temp directory
		rm -rf "$CLI_TEMP_DIR"

		echo "Created unbroken_code_cli_darwin_universal_cli.zip"
	fi

	export AGENT_TEMPDIRECTORY=`mktemp -d`
	echo "AGENT_TEMPDIRECTORY: $AGENT_TEMPDIRECTORY"

	export CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-E9944AF714BFA859585C2217AF833B286AB09E31}"

	# Set the keychain profile for notarization
	export APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-Unbroken Notary}"

	# Sign all architectures
	if $DO_SIGN; then
		if $BUILD_MACOS_ARM64; then
			VSCODE_ARCH=arm64 node build/darwin/sign.ts "$DIST_DIR" &
		fi
		if $BUILD_MACOS_X64; then
			VSCODE_ARCH=x64 node build/darwin/sign.ts "$DIST_DIR" &
		fi
		if $BUILD_MACOS_ARM64 && $BUILD_MACOS_X64; then
			VSCODE_ARCH=universal node build/darwin/sign.ts "$DIST_DIR" &
		fi
		WaitWithErrorPropagation "signing macOS architectures"
	fi

	# Notarize and staple all architectures
	if $DO_NOTARIZE; then
		echo "Starting notarization process..."
		if $BUILD_MACOS_ARM64; then
			VSCODE_ARCH=arm64 node build/darwin/notarize.ts "$DIST_DIR" &
		fi
		if $BUILD_MACOS_X64; then
			VSCODE_ARCH=x64 node build/darwin/notarize.ts "$DIST_DIR" &
		fi
		if $BUILD_MACOS_ARM64 && $BUILD_MACOS_X64; then
			VSCODE_ARCH=universal node build/darwin/notarize.ts "$DIST_DIR" &
		fi
		WaitWithErrorPropagation "notarizing macOS architectures"
	fi
}

# Skip build if --skip-build flag is set
if ! $SKIP_BUILD; then
	# Track if any builds were run
	BUILD_RUN=false

	# Build macOS if requested
	if $BUILD_MACOS; then
		echo "Starting macOS build..."
		Build_macOS &
		BUILD_RUN=true
	fi

	# Build Windows if requested
	if $BUILD_WINDOWS; then
		echo "Starting Windows build..."
		Build_Windows "${WINDOWS_BUILD_ARCHES[@]}" &
		BUILD_RUN=true
	fi

	# Build Linux if requested
	if $BUILD_LINUX; then
		echo "Starting Linux build..."
		Build_Linux &
		BUILD_RUN=true
	fi

	# Wait for all builds to complete
	if $BUILD_RUN; then
		WaitWithErrorPropagation "building platforms"
		echo ""
		echo "Build completed successfully!"
	else
		echo "No build platforms selected. Use --help for options."
		exit 1
	fi

	# Build extensions if not skipped
	if ! $SKIP_EXTENSIONS; then
		build_all_extensions
	else
		echo ""
		echo "Skipping extension building (--skip-extensions flag set)"
	fi
else
	if $EXTENSIONS_ONLY; then
		echo "Skipping main build (--extensions-only flag set)"
	else
		echo "Skipping build process (--skip-build flag set)"
	fi
fi

# Build extensions separately if --extensions-only is set
if $EXTENSIONS_ONLY && ! $SKIP_EXTENSIONS; then
	build_all_extensions
fi

# Create GitHub release if --release flag is set
if $CREATE_RELEASE || $GENERATE_RELEASE_DESCRIPTION || $PUBLISH_RELEASE || $SHOW_RELEASE_NOTES; then
	Create_GitHub_Release
fi

echo ""
echo "All tasks completed successfully!"
