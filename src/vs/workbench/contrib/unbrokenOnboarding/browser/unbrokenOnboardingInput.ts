/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { IUntypedEditorInput } from '../../../common/editor.js';

export const unbrokenOnboardingInputTypeId = 'workbench.editors.unbrokenOnboardingInput';

export class UnbrokenOnboardingInput extends EditorInput {

	static readonly ID = unbrokenOnboardingInputTypeId;
	static readonly RESOURCE = URI.from({ scheme: Schemas.walkThrough, authority: 'unbroken_onboarding' });

	override get typeId(): string {
		return UnbrokenOnboardingInput.ID;
	}

	override get editorId(): string | undefined {
		return this.typeId;
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: UnbrokenOnboardingInput.RESOURCE,
			options: {
				override: UnbrokenOnboardingInput.ID,
				pinned: false
			}
		};
	}

	get resource(): URI | undefined {
		return UnbrokenOnboardingInput.RESOURCE;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}

		return other instanceof UnbrokenOnboardingInput;
	}

	constructor() {
		super();
	}

	override getName(): string {
		return localize('unbrokenOnboarding', "Unbroken Code Setup");
	}
}
