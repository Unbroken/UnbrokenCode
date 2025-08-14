#!/usr/bin/env bash
set -euo pipefail

# scripts/update-resources.sh
#
# Update all resource icons across platforms using a single source image.
# - Replaces Linux icon (resources/linux/code.png)
# - Generates server icons (resources/server/code-192.png, code-512.png, favicon.ico)
# - Updates Win32 ICO/PNG sizes (replaces files in resources/win32)
# - Updates Darwin .icns files by extracting iconsets, compositing a badge of
#   your main icon at the bottom-right of each icon size, and re-creating the .icns
#
# Requirements (macOS):
#   - sips (built-in)
#   - iconutil (Xcode command line tools: `xcode-select --install`)
#   - ImageMagick (for `convert` and `composite`) - install via Homebrew: `brew install imagemagick`
#
# Usage:
#   ./scripts/update-resources.sh [path/to/main.png]
# Defaults:
#   main PNG: resources/linux/code.png
#
# NOTE:
#   - The script modifies files under resources/. Make a git commit before running
#     so you can inspect/rollback changes if needed.
#   - iconutil extraction behavior: iconutil -x <icns> will create a "<name>.iconset"
#     directory next to the .icns file. If your system's iconutil differs, adjust
#     ICONUTIL_EXTRACT_CMD below.

MAIN_SRC="${1:-resources/linux/code.png}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$ROOT_DIR/resources"
DARWIN_DIR="$RESOURCES_DIR/darwin"
LINUX_DIR="$RESOURCES_DIR/linux"
SERVER_DIR="$RESOURCES_DIR/server"
WIN32_DIR="$RESOURCES_DIR/win32"

# Commands
command -v sips >/dev/null 2>&1 || { echo "sips not found. Run on macOS."; exit 1; }
command -v iconutil >/dev/null 2>&1 || { echo "iconutil not found. Install Xcode command line tools: xcode-select --install"; exit 1; }
command -v composite >/dev/null 2>&1 || { echo "ImageMagick 'composite' not found. Install: brew install imagemagick"; exit 1; }
command -v magick >/dev/null 2>&1 || { echo "ImageMagick 'magick' not found. Install: brew install imagemagick"; exit 1; }

if [ ! -f "$MAIN_SRC" ]; then
	echo "Source main icon not found: $MAIN_SRC"
	exit 1
fi

echo "Using main source: $MAIN_SRC"

# Image processing parameters for high-quality downsampling
# Lanczos filter provides sharp results, unsharp mask enhances edges,
# contrast-stretch improves overall contrast
# Filters go BEFORE -resize, post-processing goes AFTER
DOWNSAMPLE_FILTERSPO2="-filter box"
DOWNSAMPLE_FILTERS="-filter Lanczos"
POST_FILTERS="-unsharp 0x1 -contrast-stretch 0.5%x0.5%"
POST_FILTERS="-unsharp 1.5x1+0.7+0.02"

# normalize a working copy of the main image as 1024x1024 PNG
WORK_TMP="$(mktemp -d)"
MAIN_NORMAL="$WORK_TMP/main-1024.png"
# Use ImageMagick for initial normalization to maintain quality
cp "$MAIN_SRC" "$MAIN_NORMAL"

# Default badge scale (fraction of width). Shared by Windows/Darwin badge logic.
# Can be tuned; using a conservative default that works across icon sizes.
BADGE_SCALE=0.22

###############################################################################
# Linux
###############################################################################
echo "Updating Linux icon: $LINUX_DIR/code.png"
# Keep a high-resolution 1024x1024 source for packaging; downstream packaging will
# generate the smaller sizes (desktop/pixmaps) as needed.
LINUX_TARGET="$LINUX_DIR/code.png"
# Copy the normalized image (already 1024x1024)
cp "$MAIN_NORMAL" "$LINUX_TARGET"
echo " -> $LINUX_TARGET"

# Debian/appdata and snap use the file that the gulpfile renames; keep that source updated.
# Also update .desktop templates token substitution happens at build time.

