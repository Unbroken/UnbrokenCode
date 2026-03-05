#!/usr/bin/env bash
# Clears cached Electron builds so the project picks up a new build.
#
# Caches cleared:
#   1. .build/electron/       - extracted Electron used for dev/packaging
#   2. ~/AppData/Local/electron/Cache/ (Windows) or
#      ~/.cache/electron/ (Linux) or
#      ~/Library/Caches/electron/ (macOS) - @electron/get download cache

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 1. Remove extracted Electron
ELECTRON_BUILD_DIR="$ROOT/.build/electron"
if [ -d "$ELECTRON_BUILD_DIR" ]; then
	echo "Removing $ELECTRON_BUILD_DIR"
	rm -rf "$ELECTRON_BUILD_DIR"
else
	echo "No extracted Electron found at $ELECTRON_BUILD_DIR"
fi

# 2. Remove @electron/get download cache
case "$(uname -s)" in
	MINGW*|MSYS*|CYGWIN*|Windows_NT)
		ELECTRON_CACHE="$LOCALAPPDATA/electron/Cache"
		[ -z "$ELECTRON_CACHE" ] && ELECTRON_CACHE="$HOME/AppData/Local/electron/Cache"
		;;
	Darwin*)
		ELECTRON_CACHE="$HOME/Library/Caches/electron"
		;;
	*)
		ELECTRON_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/electron"
		;;
esac

if [ -d "$ELECTRON_CACHE" ]; then
	echo "Removing $ELECTRON_CACHE"
	rm -rf "$ELECTRON_CACHE"
else
	echo "No Electron download cache found at $ELECTRON_CACHE"
fi

echo "Done. Run ./scripts/code.sh or ./scripts/code.bat to re-download Electron."
