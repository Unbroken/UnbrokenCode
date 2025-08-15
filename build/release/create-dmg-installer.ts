/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface DMGOptions {
	appPath: string;
	dmgPath: string;
	volumeName: string;
	backgroundImage?: string;
	windowWidth?: number;
	windowHeight?: number;
	iconSize?: number;
	appIconX?: number;
	appIconY?: number;
	applicationsIconX?: number;
	applicationsIconY?: number;
}

export function createDMGWithInstaller(options: DMGOptions): void {
	const {
		appPath,
		dmgPath,
		volumeName,
		backgroundImage,
		windowWidth = 600,
		windowHeight = 450,
		iconSize = 128,
		appIconX = 175,
		appIconY = 200,
		applicationsIconX = 425,
		applicationsIconY = 200
	} = options;

	console.log(`Creating enhanced DMG installer from ${appPath} to ${dmgPath}`);

	// Check for and unmount any existing volumes with the same name
	try {
		// First, try to unmount by volume name directly
		console.log(`Checking for existing volume: ${volumeName}`);
		execSync(`hdiutil detach "/Volumes/${volumeName}" -force`, { stdio: 'pipe' });
		console.log(`Unmounted existing volume: ${volumeName}`);
	} catch (error) {
		// Volume wasn't mounted, that's fine
	}
	
	// Also check for any mounted DMGs that might conflict
	try {
		const hdiutilInfo = execSync(`hdiutil info`, { encoding: 'utf8' });
		const lines = hdiutilInfo.split('\n');
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.includes(volumeName) || line.includes(dmgPath.split('/').pop() || '')) {
				// Found a potentially conflicting mount, try to get the device
				const deviceMatch = line.match(/\/dev\/disk(\d+)/);
				if (deviceMatch) {
					console.log(`Unmounting conflicting device: ${deviceMatch[0]}`);
					execSync(`hdiutil detach ${deviceMatch[0]} -force`, { stdio: 'pipe' });
				}
			}
		}
	} catch (error) {
		// Ignore errors from hdiutil info or detach
	}

	// Create a temporary directory for DMG contents
	const tempDir = dmgPath.replace('.dmg', '-dmg-temp');
	const tempDmg = dmgPath.replace('.dmg', '.temp.dmg');

	try {
		// Clean up any existing temp directory
		if (fs.existsSync(tempDir)) {
			execSync(`rm -rf "${tempDir}"`);
		}
		fs.mkdirSync(tempDir, { recursive: true });

		// Copy the app to temp directory
		const appName = path.basename(appPath);
		const tempAppPath = path.join(tempDir, appName);
		console.log(`Copying app to temporary directory...`);
		execSync(`cp -R "${appPath}" "${tempAppPath}"`);

		// Create Applications symlink
		const applicationsLink = path.join(tempDir, 'Applications');
		console.log(`Creating Applications symlink...`);
		execSync(`ln -s /Applications "${applicationsLink}"`);

		// Note: We'll copy the background image after mounting the DMG

		// Calculate required size (app size + overhead for background, etc.)
		const appStats = execSync(`du -sm "${tempAppPath}"`, { encoding: 'utf8' });
		const appSizeMB = parseInt(appStats.split('\t')[0]) || 500;
		const dmgSizeMB = Math.ceil(appSizeMB * 1.3) + 50; // 30% overhead + 50MB extra

		// Create DMG with calculated size
		console.log(`Creating DMG volume (${dmgSizeMB}MB)...`);
		execSync(`hdiutil create -volname "${volumeName}" -srcfolder "${tempDir}" -ov -format UDRW -size ${dmgSizeMB}m "${tempDmg}"`, {
			stdio: 'inherit'
		});

		// Mount the DMG
		console.log(`Mounting DMG for customization...`);
		const mountOutput = execSync(`hdiutil attach "${tempDmg}" -readwrite -noverify -noautoopen`, {
			encoding: 'utf8'
		});

		// Extract mount point from output
		const mountPoint = mountOutput.split('\t').pop()?.trim() || `/Volumes/${volumeName}`;

		try {
			// Wait for the volume to be fully mounted
			execSync('sleep 1');

			// Copy background image to mounted DMG if provided
			let hasBackground = false;
			let backgroundFilename = 'background.png';

			// Prefer TIFF for better Retina support, fallback to PNG
			const backgroundTiff = backgroundImage?.replace('.png', '.tiff');
			let sourceImage = backgroundImage;

			if (backgroundTiff && fs.existsSync(backgroundTiff)) {
				sourceImage = backgroundTiff;
				backgroundFilename = 'background.tiff';
				console.log(`Using multi-resolution TIFF background`);
			} else if (backgroundImage && fs.existsSync(backgroundImage)) {
				console.log(`Using PNG background`);
			}

			if (sourceImage && fs.existsSync(sourceImage)) {
				const bgDir = path.join(mountPoint, '.background');
				console.log(`Creating background directory in DMG...`);
				fs.mkdirSync(bgDir, { recursive: true });
				const destBgPath = path.join(bgDir, backgroundFilename);
				console.log(`Copying background image to DMG...`);
				fs.copyFileSync(sourceImage, destBgPath);
				hasBackground = true;
				console.log(`Background image copied to DMG`);
			}

			// Create AppleScript for DMG customization
			const appleScript = `
tell application "Finder"
	tell disk "${volumeName}"
		open
		set current view of container window to icon view
		set toolbar visible of container window to false
		set statusbar visible of container window to false
		set the bounds of container window to {100, 100, ${100 + windowWidth}, ${100 + windowHeight}}
		set viewOptions to the icon view options of container window
		set arrangement of viewOptions to not arranged
		set icon size of viewOptions to ${iconSize}
		set text size of viewOptions to 12
		${hasBackground ? `set background picture of viewOptions to file ".background:${backgroundFilename}"` : ''}

		-- Force text color for dark background
		try
			set label position of viewOptions to bottom
		end try

		-- Position the app icon
		set position of item "${appName}" of container window to {${appIconX}, ${appIconY}}

		-- Position the Applications symlink
		set position of item "Applications" of container window to {${applicationsIconX}, ${applicationsIconY}}

		-- Update and close
		update without registering applications
		delay 2
		close
	end tell
end tell
`;

			// Apply customization
			console.log(`Applying DMG customization...`);
			try {
				execSync(`osascript -e '${appleScript}'`, { stdio: 'inherit' });
			} catch (scriptError) {
				console.log(`Warning: Could not fully customize DMG window: ${scriptError}`);
				// Continue anyway - the DMG is still functional
			}

			// Hide background folder if it exists
			if (hasBackground) {
				try {
					execSync(`SetFile -a V "${mountPoint}/.background"`, { stdio: 'ignore' });
				} catch (e) {
					// SetFile might not be available, that's okay
				}
			}

			// Sync to ensure all changes are written
			execSync('sync');

		} finally {
			// Unmount the DMG
			console.log(`Unmounting DMG...`);
			execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: 'inherit' });
		}

		// Convert to compressed DMG
		console.log(`Compressing DMG...`);
		execSync(`hdiutil convert "${tempDmg}" -format UDZO -o "${dmgPath}" -ov`, {
			stdio: 'inherit'
		});

		console.log(`✓ Created enhanced DMG installer: ${dmgPath}`);

	} finally {
		// Clean up temp files
		if (fs.existsSync(tempDir)) {
			execSync(`rm -rf "${tempDir}"`);
		}
		if (fs.existsSync(tempDmg)) {
			fs.unlinkSync(tempDmg);
		}
	}
}

// Create a simple background image if none exists
export function createDefaultBackgroundImage(outputPath: string): void {
	console.log(`Creating default DMG background image...`);

	// Create a simple background using ImageMagick if available, otherwise skip
	try {
		// Check if ImageMagick is available
		execSync('which convert', { stdio: 'ignore' });

		// Create a gradient background with text
		const command = `convert -size 600x400 \\
			gradient:'#f0f0f0-#ffffff' \\
			-gravity North -pointsize 24 -fill '#333333' \\
			-annotate +0+30 'Unbroken Code' \\
			-gravity Center -pointsize 16 -fill '#666666' \\
			-annotate +0+120 'Drag Unbroken Code to Applications folder to install' \\
			"${outputPath}"`;

		execSync(command, { stdio: 'inherit' });
		console.log(`✓ Created background image: ${outputPath}`);
	} catch (error) {
		console.log(`ImageMagick not available, skipping background image creation`);
	}
}