###############################################################################
# Server icons (web)
###############################################################################
echo "Generating server icons: 192x192, 512x512 and favicon"
# Use ImageMagick with high-quality downsampling filters
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERS -resize 192x192 $POST_FILTERS "$SERVER_DIR/code-192.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 512x512 $POST_FILTERS "$SERVER_DIR/code-512.png"
# create favicon.ico containing 16x16, 32x32, 64x64 with high-quality filters
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 16x16 $POST_FILTERS "$WORK_TMP/favicon-16.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 32x32 $POST_FILTERS "$WORK_TMP/favicon-32.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 64x64 $POST_FILTERS "$WORK_TMP/favicon-64.png"
magick "$WORK_TMP/favicon-16.png" "$WORK_TMP/favicon-32.png" "$WORK_TMP/favicon-64.png" "$SERVER_DIR/favicon.ico"
rm "$WORK_TMP/favicon-"*.png
echo " -> $SERVER_DIR/code-192.png, $SERVER_DIR/code-512.png, $SERVER_DIR/favicon.ico"

###############################################################################
# Win32 resources
###############################################################################
echo "Updating Win32 icons (ICO/PNGs) in $WIN32_DIR"

# Create code.ico (main multi-size ico) from master image.
# sizes: 16,32,48,64,70,150,256
WIN_ICO_OUT="$WIN32_DIR/code.ico"
# Generate all sizes with high-quality filters
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 16x16 $POST_FILTERS "$WORK_TMP/win-16.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 32x32 $POST_FILTERS "$WORK_TMP/win-32.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 48x48 $POST_FILTERS "$WORK_TMP/win-48.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 64x64 $POST_FILTERS "$WORK_TMP/win-64.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERS -resize 150x150 $POST_FILTERS "$WORK_TMP/win-150.png"
magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 256x256 $POST_FILTERS "$WORK_TMP/win-256.png"
magick -background none "$WORK_TMP/win-16.png" "$WORK_TMP/win-32.png" "$WORK_TMP/win-48.png" "$WORK_TMP/win-64.png" "$WORK_TMP/win-150.png" "$WORK_TMP/win-256.png" "$WIN_ICO_OUT"
echo " -> $WIN_ICO_OUT"

# Update specific png variants if present with high-quality filters
for target in 70 150 512; do
	dst="$WIN32_DIR/code_${target}x${target}.png"
	if [ -f "$dst" ]; then
		magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERS -resize ${target}x${target} $POST_FILTERS "$dst"
		echo " -> updated $dst"
	fi
done

