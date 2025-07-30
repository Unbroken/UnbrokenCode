# Unbroken Fonts for Unbroken Code

This directory contains the Unbroken fonts shipped with Unbroken Code.

## Font Variants

### Unbroken
- `Unbroken-Regular.ttf` - Regular weight (400) for standard DPI displays
- `Unbroken-Bold.ttf` - Bold weight (700) for standard DPI displays
- `Unbroken-Italic.ttf` - Italic style for standard DPI displays
- `Unbroken-BoldItalic.ttf` - Bold italic for standard DPI displays

### Unbroken-Retina
- `Unbroken-Retina-Regular.ttf` - Regular weight (400) for high DPI displays
- `Unbroken-Retina-Bold.ttf` - Bold weight (700) for high DPI displays
- `Unbroken-Retina-Italic.ttf` - Italic style for high DPI displays
- `Unbroken-Retina-BoldItalic.ttf` - Bold italic for high DPI displays

### Unbroken12 (Future Use)
- `Unbroken12-Retina-Regular.ttf` - Regular weight (400)
- `Unbroken12-Retina-Bold.ttf` - Bold weight (700)
- `Unbroken12-Retina-Italic.ttf` - Italic style
- `Unbroken12-Retina-BoldItalic.ttf` - Bold italic

## DPI Detection

The font system automatically selects the appropriate variant based on display DPI:
- **Standard DPI (<2x)**: Uses `Unbroken` font files
- **High DPI (≥2x)**: Uses `Unbroken-Retina` font files (optimized for exactly 2x scaling)

This is handled through CSS media queries in `unbrokenFont.css`.

## Font Configuration

The font is configured as the default in:
- `/src/vs/editor/common/config/editorOptions.ts` - Editor font family defaults
- `/src/vs/base/browser/unbroken-font/unbrokenFont.css` - @font-face declarations with DPI media queries

The font family name used throughout the application is: `UnbrokenEmbedded`

This name is used to avoid conflicts with system-installed Unbroken fonts.

## License

See LICENSE file for font licensing information.
