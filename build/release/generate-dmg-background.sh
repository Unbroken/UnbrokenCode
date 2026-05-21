#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVG_FILE="$SCRIPT_DIR/dmg-background.svg"
PNG_FILE="$SCRIPT_DIR/dmg-background.png"
PNG_2X_FILE="$SCRIPT_DIR/dmg-background@2x.png"
TIFF_FILE="$SCRIPT_DIR/dmg-background.tiff"

echo "Generating DMG background images..."

# Check if we have a tool to convert SVG to PNG
if command -v rsvg-convert &> /dev/null; then
    echo "Using rsvg-convert..."
    rsvg-convert -w 600 -h 400 "$SVG_FILE" -o "$PNG_FILE"
    rsvg-convert -w 1200 -h 800 "$SVG_FILE" -o "$PNG_2X_FILE"
elif command -v convert &> /dev/null; then
    echo "Using ImageMagick convert..."
    convert -background none -density 72 -resize 600x400 "$SVG_FILE" "$PNG_FILE"
    convert -background none -density 144 -resize 1200x800 "$SVG_FILE" "$PNG_2X_FILE"
elif command -v qlmanage &> /dev/null; then
    echo "Using macOS qlmanage (quality may vary)..."
    qlmanage -t -s 600x400 -o "$SCRIPT_DIR" "$SVG_FILE" 2>/dev/null || true
    mv "$SCRIPT_DIR/dmg-background.svg.png" "$PNG_FILE" 2>/dev/null || true
else
    echo "Warning: No SVG to PNG converter found (rsvg-convert, ImageMagick, or qlmanage)"
    echo "Install one of these tools to generate the background image:"
    echo "  brew install librsvg    # Recommended"
    echo "  brew install imagemagick"
    
    # Create a simple placeholder PNG using macOS's sips if available
    if command -v sips &> /dev/null; then
        echo "Creating a simple placeholder background..."
        # Create a temporary white image
        printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x02X\x00\x00\x01\x90\x08\x02\x00\x00\x00\xb4\x95\xed\x92\x00\x00\x00\x01sRGB\x00\xae\xce\x1c\xe9\x00\x00\x00\x04gAMA\x00\x00\xb1\x8f\x0b\xfca\x05\x00\x00\x00\tpHYs\x00\x00\x0e\xc3\x00\x00\x0e\xc3\x01\xc7o\xa8d\x00\x00\x00\x19tEXtSoftware\x00www.inkscape.org\x9b\xee<\x1a\x00\x00\x00\x0eIDATx\xda\xed\xc1\x01\r\x00\x00\x00\xc2\xa0\xf7Om\x0e7\xa0\x00\x00\x00\x00\x00\x00\x00\x00\xbe\r!\x00\x00\x01\x9a`\xdd\xdd\x00\x00\x00\x00IEND\xaeB`\x82' > "$PNG_FILE.tmp"
        sips -z 400 600 "$PNG_FILE.tmp" --out "$PNG_FILE" 2>/dev/null || true
        rm -f "$PNG_FILE.tmp"
    fi
    
    exit 0
fi

if [ -f "$PNG_FILE" ]; then
    echo "✓ Generated: $PNG_FILE"
fi

if [ -f "$PNG_2X_FILE" ]; then
    echo "✓ Generated: $PNG_2X_FILE (Retina)"
fi

# Create multi-resolution TIFF for better macOS support
if [ -f "$PNG_FILE" ] && [ -f "$PNG_2X_FILE" ]; then
    echo "Creating multi-resolution TIFF..."
    
    # Use tiffutil to combine both resolutions into one file
    # The 72 DPI version goes first, then the 144 DPI version
    if command -v tiffutil &> /dev/null; then
        # First convert PNGs to TIFFs with proper DPI settings
        sips -s dpiHeight 72 -s dpiWidth 72 "$PNG_FILE" --out "$PNG_FILE.tiff" 2>/dev/null || true
        sips -s dpiHeight 144 -s dpiWidth 144 "$PNG_2X_FILE" --out "$PNG_2X_FILE.tiff" 2>/dev/null || true
        
        # Combine into multi-resolution TIFF
        tiffutil -catnosizecheck "$PNG_FILE.tiff" "$PNG_2X_FILE.tiff" -out "$TIFF_FILE" 2>/dev/null || true
        
        # Clean up temp files
        rm -f "$PNG_FILE.tiff" "$PNG_2X_FILE.tiff"
        
        if [ -f "$TIFF_FILE" ]; then
            echo "✓ Generated: $TIFF_FILE (Multi-resolution)"
        fi
    else
        echo "tiffutil not available, skipping multi-resolution TIFF creation"
    fi
fi

echo "DMG background generation complete!"