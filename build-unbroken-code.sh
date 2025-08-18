#!/usr/bin/env bash

set -euo pipefail

# Parse command line arguments
NEW_VERSION=false
CREATE_RELEASE=false
PUBLISH_RELEASE=false
SKIP_BUILD=false
SKIP_GULP_BUILD=false
REGENERATE_DMG=false
BUILD_WINDOWS=false
BUILD_MACOS=true
BUILD_LINUX=false
IGNORE_SUBMODULE_CHECK=false

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
		--skip-gulp-build)
			SKIP_GULP_BUILD=true
			shift
			;;
		--regenerate-dmg)
			REGENERATE_DMG=true
			shift
			;;
		--windows)
			BUILD_WINDOWS=true
			BUILD_MACOS=false
			BUILD_LINUX=false
			shift
			;;
		--macos)
			BUILD_MACOS=true
			BUILD_WINDOWS=false
			BUILD_LINUX=false
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
			echo "  --skip-build     Skip the build process (only for --release/--publish)"
			echo "  --skip-gulp-build Skip gulp build, only create installers/universal binary"
			echo "  --regenerate-dmg Force regeneration of DMG files even if they exist"
			echo "  --windows        Build Windows binaries (x64 and arm64)"
			echo "  --macos          Build macOS binaries (arm64, x64, universal)"
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
			exit 0
			;;
		*)
			echo "Unknown option: $arg"
			echo "Use --help for usage information"
			exit 1
			;;
	esac
done

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
		remote_commit=$(git rev-parse origin/master 2>/dev/null || git rev-parse origin/main 2>/dev/null)

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
		remote_commit=$(git rev-parse origin/master 2>/dev/null || git rev-parse origin/main 2>/dev/null)

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

# Ensure git submodules are initialized and updated
echo "Checking git submodules..."
if [ -f ".gitmodules" ]; then
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
else
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
	nvm install `cat .nvmrc`
	nvm use `cat .nvmrc`
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

echo "Using Node $(node -v) at $(command -v node)"

# Set a common build date for all architectures
export VSCODE_BUILD_DATE=$(node -e "console.log(new Date().toISOString())")
echo "Using build date: $VSCODE_BUILD_DATE"

export VSCODE_QUALITY=stable