# Badge other .ico files (they currently have the small logo in the corner).
# For each ico except code.ico, extract frames, badge the largest frame, then create a new ico.
for ico in "$WIN32_DIR"/*.ico; do
	[ -e "$ico" ] || continue
	baseico="$(basename "$ico")"
	if [ "$baseico" = "code.ico" ]; then
		continue
	fi

	echo "Processing ICO: $ico"

	ICO_TMP_DIR="$WORK_TMP/ico_$(basename "$ico" .ico)"
	mkdir -p "$ICO_TMP_DIR"
	# Extract png frames from ico (ImageMagick)
	magick "$ico" "$ICO_TMP_DIR/frame-%d.png" >/dev/null 2>&1 || { echo "Failed to extract frames from $ico"; rm -rf "$ICO_TMP_DIR"; continue; }

	# Find largest frame by width
	LARGEST_FRAME=""
	LARGEST_W=0
	for f in "$ICO_TMP_DIR"/*.png; do
		w=$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/ {print $2}')
		if [ -n "$w" ] && [ "$w" -gt "$LARGEST_W" ]; then
			LARGEST_W=$w
			LARGEST_FRAME="$f"
		fi
	done

	if [ -z "$LARGEST_FRAME" ]; then
		echo "No frames for $ico, skipping"
		rm -rf "$ICO_TMP_DIR"
		continue
	fi

	# Create badge sized for largest frame using master image with high-quality filters
	BADGE_W=$(awk -v w="$LARGEST_W" -v s="$BADGE_SCALE" 'BEGIN{printf("%d", (w*s)+0.5)}')
	BADGE_TMP="$WORK_TMP/win-badge-${BADGE_W}.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERS -resize ${BADGE_W}x${BADGE_W} "$BADGE_TMP"

	PADX=+45
	PADY=+12

	# Composite badge onto largest frame
	BADGED_LARGE="$WORK_TMP/badged-ico-large.png"
	composite -gravity southeast -geometry ${PADX}${PADY} "$BADGE_TMP" "$LARGEST_FRAME" "$BADGED_LARGE"

	# For each frame, resize the badged large into the frame's size and replace it
	FRAME_FILES=()
	for f in "$ICO_TMP_DIR"/*.png; do
		FRAME_FILES+=("$f")
	done

	# Build list of resized images in order
	RESIZED_LIST=()
	for f in "${FRAME_FILES[@]}"; do
		tw=$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/ {print $2}')
		if [ -z "$tw" ]; then
			continue
		fi
		if [ "$tw" -eq "$LARGEST_W" ]; then
			cp "$BADGED_LARGE" "$f"
		else
			magick "$BADGED_LARGE" $DOWNSAMPLE_FILTERS -resize ${tw}x${tw} $POST_FILTERS "$f"
		fi
		RESIZED_LIST+=("$f")
	done

	# Recreate .ico from resized PNGs
	NEW_ICO="$WORK_TMP/$(basename "$ico")"
	# ImageMagick: supply all frames to convert to make an ICO
	magick -background none "${RESIZED_LIST[@]}" "$NEW_ICO" >/dev/null 2>&1 || { echo "Failed to create new ico for $ico"; rm -rf "$ICO_TMP_DIR"; rm -f "$NEW_ICO"; continue; }

	# Replace original ico
	if [ -f "$NEW_ICO" ]; then
		mv "$NEW_ICO" "$ico"
		echo " -> updated $ico"
	fi

	# cleanup
	rm -rf "$ICO_TMP_DIR" "$BADGE_TMP" "$BADGED_LARGE"
done

# Convert Inno installer BMPs (inno-big-*.bmp and inno-small-*.bmp) from the master image.
# Determine the target canvas size and place our scaled icon centered onto a white
# background (do not reuse the original image as background). Use ImageMagick for
# resizing/compositing to preserve full color and avoid quantization to grayscale.
for bmp in "$WIN32_DIR"/inno-big-*.bmp "$WIN32_DIR"/inno-small-*.bmp; do
	[ -e "$bmp" ] || continue
	echo "Processing installer bitmap: $bmp"

	# Query the existing bitmap for its pixel dimensions
	width=$(sips -g pixelWidth "$bmp" 2>/dev/null | awk '/pixelWidth/ {print $2}')
	height=$(sips -g pixelHeight "$bmp" 2>/dev/null | awk '/pixelHeight/ {print $2}')
	if [ -z "$width" ] || [ -z "$height" ]; then
		echo "Could not determine size for $bmp, skipping"
		continue
	fi

	echo "Generating BMP $bmp at ${width}x${height} (centered on white background)"

	# Determine maximum overlay size (fraction of the smaller canvas dimension).
	# Adjust OVERLAY_FRACTION if you want a larger/smaller centered icon.
	OVERLAY_FRACTION=0.8
	overlay_max=$(awk -v w="$width" -v h="$height" -v f="$OVERLAY_FRACTION" 'BEGIN{m=(w<h?w:h); printf("%d", int(m*f))}')

	# Use Imagemagick to resize the master image with high-quality filters
	SCALED_TMP="$WORK_TMP/bmp-overlay-$(basename "$bmp" .bmp).png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERS -resize "${overlay_max}x${overlay_max}" $POST_FILTERS -depth 8 -colorspace sRGB "$SCALED_TMP"

	# Create a white canvas matching the target BMP dimensions in sRGB, 8-bit depth.
	# Use PNG32 (true-color) to avoid ImageMagick producing a PseudoClass / grayscale image.
	BG_TMP="$WORK_TMP/bg-$(basename "$bmp" .bmp).png"
	magick -size "${width}x${height}" canvas:white -depth 8 -colorspace sRGB PNG32:"$BG_TMP"

	# Composite the scaled icon centered onto the white background using convert with -compose over
	TMP_OUT="$WORK_TMP/merged-$(basename "$bmp")"
	magick "$BG_TMP" "$SCALED_TMP" -gravity center -compose over -composite -depth 8 BMP3:"$TMP_OUT" >/dev/null 2>&1 || { echo "Failed to composite $bmp"; rm -f "$SCALED_TMP" "$TMP_OUT" "$BG_TMP" ; continue; }

	mv "$TMP_OUT" "$bmp"
	rm -f "$SCALED_TMP" "$BG_TMP"
	echo " -> updated $bmp"
done

###############################################################################
# Darwin: update each .icns by compositing main icon as a lower-right badge
###############################################################################
echo "Updating Darwin .icns files in $DARWIN_DIR"
# Parameters for overlay:
BADGE_SCALE=0.36   # badge takes ~36% of the icon width
BADGE_PADDING=8    # padding in pixels from bottom-right corner

# Create a full, unbadged macOS app icon for resources/darwin/code.icns from the main source.
# This will replace the existing code.icns with a complete icon generated directly
# from the master image (no corner badge).
CODE_ICNS="$DARWIN_DIR/code.icns"
if [ -f "$MAIN_NORMAL" ]; then
	echo "Generating full icon for $CODE_ICNS from main source"
	TMP_ICONSET="$WORK_TMP/code.iconset"
	rm -rf "$TMP_ICONSET"
	mkdir -p "$TMP_ICONSET"

	# produce all required sizes with high-quality downsampling filters
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 16x16 $POST_FILTERS "$TMP_ICONSET/icon_16x16.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 32x32 $POST_FILTERS "$TMP_ICONSET/icon_16x16@2x.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 32x32 $POST_FILTERS "$TMP_ICONSET/icon_32x32.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 64x64 $POST_FILTERS "$TMP_ICONSET/icon_32x32@2x.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 128x128 $POST_FILTERS "$TMP_ICONSET/icon_128x128.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 256x256 $POST_FILTERS "$TMP_ICONSET/icon_128x128@2x.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 256x256 $POST_FILTERS "$TMP_ICONSET/icon_256x256.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 512x512 $POST_FILTERS "$TMP_ICONSET/icon_256x256@2x.png"
	magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERSPO2 -resize 512x512 $POST_FILTERS "$TMP_ICONSET/icon_512x512.png"
	cp "$MAIN_NORMAL" "$TMP_ICONSET/icon_512x512@2x.png"

	# produce icns
	iconutil --convert icns "$TMP_ICONSET" -o "$WORK_TMP/code_full.icns" >/dev/null 2>&1 || { echo "iconutil failed to generate code.icns"; rm -rf "$TMP_ICONSET"; }
	if [ -f "$WORK_TMP/code_full.icns" ]; then
		mv "$WORK_TMP/code_full.icns" "$CODE_ICNS"
		echo " -> generated $CODE_ICNS"
	fi
	rm -rf "$TMP_ICONSET"
fi

# Iterate over remaining .icns files and badge them (skip the full code.icns)
for icns in "$DARWIN_DIR"/*.icns; do
	[ -e "$icns" ] || continue
	if [ "$(basename "$icns")" = "code.icns" ]; then
		# already generated above
		continue
	fi
	echo "Processing $icns"

	icns_basename="$(basename "$icns" .icns)"
	ICONSET_DIR="$WORK_TMP/${icns_basename}.iconset"

	# extract iconset: iconutil -x will write a folder next to the icns or in CWD;
	# use a safe extraction approach by copying the .icns into temp and extracting there
	cp "$icns" "$WORK_TMP/"
	TMP_ICNS_COPY="$WORK_TMP/$(basename "$icns")"
	pushd "$WORK_TMP" >/dev/null
	# Use explicit iconutil invocation to extract the .icns into a known directory.
	EXTRACT_DIR="$WORK_TMP/extracted_${icns_basename}.iconset"
	rm -rf "$EXTRACT_DIR"
	mkdir -p "$EXTRACT_DIR"
	# iconutil --convert iconset <input.icns> -o <output.iconset>
	iconutil --convert iconset "$TMP_ICNS_COPY" -o "$EXTRACT_DIR" || { echo "Failed to extract $TMP_ICNS_COPY via iconutil"; popd >/dev/null; continue; }
	EXTRACTED_ICONSET="$EXTRACT_DIR"
	if [ ! -d "$EXTRACTED_ICONSET" ]; then
		echo "No .iconset extracted for $icns, skipping"
		popd >/dev/null
		continue
	fi

	mkdir -p "$ICONSET_DIR"
	mv "$EXTRACTED_ICONSET"/* "$ICONSET_DIR"/
	popd >/dev/null

	# Badge only the largest icon once, then scale that result down to all other sizes.
	# Find the largest PNG (by pixel width) in the iconset.
	LARGEST_PNG=""
	LARGEST_W=0
	for p in "$ICONSET_DIR"/*.png; do
		w=$(sips -g pixelWidth "$p" | awk '/pixelWidth/ {print $2}')
		if [ -n "$w" ] && [ "$w" -gt "$LARGEST_W" ]; then
			LARGEST_W=$w
			LARGEST_PNG="$p"
		fi
	done

	if [ -z "$LARGEST_PNG" ]; then
		echo "No images in $ICONSET_DIR, skipping"
	else
		echo "Largest icon: $LARGEST_PNG ($LARGEST_W px)"

		# compute badge width and padding based on largest image
		badge_w=$(awk -v w="$LARGEST_W" -v s="$BADGE_SCALE" 'BEGIN{printf("%d", (w*s)+0.5)}')
		PADX=+18
		PADY=-7

		# create scaled badge from master image with high-quality filters
		BADGE_TMP="$WORK_TMP/badge-large-${badge_w}.png"
		magick "$MAIN_NORMAL" $DOWNSAMPLE_FILTERS -resize ${badge_w}x${badge_w} "$BADGE_TMP"

		# composite badge onto a copy of the largest image
		BADGED_LARGE="$WORK_TMP/badged-large.png"
		composite -gravity southeast -geometry ${PADX}${PADY} "$BADGE_TMP" "$LARGEST_PNG" "$BADGED_LARGE"

		# For every png in the iconset, scale the badged large image to the target size
		for png in "$ICONSET_DIR"/*.png; do
			tgt_w=$(sips -g pixelWidth "$png" | awk '/pixelWidth/ {print $2}')
			if [ -z "$tgt_w" ]; then
				echo "Could not determine width for $png, skipping"
				continue
			fi

			if [ "$tgt_w" -eq "$LARGEST_W" ]; then
				cp "$BADGED_LARGE" "$png"
			else
				magick "$BADGED_LARGE" $DOWNSAMPLE_FILTERS -resize ${tgt_w}x${tgt_w} $POST_FILTERS "$png"
			fi
		done

		# clean up per-icon temporary files for this iconset
		rm -f "$BADGE_TMP" "$BADGED_LARGE"
	fi

	# Recreate icns from the modified iconset
	# Ensure the output file has a .icns extension; iconutil rejects other extensions.
	NEW_ICNS_OUT="$WORK_TMP/${icns_basename}.new.icns"
	# iconutil --convert icns <iconset_dir> -o <output.icns>
	iconutil --convert icns "$ICONSET_DIR" -o "$NEW_ICNS_OUT"
	if [ -f "$NEW_ICNS_OUT" ]; then
		mv "$NEW_ICNS_OUT" "$icns"
		echo " -> updated $icns"
	else
		echo "Failed to create new icns for $icns"
	fi

done

###############################################################################
# Clean up
###############################################################################
rm -rf "$WORK_TMP"
echo "All resources updated. Please review changes and git-diff/commit."
