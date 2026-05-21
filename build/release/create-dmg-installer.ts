/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Extracts the stderr text from an error thrown by `execSync`, regardless of
 * whether it was captured as a string or a Buffer.
 */
function getStderr(error: unknown): string {
	if (error && typeof error === 'object') {
		const stderr = (error as { stderr?: unknown }).stderr;
		if (stderr) {
			return stderr.toString();
		}
	}
	return '';
}

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
		const hdiutilInfo = execSync(`hdiutil info`, { encoding: 'utf8', stdio: 'pipe' });
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
			execSync(`rm -rf "${tempDir}"`, { stdio: 'pipe' });
		}
		fs.mkdirSync(tempDir, { recursive: true });

		// Copy the app to temp directory
		const appName = path.basename(appPath);
		const tempAppPath = path.join(tempDir, appName);
		console.log(`Copying app to temporary directory...`);
		execSync(`cp -R "${appPath}" "${tempAppPath}"`, { stdio: 'pipe' });

		// Create Applications symlink
		const applicationsLink = path.join(tempDir, 'Applications');
		console.log(`Creating Applications symlink...`);
		execSync(`ln -s /Applications "${applicationsLink}"`, { stdio: 'pipe' });

		// Note: We'll copy the background image after mounting the DMG

		// Calculate required size (app size + overhead for background, etc.)
		const appStats = execSync(`du -sm "${tempAppPath}"`, { encoding: 'utf8', stdio: 'pipe' });
		const appSizeMB = parseInt(appStats.split('\t')[0]) || 500;
		const dmgSizeMB = Math.ceil(appSizeMB * 1.3) + 50; // 30% overhead + 50MB extra

		// Prevent Spotlight from indexing the temp folder (can cause "Resource busy")
		try {
			execSync(`touch "${tempDir}/.metadata_never_index"`, { stdio: 'pipe' });
		} catch (e) {
			// Not critical if this fails
		}

		// Create DMG with calculated size, with retry logic for "Resource busy" errors
		// that occur intermittently on CI runners due to Spotlight or other system processes
		console.log(`Creating DMG volume (${dmgSizeMB}MB)...`);
		for (let attempt = 1; attempt <= 5; attempt++) {
			try {
				execSync(`hdiutil create -volname "${volumeName}" -srcfolder "${tempDir}" -ov -format UDRW -size ${dmgSizeMB}m "${tempDmg}"`, {
					stdio: 'pipe'
				});
				break;
			} catch (e) {
				if (attempt === 5) {
					throw e;
				}
				console.log(`hdiutil create attempt ${attempt} failed (Resource busy), retrying in ${attempt * 3}s...`);
				execSync(`sleep ${attempt * 3}`);
			}
		}

		// Mount the DMG
		console.log(`Mounting DMG for customization...`);
		const mountOutput = execSync(`hdiutil attach "${tempDmg}" -readwrite -noverify -noautoopen`, {
			encoding: 'utf8',
			stdio: 'pipe'
		});

		// Extract mount point from output
		const mountPoint = mountOutput.split('\t').pop()?.trim() || `/Volumes/${volumeName}`;

		let detachError: unknown;
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
	activate
	tell disk "${volumeName}"
		open

		activate
		delay 1

		set toolbar visible of container window to true
		set statusbar visible of container window to true
		set pathbar visible of container window to true

		delay 1
		tell application "System Events" to key code 17 using {command down, shift down}
		delay 1

		set toolbar visible of container window to false
		set statusbar visible of container window to false
		set pathbar visible of container window to false

		delay 1
		tell application "System Events" to key code 17 using {command down, shift down}
		delay 1

		set current view of container window to icon view
		set viewOptions to the icon view options of container window
		set icon size of viewOptions to ${iconSize}
		set text size of viewOptions to 12
		set arrangement of viewOptions to not arranged
		set the bounds of container window to {100, 100, ${100 + windowWidth}, ${100 + windowHeight}}

		delay 1

		${hasBackground ? `set background picture of viewOptions to file ".background:${backgroundFilename}"` : ''}

		set position of item "${appName}" of container window to {${appIconX}, ${appIconY}}
		set position of item "Applications" of container window to {${applicationsIconX}, ${applicationsIconY}}

		delay 2

		update without registering applications

		delay 2

		close
	end tell
end tell
`;

			// Apply customization
			console.log(`Applying DMG customization...`);
			try {
				execSync(`osascript -e '${appleScript}'`, { stdio: 'pipe' });
			} catch (scriptError) {
				console.log(`Warning: Could not fully customize DMG window: ${scriptError}`);
				throw scriptError;
			}

			// Hide background folder if it exists
			if (hasBackground) {
				try {
					execSync(`SetFile -a V "${mountPoint}/.background"`, { stdio: 'pipe' });
				} catch (e) {
					// SetFile might not be available, that's okay
				}
			}

			// Sync to ensure all changes are written
			execSync('sync', { stdio: 'pipe' });

		} finally {
			// Close any Finder windows for this volume to release file handles
			try {
				execSync(`osascript -e 'tell application "Finder" to close every window whose name contains "${volumeName}"'`, { stdio: 'pipe' });
				execSync('sleep 2');
			} catch (e) {
				// Finder might not be running, that's okay
			}

			// Unmount the DMG with retry logic to handle "Resource busy" errors
			// Never throw from finally - track failure and throw after the block
			console.log(`Unmounting DMG...`);
			detachError = undefined;
			for (let attempt = 1; attempt <= 5; attempt++) {
				// If the volume is no longer mounted, a previous force-detach already
				// took effect (a deferred unmount that completed once the busy resource
				// was released), so there is nothing left to detach.
				if (!fs.existsSync(mountPoint)) {
					detachError = undefined;
					break;
				}
				try {
					execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: 'pipe' });
					detachError = undefined;
					break;
				} catch (e) {
					// "No such file or directory" (or the mount point disappearing) means
					// the volume is already gone, so the detach effectively succeeded.
					if (!fs.existsSync(mountPoint) || getStderr(e).includes('No such file or directory')) {
						detachError = undefined;
						break;
					}
					detachError = e;
					if (attempt < 5) {
						console.log(`Detach attempt ${attempt} failed, retrying in ${attempt * 2}s...`);
						execSync(`sleep ${attempt * 2}`);
					}
				}
			}
		}

		if (detachError) {
			throw detachError;
		}

		// The image can remain briefly busy after detach completes on CI runners.
		// Retry compression while preserving the customized source image.
		console.log(`Compressing DMG...`);
		for (let attempt = 1; attempt <= 5; attempt++) {
			try {
				execSync(`hdiutil convert "${tempDmg}" -format UDZO -o "${dmgPath}" -ov`, {
					stdio: 'pipe'
				});
				break;
			} catch (error) {
				const stderr = getStderr(error);
				if (attempt === 5 || !/Resource (?:temporarily unavailable|busy)/i.test(stderr)) {
					throw error;
				}
				console.log(`hdiutil convert attempt ${attempt} failed (${stderr.trim()}), retrying in ${attempt * 3}s...`);
				execSync(`sleep ${attempt * 3}`);
			}
		}

		console.log(`✓ Created enhanced DMG installer: ${dmgPath}`);

	} finally {
		// Clean up temp files
		if (fs.existsSync(tempDir)) {
			execSync(`rm -rf "${tempDir}"`, { stdio: 'pipe' });
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
