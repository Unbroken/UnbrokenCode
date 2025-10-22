/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import Severity from '../../../base/common/severity.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface IMarkerReadOptions {
	owner?: string;
	resource?: URI;
	severities?: number;
	take?: number;
	ignoreResourceFilters?: boolean;
}

export interface IMarkerService {
	readonly _serviceBrand: undefined;

	getStatistics(): MarkerStatistics;

	changeOne(owner: string, resource: URI, markers: IMarkerData[]): void;

	changeAll(owner: string, data: IResourceMarker[]): void;

	remove(owner: string, resources: URI[]): void;

	read(filter?: IMarkerReadOptions): IMarker[];

	installResourceFilter(resource: URI, reason: string): IDisposable;

	readonly onMarkerChanged: Event<readonly URI[]>;
}

/**
 *
 */
export interface IRelatedInformation {
	resource: URI;
	message: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

export const enum MarkerTag {
	Unnecessary = 1,
	Deprecated = 2
}

export enum MarkerSeverity {
	Hint = 1,
	Info = 2,
	Warning = 4,
	Error = 8,
}

export namespace MarkerSeverity {

	export function compare(a: MarkerSeverity, b: MarkerSeverity): number {
		return b - a;
	}

	const _displayStrings: { [value: number]: string } = Object.create(null);
	_displayStrings[MarkerSeverity.Error] = localize('sev.error', "Error");
	_displayStrings[MarkerSeverity.Warning] = localize('sev.warning', "Warning");
	_displayStrings[MarkerSeverity.Info] = localize('sev.info', "Info");

	export function toString(a: MarkerSeverity): string {
		return _displayStrings[a] || '';
	}

	const _displayStringsPlural: { [value: number]: string } = Object.create(null);
	_displayStringsPlural[MarkerSeverity.Error] = localize('sev.errors', "Errors");
	_displayStringsPlural[MarkerSeverity.Warning] = localize('sev.warnings', "Warnings");
	_displayStringsPlural[MarkerSeverity.Info] = localize('sev.infos', "Infos");

	export function toStringPlural(a: MarkerSeverity): string {
		return _displayStringsPlural[a] || '';
	}

	export function fromSeverity(severity: Severity): MarkerSeverity {
		switch (severity) {
			case Severity.Error: return MarkerSeverity.Error;
			case Severity.Warning: return MarkerSeverity.Warning;
			case Severity.Info: return MarkerSeverity.Info;
			case Severity.Ignore: return MarkerSeverity.Hint;
		}
	}

	export function toSeverity(severity: MarkerSeverity): Severity {
		switch (severity) {
			case MarkerSeverity.Error: return Severity.Error;
			case MarkerSeverity.Warning: return Severity.Warning;
			case MarkerSeverity.Info: return Severity.Info;
			case MarkerSeverity.Hint: return Severity.Ignore;
		}
	}
}

/**
 * A structure defining a problem/warning/etc.
 */
export interface IMarkerData {
	code?: string | { value: string; target: URI };
	severity: MarkerSeverity;
	message: string;
	source?: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	sequenceNumber: number;
	resourceSequenceNumber: number;
	modelVersionId?: number;
	relatedInformation?: IRelatedInformation[];
	subProblems?: Array<{ category: string; problems: IResourceMarker[] }>;
	tags?: MarkerTag[];
	origin?: string | undefined;
}

export interface IResourceMarker {
	resource: URI;
	marker: IMarkerData;
}

export interface IMarker {
	owner: string;
	resource: URI;
	severity: MarkerSeverity;
	code?: string | { value: string; target: URI };
	message: string;
	source?: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	sequenceNumber: number;
	resourceSequenceNumber: number;
	modelVersionId?: number;
	relatedInformation?: IRelatedInformation[];
	subProblems?: Array<{ category: string; problems: IResourceMarker[] }>;
	tags?: MarkerTag[];
	origin?: string | undefined;
}

export interface MarkerStatistics {
	errors: number;
	warnings: number;
	infos: number;
	unknowns: number;
}

export namespace IMarkerData {
	const emptyString = '';
	export function makeKey(markerData: IMarkerData): string {
		return makeKeyOptionalMessage(markerData, true);
	}

