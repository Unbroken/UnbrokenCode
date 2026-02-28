/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { IUntypedEditorInput } from '../../../common/editor.js';

export const unbrokenMigrationInputTypeId = 'workbench.editors.unbrokenMigrationInput';

export class UnbrokenMigrationInput extends EditorInput {

	static readonly ID = unbrokenMigrationInputTypeId;
	static readonly RESOURCE = URI.from({ scheme: Schemas.walkThrough, authority: 'unbroken_migration' });

	override get typeId(): string {
		return UnbrokenMigrationInput.ID;
	}

	override get editorId(): string | undefined {
		return this.typeId;
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: UnbrokenMigrationInput.RESOURCE,
			options: {
				override: UnbrokenMigrationInput.ID,
				pinned: false
			}
		};
	}

	get resource(): URI | undefined {
		return UnbrokenMigrationInput.RESOURCE;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}

		return other instanceof UnbrokenMigrationInput;
	}

	constructor() {
		super();
	}

	override getName(): string {
		return localize('unbrokenMigration', "Command Line Name Change");
	}
}
