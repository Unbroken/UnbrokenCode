/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';

interface ConfigurationState {
	existed: boolean;
	value: unknown;
}

// Singleton service to manage temporary configuration overrides for preview features
// All setting and restoration logic is centralized here to prevent race conditions
export class ConfigurationOverrideManager {
	private static readonly CONFIG_STATE_STORAGE_KEY = 'unbrokenOnboarding.configOverrideState';
	private static instance: ConfigurationOverrideManager | undefined;

	private originalStates: Map<string, ConfigurationState> = new Map();
	private hasSavedOriginalState = false;

	// Semaphore to synchronize all configuration operations
	private configOperationLock: Promise<void> = Promise.resolve();

	/**
	 * Acquire the lock and execute an operation, ensuring all config operations are serialized
	 */
	private async withLock<T>(operation: () => Promise<T>): Promise<T> {
		// Chain this operation after the previous one completes
		const previousOperation = this.configOperationLock;
		let resolveThis: () => void;
		this.configOperationLock = new Promise(resolve => {
			resolveThis = resolve;
		});

		try {
			// Wait for previous operation to complete
			await previousOperation;
			// Execute this operation
			return await operation();
		} finally {
			// Release the lock for next operation
			resolveThis!();
		}
	}

	private constructor(
		private readonly storageService: IStorageService,
		private readonly configurationService: IConfigurationService,
		private readonly lifecycleService: ILifecycleService
	) {
		this.restoreConfigurationStateOnStartup();
	}

	static getInstance(
		storageService: IStorageService,
		configurationService: IConfigurationService,
		lifecycleService: ILifecycleService
	): ConfigurationOverrideManager {
		if (!this.instance) {
			this.instance = new ConfigurationOverrideManager(storageService, configurationService, lifecycleService);
		}
		return this.instance;
	}

	private async restoreConfigurationStateOnStartup(): Promise<void> {
		// Wait for the workbench to be restored before checking configuration
		await this.lifecycleService.when(LifecyclePhase.Restored);

		await this.withLock(async () => {
			const savedState = this.storageService.get(ConfigurationOverrideManager.CONFIG_STATE_STORAGE_KEY, StorageScope.APPLICATION);
			if (savedState) {
				try {
					const states: Record<string, ConfigurationState> = JSON.parse(savedState);

					// Store the original states so we know what to restore later
					for (const [key, state] of Object.entries(states)) {
						this.originalStates.set(key, state);
					}
					this.hasSavedOriginalState = true;

					// Restore the previous configurations
					for (const [key, state] of Object.entries(states)) {
						const valueToRestore = state.existed ? state.value : undefined;
						await this.configurationService.updateValue(key, valueToRestore, ConfigurationTarget.USER);
					}
				} catch (error) {
					// Invalid state, just ignore
				} finally {
					// Always remove the saved state after attempting to restore
					this.storageService.remove(ConfigurationOverrideManager.CONFIG_STATE_STORAGE_KEY, StorageScope.APPLICATION);
				}
			}
		});
	}

	async enableForPreview(extensionService: IExtensionService, configs: Record<string, unknown>): Promise<void> {
		// Wait for startup restoration to complete first

		await this.withLock(async () => {
			// Save the original state ONCE before any override
			if (!this.hasSavedOriginalState) {
				for (const key of Object.keys(configs)) {
					const inspected = this.configurationService.inspect(key);
					this.originalStates.set(key, {
						existed: inspected.userValue !== undefined,
						value: inspected.userValue
					});
				}
				this.hasSavedOriginalState = true;
			}

			// Wait for extensions to be ready
			await extensionService.whenInstalledExtensionsRegistered();

			// Use a small delay to ensure configuration is fully registered
			await new Promise(resolve => setTimeout(resolve, 100));

			try {
				// Apply all configuration overrides
				for (const [key, value] of Object.entries(configs)) {
					await this.configurationService.updateValue(key, value, ConfigurationTarget.USER);
				}
				// Save state to persistent storage in case of unclean shutdown
				this.saveConfigurationState();
			} catch (error) {
				console.error('Failed to enable configuration overrides for preview:', error);
			}
		});
	}

	async restoreOriginalConfiguration(): Promise<void> {
		await this.withLock(async () => {
			// Only restore if we have saved original state to restore
			// This makes the method idempotent - can be called multiple times safely
			if (!this.hasSavedOriginalState) {
				return;
			}

			// Restore all original values
			for (const [key, state] of this.originalStates.entries()) {
				const valueToRestore = state.existed ? state.value : undefined;
				try {
					await this.configurationService.updateValue(key, valueToRestore, ConfigurationTarget.USER);
				} catch (error) {
					// Silently ignore errors
				}
			}

			// Clean up saved state and reset flag
			this.storageService.remove(ConfigurationOverrideManager.CONFIG_STATE_STORAGE_KEY, StorageScope.APPLICATION);
			this.hasSavedOriginalState = false;
			this.originalStates.clear();
		});
	}

	private saveConfigurationState(): void {
		// Save the original states to persistent storage in case of unclean shutdown
		const states: Record<string, ConfigurationState> = {};
		for (const [key, state] of this.originalStates.entries()) {
			states[key] = state;
		}
		this.storageService.store(ConfigurationOverrideManager.CONFIG_STATE_STORAGE_KEY, JSON.stringify(states), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
