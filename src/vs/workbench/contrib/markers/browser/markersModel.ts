/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isNonEmptyArray } from '../../../../base/common/arrays.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IMatch } from '../../../../base/common/filters.js';
import { hash } from '../../../../base/common/hash.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { basename, extUri } from '../../../../base/common/resources.js';
import { splitLines } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { IMarker, IMarkerData, IRelatedInformation, IResourceMarker, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { unsupportedSchemas } from '../../../../platform/markers/common/markerService.js';

export type MarkerElement = ResourceMarkers | Marker | RelatedInformation | SubProblem | Category;

export enum MarkerSortOrder {
	PositionAndSeverity = 'positionAndSeverity',
	OutputOrder = 'outputOrder'
}

export function compareMarkersByUri(a: IMarker, b: IMarker) {
	return extUri.compare(a.resource, b.resource);
}

function compareResourceMarkers(a: ResourceMarkers, b: ResourceMarkers): number {
	const [firstMarkerOfA] = a.markers;
	const [firstMarkerOfB] = b.markers;
	let res = 0;
	if (firstMarkerOfA && firstMarkerOfB) {
		res = MarkerSeverity.compare(firstMarkerOfA.marker.severity, firstMarkerOfB.marker.severity);
	}
	if (res === 0) {
		res = a.path.localeCompare(b.path) || a.name.localeCompare(b.name);
	}
	return res;
}

function compareResourceMarkersByOutputOrder(a: ResourceMarkers, b: ResourceMarkers): number {
	const [firstMarkerOfA] = a.markers;
	const [firstMarkerOfB] = b.markers;
	if (firstMarkerOfA && firstMarkerOfB) {
		// Compare by resource sequence number first
		const rseqA = firstMarkerOfA.marker.resourceSequenceNumber;
		const rseqB = firstMarkerOfB.marker.resourceSequenceNumber;
		if (rseqA !== rseqB) {
			return rseqA - rseqB;
		}
	}
	// Fallback to path comparison
	return a.path.localeCompare(b.path) || a.name.localeCompare(b.name);
}


export class ResourceMarkers {

	readonly path: string;

	readonly name: string;

	private _markersMap = new ResourceMap<Marker[]>();
	private _cachedMarkers: Marker[] | undefined;
	private _total: number = 0;

	constructor(readonly id: string, readonly resource: URI) {
		this.path = this.resource.fsPath;
		this.name = basename(this.resource);
	}

	get markers(): readonly Marker[] {
		if (!this._cachedMarkers) {
			this._cachedMarkers = [...this._markersMap.values()].flat().sort(ResourceMarkers._compareMarkers);
		}
		return this._cachedMarkers;
	}

	getMarkersSorted(sortOrder: MarkerSortOrder): readonly Marker[] {
		const allMarkers = [...this._markersMap.values()].flat();
		if (sortOrder === MarkerSortOrder.OutputOrder) {
			return allMarkers.sort(ResourceMarkers._compareMarkersByOutputOrder);
		}
		return allMarkers.sort(ResourceMarkers._compareMarkers);
	}

	has(uri: URI) {
		return this._markersMap.has(uri);
	}

	set(uri: URI, marker: Marker[]) {
		this.delete(uri);
		if (isNonEmptyArray(marker)) {
			this._markersMap.set(uri, marker);
			this._total += marker.length;
			this._cachedMarkers = undefined;
		}
	}

	delete(uri: URI) {
		const array = this._markersMap.get(uri);
		if (array) {
			this._total -= array.length;
			this._cachedMarkers = undefined;
			this._markersMap.delete(uri);
		}
	}

	get total() {
		return this._total;
	}

	private static _compareMarkers(a: Marker, b: Marker): number {
		return MarkerSeverity.compare(a.marker.severity, b.marker.severity)
			|| extUri.compare(a.resource, b.resource)
			|| Range.compareRangesUsingStarts(a.marker, b.marker);
	}

	private static _compareMarkersByOutputOrder(a: Marker, b: Marker): number {
		return a.marker.sequenceNumber - b.marker.sequenceNumber;
	}
}

export class Category {
	constructor(
		readonly id: string,
		readonly name: string,
		readonly problems: SubProblem[],
	) { }

	toString(): string {
		return JSON.stringify({
			category: this.name,
			problems: this.problems.length,
		}, null, '\t');
	}
}

export class SubProblem {
	get resource(): URI { return this.resourceMarker.resource; }
	get range(): IRange { return this.resourceMarker.marker; }

	private _lines: string[] | undefined;
	get lines(): string[] {
		if (!this._lines) {
			this._lines = splitLines(this.resourceMarker.marker.message);
		}
		return this._lines;
	}

	constructor(
		readonly id: string,
		readonly resourceMarker: IResourceMarker,
		readonly category: string,
	) { }

	toString(): string {
		return JSON.stringify({
			...this.resourceMarker.marker,
			resource: this.resourceMarker.resource.path,
			category: this.category
		}, null, '\t');
	}
}

export class Marker {

	get resource(): URI { return this.marker.resource; }
	get range(): IRange { return this.marker; }

	private _lines: string[] | undefined;
	get lines(): string[] {
		if (!this._lines) {
			this._lines = splitLines(this.marker.message);
		}
		return this._lines;
	}

	constructor(
		readonly id: string,
		readonly marker: IMarker,
		readonly relatedInformation: RelatedInformation[] = [],
		readonly categories: Category[] = [],
	) { }

	toString(): string {
		return JSON.stringify({
			...this.marker,
			resource: this.marker.resource.path,
			relatedInformation: this.relatedInformation.length ? this.relatedInformation.map(r => ({ ...r.raw, resource: r.raw.resource.path })) : undefined,
			categories: this.categories.length ? this.categories.map(c => ({
				name: c.name,
				problems: c.problems.map(p => ({
					resource: p.resource.path,
					marker: p.resourceMarker.marker
				}))
			})) : undefined
		}, null, '\t');
	}
}

export class MarkerTableItem extends Marker {
	constructor(
		marker: Marker,
		readonly sourceMatches?: IMatch[],
		readonly codeMatches?: IMatch[],
		readonly messageMatches?: IMatch[],
		readonly fileMatches?: IMatch[]
	) {
		super(marker.id, marker.marker, marker.relatedInformation, marker.categories);
	}
}

export class RelatedInformation {

	constructor(
		readonly id: string,
		readonly marker: IMarker,
		readonly raw: IRelatedInformation
	) { }
}

export interface MarkerChangesEvent {
	readonly added: Set<ResourceMarkers>;
	readonly removed: Set<ResourceMarkers>;
	readonly updated: Set<ResourceMarkers>;
}

export class MarkersModel {

	private cachedSortedResources: ResourceMarkers[] | undefined = undefined;
	private _sortOrder: MarkerSortOrder = MarkerSortOrder.PositionAndSeverity;

	private readonly _onDidChange = new Emitter<MarkerChangesEvent>();
	readonly onDidChange: Event<MarkerChangesEvent> = this._onDidChange.event;

	get resourceMarkers(): ResourceMarkers[] {
		if (!this.cachedSortedResources) {
			const compareFunc = this._sortOrder === MarkerSortOrder.OutputOrder
				? compareResourceMarkersByOutputOrder
				: compareResourceMarkers;
			this.cachedSortedResources = [...this.resourcesByUri.values()].sort(compareFunc);
		}
		return this.cachedSortedResources;
	}

	private resourcesByUri: Map<string, ResourceMarkers>;

	constructor() {
		this.resourcesByUri = new Map<string, ResourceMarkers>();
	}

	get sortOrder(): MarkerSortOrder {
		return this._sortOrder;
	}

	set sortOrder(order: MarkerSortOrder) {
		if (this._sortOrder !== order) {
			this._sortOrder = order;
			this.cachedSortedResources = undefined;
			// Force a full reset by marking all resources as removed and then added
			// This ensures the UI rebuilds with the new sort order
			const allResources = new Set<ResourceMarkers>(this.resourcesByUri.values());
			this._onDidChange.fire({
				added: allResources,
				removed: allResources,
				updated: new Set<ResourceMarkers>()
			});
		}
	}

	reset(): void {
		const removed = new Set<ResourceMarkers>();
		for (const resourceMarker of this.resourcesByUri.values()) {
			removed.add(resourceMarker);
		}
		this.resourcesByUri.clear();
		this._total = 0;
		this._onDidChange.fire({ removed, added: new Set<ResourceMarkers>(), updated: new Set<ResourceMarkers>() });
	}

	private _total: number = 0;
	get total(): number {
		return this._total;
	}

	getResourceMarkers(resource: URI): ResourceMarkers | null {
		return this.resourcesByUri.get(extUri.getComparisonKey(resource, true)) ?? null;
	}

	setResourceMarkers(resourcesMarkers: [URI, IMarker[]][]): void {
		const change: MarkerChangesEvent = { added: new Set(), removed: new Set(), updated: new Set() };
		for (const [resource, rawMarkers] of resourcesMarkers) {

			if (unsupportedSchemas.has(resource.scheme)) {
				continue;
			}

			const key = extUri.getComparisonKey(resource, true);
			let resourceMarkers = this.resourcesByUri.get(key);

			if (isNonEmptyArray(rawMarkers)) {
				// update, add
				if (!resourceMarkers) {
					const resourceMarkersId = this.id(resource.toString());
					resourceMarkers = new ResourceMarkers(resourceMarkersId, resource.with({ fragment: null }));
					this.resourcesByUri.set(key, resourceMarkers);
					change.added.add(resourceMarkers);
				} else {
					change.updated.add(resourceMarkers);
				}
				const markersCountByKey = new Map<string, number>();
				const markers = rawMarkers.map((rawMarker) => {
					const key = IMarkerData.makeKey(rawMarker);
					const index = markersCountByKey.get(key) || 0;
					markersCountByKey.set(key, index + 1);

					const markerId = this.id(resourceMarkers!.id, key, index, rawMarker.resource.toString());

					let relatedInformation: RelatedInformation[] | undefined = undefined;
					if (rawMarker.relatedInformation) {
						relatedInformation = rawMarker.relatedInformation.map((r, index) => new RelatedInformation(this.id(markerId, r.resource.toString(), r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn, index), rawMarker, r));
					}

					let categories: Category[] = [];
					if (rawMarker.subProblems && rawMarker.subProblems.length > 0) {
						categories = rawMarker.subProblems.map((categoryGroup, categoryIndex) => {
							const categoryId = this.id(markerId, 'category', categoryIndex);
							const subProblems = categoryGroup.problems.map((resourceMarker, index) => {
								const subProblemId = this.id(markerId, resourceMarker.resource.toString(), resourceMarker.marker.startLineNumber, resourceMarker.marker.startColumn, resourceMarker.marker.endLineNumber, resourceMarker.marker.endColumn, index, categoryGroup.category);
								return new SubProblem(subProblemId, resourceMarker, categoryGroup.category);
							});
							return new Category(categoryId, categoryGroup.category, subProblems);
						});
					}
					const marker = new Marker(markerId, rawMarker, relatedInformation, categories);

					return marker;
				});

				this._total -= resourceMarkers.total;
				resourceMarkers.set(resource, markers);
				this._total += resourceMarkers.total;

			} else if (resourceMarkers) {
				// clear
				this._total -= resourceMarkers.total;
				resourceMarkers.delete(resource);
				this._total += resourceMarkers.total;
				if (resourceMarkers.total === 0) {
					this.resourcesByUri.delete(key);
					change.removed.add(resourceMarkers);
				} else {
					change.updated.add(resourceMarkers);
				}
			}
		}

		this.cachedSortedResources = undefined;
		if (change.added.size || change.removed.size || change.updated.size) {
			this._onDidChange.fire(change);
		}
	}

	private id(...values: (string | number)[]): string {
		return `${hash(values)}`;
	}

	dispose(): void {
		this._onDidChange.dispose();
		this.resourcesByUri.clear();
	}
}