function Build_Windows()
{
	if $SKIP_GULP_BUILD; then
		echo "Skipping gulp build, only creating Windows installers..."
	else
		echo "Building Windows binaries..."
	fi

	export PATH="/c/Strawberry/perl/bin/perl:$PATH"
	export PERL=/c/Strawberry/perl/bin/perl.exe
	export OPENSSL_SRC_PERL=/c/Strawberry/perl/bin/perl.exe
	hash -r

	# Create .dist directory for Windows builds
	DIST_DIR="$PWD/.dist"
	if ! $SKIP_GULP_BUILD; then
		rm -rf "$DIST_DIR"
	fi
	mkdir -p "$DIST_DIR"
	echo "Using distribution directory: $DIST_DIR"

	# Set environment variable to build directly to .dist directory
	export VSCODE_BUILD_OUTPUT_DIR="$DIST_DIR"

	if ! $SKIP_GULP_BUILD; then
		# Build Windows arm64
		echo "Building Windows arm64..."
		npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm ci --cpu=arm64
		npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm run gulp vscode-win32-arm64

		# Build Windows x64
		echo "Building Windows x64..."
		npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm ci --cpu=x64
		npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm run gulp vscode-win32-x64
	fi

	# Download Explorer dlls for Windows 11 integration (appx)
	echo "Downloading Explorer dlls..."
	VSCODE_ARCH=x64 node build/win32/explorer-dll-fetcher .build/win32/appx
	VSCODE_ARCH=arm64 node build/win32/explorer-dll-fetcher .build/win32/appx

	# Build CLI for Windows
	echo "Building Windows CLI..."

	# Check if Rust is installed
	if ! command -v cargo &> /dev/null; then
		echo "Installing Rust for CLI build..."
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
		source "$HOME/.cargo/env"
	fi

	# Add Windows targets
	rustup target add x86_64-pc-windows-msvc
	rustup target add aarch64-pc-windows-msvc

	# Build CLI for x64
	echo "Building CLI for Windows x64..."
	(cd cli && cargo build --release --target x86_64-pc-windows-msvc)

	# Build CLI for arm64
	echo "Building CLI for Windows arm64..."
	(cd cli && cargo build --release --target aarch64-pc-windows-msvc)

	# Integrate CLI into the main applications
	echo "Integrating CLI into Windows x64 application..."

	# Get the tunnel application name from product.json
	CLI_APP_NAME=$(cd "$DIST_DIR" && node -p "JSON.parse(require('fs').readFileSync('VSCode-win32-x64/resources/app/product.json')).tunnelApplicationName || 'code-tunnel'")

	# Create bin directory if it doesn't exist
	mkdir -p "$DIST_DIR/VSCode-win32-x64/bin"

	# Copy CLI binary to the application's bin directory
	cp "cli/target/x86_64-pc-windows-msvc/release/code.exe" "$DIST_DIR/VSCode-win32-x64/bin/$CLI_APP_NAME.exe"

	echo "CLI integrated as $CLI_APP_NAME.exe (x64)"

	echo "Integrating CLI into Windows arm64 application..."

	# Get the tunnel application name from product.json
	CLI_APP_NAME=$(cd "$DIST_DIR" && node -p "JSON.parse(require('fs').readFileSync('VSCode-win32-arm64/resources/app/product.json')).tunnelApplicationName || 'code-tunnel'")

	# Create bin directory if it doesn't exist
	mkdir -p "$DIST_DIR/VSCode-win32-arm64/bin"

	# Copy CLI binary to the application's bin directory
	cp "cli/target/aarch64-pc-windows-msvc/release/code.exe" "$DIST_DIR/VSCode-win32-arm64/bin/$CLI_APP_NAME.exe"

	echo "CLI integrated as $CLI_APP_NAME.exe (arm64)"

	# Create installers
	echo "Creating Windows installers..."

	# Build inno-updater for x64
	VSCODE_ARCH=x64 npm run gulp vscode-win32-x64-inno-updater

	# Build inno-updater for arm64
	VSCODE_ARCH=arm64 npm run gulp vscode-win32-arm64-inno-updater

	# Find makeappx.exe from Windows SDK
	MAKEAPPX=""
	SDK_BASE="/c/Program Files (x86)/Windows Kits/10/bin"
	if [ -d "$SDK_BASE" ]; then
		# Find the latest SDK version
		for sdk_dir in "$SDK_BASE"/10.0.*/x64; do
			if [ -f "$sdk_dir/makeappx.exe" ]; then
				MAKEAPPX="$sdk_dir/makeappx.exe"
			fi
		done
	fi

	# Prepare appx packages for Windows 11 integration (if makeappx is available)
	if [ -n "$MAKEAPPX" ]; then
		echo "Found makeappx at: $MAKEAPPX"
		echo "Preparing appx packages..."

		# For x64
		if [ -d "$DIST_DIR/VSCode-win32-x64/appx/manifest" ]; then
			"$MAKEAPPX" pack -d "$DIST_DIR/VSCode-win32-x64/appx/manifest" -p "$DIST_DIR/VSCode-win32-x64/appx/code_x64.appx" -nv
			rm -rf "$DIST_DIR/VSCode-win32-x64/appx/manifest"
		fi

		# For arm64
		if [ -d "$DIST_DIR/VSCode-win32-arm64/appx/manifest" ]; then
			"$MAKEAPPX" pack -d "$DIST_DIR/VSCode-win32-arm64/appx/manifest" -p "$DIST_DIR/VSCode-win32-arm64/appx/code_arm64.appx" -nv
			rm -rf "$DIST_DIR/VSCode-win32-arm64/appx/manifest"
		fi
	else
		echo "Error: makeappx.exe not found in Windows SDK."
		echo "Looked in: $SDK_BASE"
		echo "To create appx packages, ensure Windows SDK is installed with Visual Studio."
		echo "Continuing without appx packages..."

		exit 1
	fi

	# Copy explorer dlls to appx directories
	if [ -f ".build/win32/appx/code_explorer_command_x64.dll" ]; then
		cp ".build/win32/appx/code_explorer_command_x64.dll" "$DIST_DIR/VSCode-win32-x64/appx/"
	fi

	if [ -f ".build/win32/appx/code_explorer_command_arm64.dll" ]; then
		cp ".build/win32/appx/code_explorer_command_arm64.dll" "$DIST_DIR/VSCode-win32-arm64/appx/"
	fi

	# User installer for x64
	VSCODE_ARCH=x64 npm run gulp vscode-win32-x64-user-setup &

	# System installer for x64
	VSCODE_ARCH=x64 npm run gulp vscode-win32-x64-system-setup &

	# User installer for arm64
	VSCODE_ARCH=arm64 npm run gulp vscode-win32-arm64-user-setup &

	# System installer for arm64
	VSCODE_ARCH=arm64 npm run gulp vscode-win32-arm64-system-setup &

	WaitWithErrorPropagation "creating installers"

	# Create standalone CLI binary packages
	echo "Creating CLI binary packages..."

	# Create temporary directory for CLI packaging
	CLI_TEMP_DIR="$DIST_DIR/temp_cli_win32_x64"
	mkdir -p "$CLI_TEMP_DIR"

	# Copy CLI binary with Unbroken Code name
	cp "cli/target/x86_64-pc-windows-msvc/release/code.exe" "$CLI_TEMP_DIR/unbroken-code.exe"

	# Create zip package (use PowerShell on Windows, convert paths)
	WIN_CLI_TEMP_DIR=$(cygpath -w "$CLI_TEMP_DIR")
	WIN_ZIP_PATH=$(cygpath -w "$DIST_DIR/unbroken_code_cli_win32_x64_cli.zip")
	powershell -Command "Compress-Archive -Path '$WIN_CLI_TEMP_DIR\*' -DestinationPath '$WIN_ZIP_PATH' -Force"

	# Copy standalone binary
	cp "cli/target/x86_64-pc-windows-msvc/release/code.exe" "$DIST_DIR/unbroken-code-cli-win32-x64.exe"

	# Cleanup temp directory
	rm -rf "$CLI_TEMP_DIR"

	echo "Created unbroken_code_cli_win32_x64_cli.zip"

	# Create temporary directory for CLI packaging
	CLI_TEMP_DIR="$DIST_DIR/temp_cli_win32_arm64"
	mkdir -p "$CLI_TEMP_DIR"

	# Copy CLI binary with Unbroken Code name
	cp "cli/target/aarch64-pc-windows-msvc/release/code.exe" "$CLI_TEMP_DIR/unbroken-code.exe"

	# Create zip package (use PowerShell on Windows, convert paths)
	WIN_CLI_TEMP_DIR=$(cygpath -w "$CLI_TEMP_DIR")
	WIN_ZIP_PATH=$(cygpath -w "$DIST_DIR/unbroken_code_cli_win32_arm64_cli.zip")
	powershell -Command "Compress-Archive -Path '$WIN_CLI_TEMP_DIR\*' -DestinationPath '$WIN_ZIP_PATH' -Force"

	# Copy standalone binary
	cp "cli/target/aarch64-pc-windows-msvc/release/code.exe" "$DIST_DIR/unbroken-code-cli-win32-arm64.exe"

	# Cleanup temp directory
	rm -rf "$CLI_TEMP_DIR"

	echo "Created unbroken_code_cli_win32_arm64_cli.zip"

	if $SKIP_GULP_BUILD; then
		echo "Windows installers created successfully!"
	else
		echo "Windows binaries built successfully!"
	fi
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

	# Determine which architecture to build for
	CURRENT_ARCH=$(uname -m)
	if [ "$CURRENT_ARCH" = "aarch64" ]; then
		BUILD_ARCH="arm64"
	else
		BUILD_ARCH="x64"
	fi

	if ! $SKIP_GULP_BUILD; then
		# Build for current architecture (non-minified)
		echo "Building Linux $BUILD_ARCH (native)..."
		npm_config_arch=$BUILD_ARCH NPM_ARCH=$BUILD_ARCH VSCODE_ARCH=$BUILD_ARCH npm ci
		npm_config_arch=$BUILD_ARCH NPM_ARCH=$BUILD_ARCH VSCODE_ARCH=$BUILD_ARCH npm run gulp vscode-linux-$BUILD_ARCH
	fi

	# Build CLI for Linux
	echo "Building Linux CLI..."

	# Check if Rust is installed
	if ! command -v cargo &> /dev/null; then
		echo "Installing Rust for CLI build..."
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
		source "$HOME/.cargo/env"
	fi

	# Build CLI for current architecture
	echo "Building CLI for Linux $BUILD_ARCH..."

	if [ "$BUILD_ARCH" = "arm64" ]; then
		CLI_TARGET="aarch64-unknown-linux-gnu"
	else
		CLI_TARGET="x86_64-unknown-linux-gnu"
	fi

	rustup target add $CLI_TARGET
	(cd cli && cargo build --release --target $CLI_TARGET)

	# Integrate CLI into the main application (like VS Code does)
	echo "Integrating CLI into main application..."

	# Get the tunnel application name from product.json
	CLI_APP_NAME=$(node -p "require('$DIST_DIR/VSCode-linux-$BUILD_ARCH/resources/app/product.json').tunnelApplicationName || 'code-tunnel'")

	# Create bin directory if it doesn't exist
	mkdir -p "$DIST_DIR/VSCode-linux-$BUILD_ARCH/bin"

	# Copy CLI binary to the application's bin directory
	cp "cli/target/$CLI_TARGET/release/code" "$DIST_DIR/VSCode-linux-$BUILD_ARCH/bin/$CLI_APP_NAME"
	chmod +x "$DIST_DIR/VSCode-linux-$BUILD_ARCH/bin/$CLI_APP_NAME"

	echo "CLI integrated as $CLI_APP_NAME"

	# Create packages
	echo "Creating Linux packages..."

	# Build .deb packages
	if command -v dpkg-deb &> /dev/null; then
		echo "Building .deb package for $BUILD_ARCH..."

		# Prepare and build deb for current architecture
		VSCODE_ARCH=$BUILD_ARCH npm run gulp vscode-linux-$BUILD_ARCH-prepare-deb
		VSCODE_ARCH=$BUILD_ARCH npm run gulp vscode-linux-$BUILD_ARCH-build-deb

		echo "DEB package created successfully!"
	else
		echo "Skipping .deb package creation (dpkg-deb not found)"
	fi

	# Build .rpm packages
	if command -v rpmbuild &> /dev/null; then
		echo "Building .rpm package for $BUILD_ARCH..."

		# Prepare and build rpm for current architecture
		VSCODE_ARCH=$BUILD_ARCH npm run gulp vscode-linux-$BUILD_ARCH-prepare-rpm
		VSCODE_ARCH=$BUILD_ARCH npm run gulp vscode-linux-$BUILD_ARCH-build-rpm

		echo "RPM package created successfully!"
	else
		echo "Skipping .rpm package creation (rpmbuild not found)"
	fi

	# Create tar.gz archive for current architecture
	echo "Creating tar.gz archive for $BUILD_ARCH..."

	# Create archive with renamed folder for current architecture
	if [ -d "$DIST_DIR/VSCode-linux-$BUILD_ARCH" ]; then
		tar -czf "$DIST_DIR/UnbrokenCode-linux-$BUILD_ARCH.tar.gz" -C "$DIST_DIR" --transform "s/^VSCode-linux-$BUILD_ARCH/UnbrokenCode-linux-$BUILD_ARCH/" "VSCode-linux-$BUILD_ARCH"
		echo "Created UnbrokenCode-linux-$BUILD_ARCH.tar.gz"
	fi

	# Create standalone CLI binary package
	echo "Creating CLI binary package..."

	if [ "$BUILD_ARCH" = "arm64" ]; then
		CLI_TARGET="aarch64-unknown-linux-gnu"
	else
		CLI_TARGET="x86_64-unknown-linux-gnu"
	fi

	# Create temporary directory for CLI packaging
	CLI_TEMP_DIR="$DIST_DIR/temp_cli_linux_$BUILD_ARCH"
	mkdir -p "$CLI_TEMP_DIR"

	# Copy CLI binary with Unbroken Code name
	cp "cli/target/$CLI_TARGET/release/code" "$CLI_TEMP_DIR/unbroken-code"
	chmod +x "$CLI_TEMP_DIR/unbroken-code"

	# Create tar.gz package
	(cd "$CLI_TEMP_DIR" && tar -czf "$DIST_DIR/unbroken_code_cli_linux_${BUILD_ARCH}_cli.tar.gz" .)

	# Copy standalone binary
	cp "cli/target/$CLI_TARGET/release/code" "$DIST_DIR/unbroken-code-cli-linux-$BUILD_ARCH"

	# Cleanup temp directory
	rm -rf "$CLI_TEMP_DIR"

	echo "Created unbroken_code_cli_linux_${BUILD_ARCH}_cli.tar.gz"

	if $SKIP_GULP_BUILD; then
		echo "Linux packages created successfully!"
	else
		echo "Linux binaries and packages built successfully!"
	fi
}

