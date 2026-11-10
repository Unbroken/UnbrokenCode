/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getScreenCorners } from '../../electron-main/displayShapeMainService.js';

suite('DisplayShapeMainService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('reports the bottom corners as macOS rounds them, growing them to match rounded display corners', () => {
		function cornersOf(label: string, radii: { radius: number; bottomLeft: number; bottomRight: number } | undefined) {
			const { bottomLeft, bottomRight } = getScreenCorners(radii);
			return `${label}: left ${bottomLeft.radius}/${bottomLeft.reach}/${bottomLeft.baseRadius} right ${bottomRight.radius}/${bottomRight.reach}/${bottomRight.baseRadius}`;
		}

		// Radii as macOS 27 reports them for a window on a display with 37pt corners
		assert.deepStrictEqual([
			cornersOf('unknown', undefined),
			cornersOf('floating in the middle', { radius: 16, bottomLeft: 16, bottomRight: 16 }),
			cornersOf('30pt from the corner', { radius: 16, bottomLeft: 19.972973, bottomRight: 16 }),
			cornersOf('19pt from the corner', { radius: 16, bottomLeft: 26.216216, bottomRight: 16 }),
			cornersOf('in the corner', { radius: 16, bottomLeft: 37, bottomRight: 16 }),
			cornersOf('full screen', { radius: 0, bottomLeft: 37, bottomRight: 37 }),
		], [
			'unknown: left 0/0/0 right 0/0/0',
			'floating in the middle: left 16/24.46/16 right 16/24.46/16',
			'30pt from the corner: left 19.97/30.53/16 right 16/24.46/16',
			'19pt from the corner: left 26.22/40.08/16 right 16/24.46/16',
			'in the corner: left 37/56.56/16 right 16/24.46/16',
			'full screen: left 37/56.56/0 right 37/56.56/0',
		]);
	});
});
