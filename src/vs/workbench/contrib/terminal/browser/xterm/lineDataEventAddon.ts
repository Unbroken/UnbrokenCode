/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import type { Terminal as XTermTerminal, IBuffer, ITerminalAddon } from '@xterm/xterm';

/**
 * Provides extensions to the xterm object in a modular, testable way.
 */
export class LineDataEventAddon extends Disposable implements ITerminalAddon {

	private _xterm?: XTermTerminal;
	private _isOsSet = false;
	private _lastCommitedLineIndex?: number;
	private _highestChangedLineIndex?: number;
	private _forceCommitTimer?: ReturnType<typeof setTimeout>;

	private readonly _onLineData = this._register(new Emitter<string>());
	readonly onLineData = this._onLineData.event;

	constructor(private readonly _initializationPromise?: Promise<void>) {
		super();
	}

	async activate(xterm: XTermTerminal) {
		this._xterm = xterm;

		// IMPORTANT: Instantiate the buffer namespace object here before it's disposed.
		const buffer = xterm.buffer;

		// If there is an initialization promise, wait for it before registering the event
		await this._initializationPromise;

		// Fire onLineData when a line feed occurs, taking into account wrapped lines
		this._register(xterm.onLineFeed(() => {
			const newLine = buffer.active.getLine(buffer.active.baseY + buffer.active.cursorY);
			if (newLine && !newLine.isWrapped) {
				this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY - 1);
			}
		}));

		// Fire onLineData when disposing object to flush last line
		this._register(toDisposable(() => {
			// Clear any pending timer
			if (this._forceCommitTimer) {
				clearTimeout(this._forceCommitTimer);
				this._forceCommitTimer = undefined;
			}
			this._sendLineDataImpl(buffer.active, buffer.active.baseY + buffer.active.cursorY, true);
		}));
	}

	setOperatingSystem(os: OperatingSystem) {
		if (this._isOsSet || !this._xterm) {
			return;
		}
		this._isOsSet = true;

		// Force line data to be sent when the cursor is moved, the main purpose for
		// this is because ConPTY will often not do a line feed but instead move the
		// cursor, in which case we still want to send the current line's data to tasks.
		if (os === OperatingSystem.Windows) {
			const xterm = this._xterm;
			this._register(xterm.parser.registerCsiHandler({ final: 'H' }, () => {
				const buffer = xterm.buffer;
				this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY);
				return false;
			}));
		}
	}

	/**
	 * Reset line tracking state. This should be called when the terminal buffer is cleared.
	 */
	reset(): void {
		// Flush any buffered data before resetting
		if (this._xterm && this._highestChangedLineIndex !== undefined) {
			const buffer = this._xterm.buffer;
			this._sendLineDataImpl(buffer.active, this._highestChangedLineIndex, true);
		}

		// Clear any pending force commit timer
		if (this._forceCommitTimer) {
			clearTimeout(this._forceCommitTimer);
			this._forceCommitTimer = undefined;
		}

		// Reset tracking indices
		this._lastCommitedLineIndex = undefined;
		this._highestChangedLineIndex = undefined;
	}

	private _sendLineData(buffer: IBuffer, lastLineIndex: number): void {
		this._highestChangedLineIndex = Math.max(this._highestChangedLineIndex || 0, lastLineIndex);
		this._sendLineDataImpl(buffer, lastLineIndex, false);
		this._scheduleForceCommit(buffer);
	}

	private _scheduleForceCommit(buffer: IBuffer): void {
		// Clear existing timer
		if (this._forceCommitTimer) {
			clearTimeout(this._forceCommitTimer);
		}

		// Schedule timer to force commit after 1000ms
		this._forceCommitTimer = setTimeout(() => {
			if (this._highestChangedLineIndex !== undefined) {
				this._sendLineDataImpl(buffer, this._highestChangedLineIndex, true);
			}
		}, 1000);
	}

	private _sendLineDataImpl(buffer: IBuffer, lastLineIndex: number, forceCommit: boolean): void {

		let lineIndex = 0;
		if (this._lastCommitedLineIndex !== undefined) {
			lineIndex = this._lastCommitedLineIndex + 1;
		}

		let line = buffer.getLine(lineIndex);

		while (!line && lineIndex <= lastLineIndex) {
			++lineIndex;
			line = buffer.getLine(lineIndex);
		}

		if (!line || lineIndex > lastLineIndex) {
			return;
		}

		const toCommitLineData: { data: string; lineIndex: number; startIndex: number }[] = [];

		let thisLineData: string | undefined = undefined;
		let thisLineStartIndex = 0;

		while (line && lineIndex <= lastLineIndex) {
			if (line.isWrapped) {
				const lineData = line.translateToString(false);
				if (thisLineData === undefined) {
					thisLineData = '';
					thisLineStartIndex = lineIndex;
				}
				thisLineData += lineData;
			} else {
				if (thisLineData !== undefined) {
					toCommitLineData.push({ data: thisLineData.trimEnd(), lineIndex: lineIndex - 1, startIndex: thisLineStartIndex });
				}

				const lineData = line.translateToString(false);
				thisLineData = lineData;
				thisLineStartIndex = lineIndex;
			}

			++lineIndex;
			line = buffer.getLine(lineIndex);
		}

		if (thisLineData !== undefined) {
			toCommitLineData.push({ data: thisLineData.trimEnd(), lineIndex: lineIndex - 1, startIndex: thisLineStartIndex });
		}

		let numToCommit = 0;
		if (forceCommit) {
			numToCommit = toCommitLineData.length;
		} else if (toCommitLineData.length > 1) {
			numToCommit = toCommitLineData.length;

			// Ignore all empty at the tail
			while (numToCommit > 0 && !toCommitLineData[numToCommit - 1].data) {
				--numToCommit;
			}

			// Ignore the last with value
			if (numToCommit) {
				--numToCommit;
			}
		}

		for (let commitIndex = 0; commitIndex < numToCommit; ++commitIndex) {
			const toCommit = toCommitLineData[commitIndex];

			this._lastCommitedLineIndex = toCommit.lineIndex;
			this._onLineData.fire(toCommit.data);
		}
	}
}