	export function makeKeyOptionalMessage(markerData: IMarkerData, useMessage: boolean): string {
		const result: string[] = [emptyString];
		if (markerData.source) {
			result.push(markerData.source.replace('¦', '\\¦'));
		} else {
			result.push(emptyString);
		}
		if (markerData.code) {
			if (typeof markerData.code === 'string') {
				result.push(markerData.code.replace('¦', '\\¦'));
			} else {
				result.push(markerData.code.value.replace('¦', '\\¦'));
			}
		} else {
			result.push(emptyString);
		}
		if (markerData.severity !== undefined && markerData.severity !== null) {
			result.push(MarkerSeverity.toString(markerData.severity));
		} else {
			result.push(emptyString);
		}

		// Modifed to not include the message as part of the marker key to work around
		// https://github.com/microsoft/vscode/issues/77475
		if (markerData.message && useMessage) {
			result.push(markerData.message.replace('¦', '\\¦'));
		} else {
			result.push(emptyString);
		}
		if (markerData.startLineNumber !== undefined && markerData.startLineNumber !== null) {
			result.push(markerData.startLineNumber.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.startColumn !== undefined && markerData.startColumn !== null) {
			result.push(markerData.startColumn.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.endLineNumber !== undefined && markerData.endLineNumber !== null) {
			result.push(markerData.endLineNumber.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.endColumn !== undefined && markerData.endColumn !== null) {
			result.push(markerData.endColumn.toString());
		} else {
			result.push(emptyString);
		}
		result.push(emptyString);
		return result.join('¦');
	}

}

/**
 * Count the total number of sub-problems across all categories in a marker
 */
export function getSubProblemCount(markerData: IMarker): number {
	if (!markerData.subProblems) {
		return 0;
	}
	return markerData.subProblems.reduce((total, category) => total + category.problems.length, 0);
}

/**
 * Create a location-based key using resource and start position (end position may differ between sources)
 */
export function makeLocationKey(marker: IMarker): string {
	return `${marker.resource.toString()}:${marker.startLineNumber}:${marker.startColumn}`;
}

/**
 * Check if two marker messages are similar enough to be considered duplicates.
 * Uses fuzzy matching based on word overlap and substring matching.
 */
export function messagesAreSimilar(msg1: string, msg2: string): boolean {
	// Normalize messages
	const normalize = (msg: string) => msg.toLowerCase().trim().replace(/\s+/g, ' ');
	const norm1 = normalize(msg1);
	const norm2 = normalize(msg2);

	// Exact match after normalization
	if (norm1 === norm2) {
		return true;
	}

	// Extract meaningful words (alphanumeric sequences of 3+ chars)
	const extractWords = (msg: string) => {
		const words = msg.match(/\b\w{3,}\b/g) || [];
		return new Set(words);
	};

	const words1 = extractWords(norm1);
	const words2 = extractWords(norm2);

	if (words1.size === 0 && words2.size === 0) {
		return norm1 === norm2;
	}

	// Calculate word overlap
	let commonWords = 0;
	for (const word of words1) {
		if (words2.has(word)) {
			commonWords++;
		}
	}

	// Consider similar if they share at least 50% of words
	const minWords = Math.min(words1.size, words2.size);
	if (minWords === 0) {
		return false;
	}

	// Similar if: high overlap ratio OR one message is substring of other
	const overlapRatio = commonWords / minWords;
	const substringMatch = norm1.includes(norm2) || norm2.includes(norm1);

	return overlapRatio >= 0.5 || substringMatch;
}

/**
 * Deduplicate markers at the same location with similar messages.
 * Prefers markers with more subProblems when duplicates are found.
 */
export function deduplicateMarkers(markers: IMarker[]): IMarker[] {
	if (markers.length === 0) {
		return markers;
	}

	// Group markers by location
	const markersByLocation = new Map<string, IMarker[]>();
	for (const marker of markers) {
		const locationKey = makeLocationKey(marker);
		const existing = markersByLocation.get(locationKey);
		if (!existing) {
			markersByLocation.set(locationKey, [marker]);
		} else {
			existing.push(marker);
		}
	}

	// Deduplicate markers at the same location with similar messages
	const deduplicated: IMarker[] = [];
	for (const [, markersAtLocation] of markersByLocation) {
		if (markersAtLocation.length === 1) {
			// No duplicates at this location
			deduplicated.push(markersAtLocation[0]);
		} else {
			// Multiple markers at same location - check for similar messages
			const kept: IMarker[] = [];
			for (const marker of markersAtLocation) {
				let foundSimilar = false;
				for (let i = 0; i < kept.length; i++) {
					const existing = kept[i];
					if (messagesAreSimilar(marker.message, existing.message)) {
						// Similar messages - keep the one with more subProblems
						const markerSubProblems = getSubProblemCount(marker);
						const existingSubProblems = getSubProblemCount(existing);

						if (markerSubProblems > existingSubProblems) {
							// New marker has more subProblems, use it
							kept[i] = marker;
						} else if (markerSubProblems === existingSubProblems) {
							// Same number of subProblems - use deterministic ordering as tie-breaker
							// Compare by: owner, then resourceSequenceNumber, then sequenceNumber
							const ownerCompare = (marker.owner || '').localeCompare(existing.owner || '');

							if (ownerCompare !== 0) {
								// Different owners - keep the one that's lexicographically later
								if (ownerCompare > 0) {
									kept[i] = marker;
								}
							} else {
								// Same owner, compare by resourceSequenceNumber
								const markerRSeq = marker.resourceSequenceNumber || 0;
								const existingRSeq = existing.resourceSequenceNumber || 0;

								if (markerRSeq !== existingRSeq) {
									// Keep the one with higher resourceSequenceNumber (more recent)
									if (markerRSeq > existingRSeq) {
										kept[i] = marker;
									}
								} else {
									// Same resourceSequenceNumber, use sequenceNumber as final tie-breaker
									if (marker.sequenceNumber > existing.sequenceNumber) {
										kept[i] = marker;
									}
								}
							}
						}
						// If existing has more subProblems, keep existing (do nothing)

						foundSimilar = true;
						break;
					}
				}
				if (!foundSimilar) {
					kept.push(marker);
				}
			}
			deduplicated.push(...kept);
		}
	}

	return deduplicated;
}

export const IMarkerService = createDecorator<IMarkerService>('markerService');
