/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { MarkerService } from '../../../../platform/markers/common/markerService.js';

/**
 * Marker service that resolves symlinks via the file service so that markers
 * reported against different paths of the same file are deduplicated.
 */
export class WorkbenchMarkerService extends MarkerService {

	constructor(
		@IFileService private readonly _fileService: IFileService
	) {
		super();
	}

	protected override _resolveCanonicalResource(resource: URI): Promise<URI | undefined> | undefined {
		return this._fileService.realpath(resource);
	}
}