function Build_macOS()
{
	DO_BUILD=true
	DO_SIGN=true
	DO_NOTARIZE=true

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

	# Check if Rust is installed
	if ! command -v cargo &> /dev/null; then
		echo "Installing Rust for CLI build..."
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
		source "$HOME/.cargo/env"
	fi

	# Add macOS targets
	rustup target add x86_64-apple-darwin
	rustup target add aarch64-apple-darwin

	# Build CLI for x64
	echo "Building CLI for macOS x64..."
	(cd cli && cargo build --release --target x86_64-apple-darwin)

	# Build CLI for arm64
	echo "Building CLI for macOS arm64..."
	(cd cli && cargo build --release --target aarch64-apple-darwin)

	# Build both architectures with the same date
	if $DO_BUILD; then
		# Set environment variable to build directly to .dist directory
		export VSCODE_BUILD_OUTPUT_DIR="$DIST_DIR"

		npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm ci --cpu x64
		npm_config_arch=x64 NPM_ARCH=x64 VSCODE_ARCH=x64 npm run gulp vscode-darwin-x64

		npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm ci --cpu arm64
		npm_config_arch=arm64 NPM_ARCH=arm64 VSCODE_ARCH=arm64 npm run gulp vscode-darwin-arm64

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
	fi

	# Integrate CLI into the main applications
	if true; then
		echo "Integrating CLI into macOS x64 application..."

		# Get the tunnel application name from product.json
		CLI_APP_NAME=$(node -p "require('$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/product.json').tunnelApplicationName || 'code-tunnel'")

		# Create bin directory if it doesn't exist
		mkdir -p "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/bin"

		# Copy CLI binary to the application's bin directory
		cp "cli/target/x86_64-apple-darwin/release/code" "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/bin/$CLI_APP_NAME"
		chmod +x "$DIST_DIR/VSCode-darwin-x64/Unbroken Code.app/Contents/Resources/app/bin/$CLI_APP_NAME"

		echo "CLI integrated as $CLI_APP_NAME (x64)"

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

	if true; then
		# Create standalone CLI binary packages
		echo "Creating CLI binary packages..."

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

	# Create universal binary (even when skipping gulp build)
	if true; then
		DEBUG="*" VSCODE_ARCH=universal node build/darwin/create-universal-app.js "$DIST_DIR"

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

	export CODESIGN_IDENTITY="E9944AF714BFA859585C2217AF833B286AB09E31"

	# Set the keychain profile for notarization
	export APPLE_KEYCHAIN_PROFILE="Unbroken Notary"

	# Sign all architectures
	if $DO_SIGN; then
		VSCODE_ARCH=arm64 node build/darwin/sign.js "$DIST_DIR" &
		VSCODE_ARCH=x64 node build/darwin/sign.js "$DIST_DIR" &
		VSCODE_ARCH=universal node build/darwin/sign.js "$DIST_DIR" &
		WaitWithErrorPropagation "signing macOS architectures"
	fi

	# Notarize and staple all architectures
	if $DO_NOTARIZE; then
		echo "Starting notarization process..."
		VSCODE_ARCH=arm64 node build/darwin/notarize.js "$DIST_DIR" &
		VSCODE_ARCH=x64 node build/darwin/notarize.js "$DIST_DIR" &
		VSCODE_ARCH=universal node build/darwin/notarize.js "$DIST_DIR" &
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
		Build_Windows &
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
else
	echo "Skipping build process (--skip-build flag set)"
fi

# Create GitHub release if --release flag is set
if $CREATE_RELEASE; then
	Create_GitHub_Release
fi

echo ""
echo "All tasks completed successfully!"
