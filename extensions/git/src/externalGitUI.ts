/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const exists = promisify(fs.exists);
const stat = promisify(fs.stat);

/**
 * Find the git repository root by walking up from the given file path
 */
async function findGitRepositoryRoot(filePath: string): Promise<string | null> {
	let currentPath = path.dirname(filePath);

	// Walk up the directory tree
	while (true) {
		const gitDir = path.join(currentPath, '.git');

		try {
			const gitStat = await stat(gitDir);
			// .git can be either a directory or a file (for submodules/worktrees)
			if (gitStat.isDirectory() || gitStat.isFile()) {
				return currentPath;
			}
		} catch {
			// .git doesn't exist at this level, continue up
		}

		const parentPath = path.dirname(currentPath);
		// Reached the root of the filesystem
		if (parentPath === currentPath) {
			return null;
		}
		currentPath = parentPath;
	}
}

export enum ExternalGitUITool {
	SublimeMerge = 'sublimeMerge',
	Sourcetree = 'sourcetree',
	GitKraken = 'gitKraken',
	Tower = 'tower',
	GitHubDesktop = 'githubDesktop'
}

interface GitUIToolInfo {
	name: string;
	displayName: string;
	paths: {
		darwin?: string[];
		win32?: string[];
		linux?: string[];
	};
}

const TOOL_INFO: Record<ExternalGitUITool, GitUIToolInfo> = {
	[ExternalGitUITool.SublimeMerge]: {
		name: 'sublimeMerge',
		displayName: 'Sublime Merge',
		paths: {
			darwin: [
				'/Applications/Sublime Merge.app/Contents/SharedSupport/bin/smerge',
				'/Applications/Sublime Merge.app/Contents/MacOS/Sublime Merge'
			],
			win32: [
				path.join(process.env['LocalAppData'] || '', 'Programs', 'Sublime Merge', 'smerge.exe'),
				path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Sublime Merge', 'smerge.exe'),
				path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Sublime Merge', 'smerge.exe')
			],
			linux: [
				'/usr/bin/smerge',
				'/usr/local/bin/smerge'
			]
		}
	},
	[ExternalGitUITool.Sourcetree]: {
		name: 'sourcetree',
		displayName: 'Sourcetree',
		paths: {
			darwin: [
				'/Applications/Sourcetree.app/Contents/Resources/stree'
			],
			win32: [
				path.join(process.env['LocalAppData'] || '', 'SourceTree', 'SourceTree.exe'),
				path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Sourcetree', 'Sourcetree.exe'),
				path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Sourcetree', 'Sourcetree.exe')
			]
		}
	},
	[ExternalGitUITool.GitKraken]: {
		name: 'gitKraken',
		displayName: 'GitKraken',
		paths: {
			darwin: [
				'/Applications/GitKraken.app/Contents/Resources/bin/gitkraken.sh'
			],
			win32: [
				path.join(process.env['LocalAppData'] || '', 'gitkraken', 'bin', 'gitkraken.cmd'),
				path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'GitKraken', 'gitkraken', 'bin', 'gitkraken.cmd'),
				path.join(process.env['LocalAppData'] || '', 'gitkraken', 'GitKraken.exe'),
				path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'GitKraken', 'GitKraken.exe')
			],
			linux: [
				'/usr/bin/gitkraken',
				'/usr/local/bin/gitkraken',
				path.join(process.env['HOME'] || '', '.local', 'share', 'gitkraken', 'gitkraken')
			]
		}
	},
	[ExternalGitUITool.Tower]: {
		name: 'tower',
		displayName: 'Tower',
		paths: {
			darwin: [
				'/Applications/Tower.app/Contents/MacOS/gittower'
			]
		}
	},
	[ExternalGitUITool.GitHubDesktop]: {
		name: 'githubDesktop',
		displayName: 'GitHub Desktop',
		paths: {
			darwin: [
				'/Applications/GitHub Desktop.app/Contents/Resources/app/static/github.sh'
			],
			win32: [
				path.join(process.env['LocalAppData'] || '', 'GitHubDesktop', 'GitHubDesktop.exe')
			],
			linux: [
				'/usr/bin/github-desktop',
				'/usr/local/bin/github-desktop'
			]
		}
	}
};

export class ExternalGitUIManager {
	private detectedTools = new Map<ExternalGitUITool, string | null>();

	constructor() { }

	async isToolEnabled(tool: ExternalGitUITool): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('git');
		return config.get<boolean>(`externalGitUI.${tool}.enabled`, true);
	}

	async detectTool(tool: ExternalGitUITool): Promise<string | null> {
		// Check cache first
		if (this.detectedTools.has(tool)) {
			return this.detectedTools.get(tool) || null;
		}

		// Check if tool is enabled in settings
		if (!await this.isToolEnabled(tool)) {
			this.detectedTools.set(tool, null);
			return null;
		}

		// Check user-configured path
		const config = vscode.workspace.getConfiguration('git');
		const userPath = config.get<string>(`externalGitUI.${tool}.path`);
		if (userPath && await exists(userPath)) {
			this.detectedTools.set(tool, userPath);
			return userPath;
		}

		// Auto-detect based on platform
		const toolInfo = TOOL_INFO[tool];
		const platformPaths = toolInfo.paths[process.platform as 'darwin' | 'win32' | 'linux'];

		if (platformPaths) {
			for (const candidatePath of platformPaths) {
				if (candidatePath && await exists(candidatePath)) {
					this.detectedTools.set(tool, candidatePath);
					return candidatePath;
				}
			}
		}

		this.detectedTools.set(tool, null);
		return null;
	}

	async getFirstDetectedTool(): Promise<{ tool: ExternalGitUITool; path: string } | null> {
		// Detection order: Sublime Merge → Sourcetree → GitKraken → Tower
		const tools = [
			ExternalGitUITool.SublimeMerge,
			ExternalGitUITool.Sourcetree,
			ExternalGitUITool.GitKraken,
			ExternalGitUITool.Tower
		];

		for (const tool of tools) {
			const toolPath = await this.detectTool(tool);
			if (toolPath) {
				return { tool, path: toolPath };
			}
		}

		return null;
	}

	async getAllDetectedTools(): Promise<Array<{ tool: ExternalGitUITool; path: string }>> {
		const tools = [
			ExternalGitUITool.SublimeMerge,
			ExternalGitUITool.Sourcetree,
			ExternalGitUITool.GitKraken,
			ExternalGitUITool.Tower
		];

		const detected: Array<{ tool: ExternalGitUITool; path: string }> = [];

		for (const tool of tools) {
			const toolPath = await this.detectTool(tool);
			if (toolPath) {
				detected.push({ tool, path: toolPath });
			}
		}

		return detected;
	}

	getToolDisplayName(tool: ExternalGitUITool): string {
		return TOOL_INFO[tool].displayName;
	}

	clearCache(): void {
		this.detectedTools.clear();
	}

	async updateContextKeys(): Promise<void> {
		const tools = [
			ExternalGitUITool.SublimeMerge,
			ExternalGitUITool.Sourcetree,
			ExternalGitUITool.GitKraken,
			ExternalGitUITool.Tower,
			ExternalGitUITool.GitHubDesktop
		];

		for (const tool of tools) {
			const isInstalled = await this.detectTool(tool) !== null;
			await vscode.commands.executeCommand('setContext', `git.externalGitUI.${tool}.installed`, isInstalled);
		}
	}

	async findRepositoryRoot(filePath: string): Promise<string | null> {
		return findGitRepositoryRoot(filePath);
	}

	async openRepository(tool: ExternalGitUITool, repositoryPath: string): Promise<void> {
		const toolPath = await this.detectTool(tool);
		if (!toolPath) {
			throw new Error(`${this.getToolDisplayName(tool)} is not installed or not enabled`);
		}

		const { args, cwd } = this.getOpenRepositoryArgs(tool, repositoryPath, toolPath);
		this.launchTool(toolPath, args, cwd);
	}

	async openFileHistory(tool: ExternalGitUITool, repositoryPath: string, filePath: string): Promise<void> {
		const toolPath = await this.detectTool(tool);
		if (!toolPath) {
			throw new Error(`${this.getToolDisplayName(tool)} is not installed or not enabled`);
		}

		const { args, cwd } = this.getFileHistoryArgs(tool, repositoryPath, filePath);
		this.launchTool(toolPath, args, cwd);
	}

	async openLineHistory(tool: ExternalGitUITool, repositoryPath: string, filePath: string, startLine: number, endLine: number): Promise<void> {
		const toolPath = await this.detectTool(tool);
		if (!toolPath) {
			throw new Error(`${this.getToolDisplayName(tool)} is not installed or not enabled`);
		}

		const { args, cwd } = this.getLineHistoryArgs(tool, repositoryPath, filePath, startLine, endLine);
		this.launchTool(toolPath, args, cwd);
	}

	async openBlame(tool: ExternalGitUITool, repositoryPath: string, filePath: string, line: number): Promise<void> {
		const toolPath = await this.detectTool(tool);
		if (!toolPath) {
			throw new Error(`${this.getToolDisplayName(tool)} is not installed or not enabled`);
		}

		const { args, cwd } = this.getBlameArgs(tool, repositoryPath, filePath, line);
		this.launchTool(toolPath, args, cwd);
	}

	private escapeSublimeMergeSearchQuery(value: string): string {
		// Sublime Merge expects forward slashes even on Windows
		const normalizedPath = value.replace(/\\/g, '/');
		// Escape quotes for Sublime Merge search query syntax
		return normalizedPath.replace(/"/g, '\\"');
	}

	private getOpenRepositoryArgs(tool: ExternalGitUITool, repositoryPath: string, toolPath: string): { args: string[]; cwd: string } {
		let cwd = repositoryPath;

		// GitKraken on macOS needs to be launched from its Contents directory
		if (tool === ExternalGitUITool.GitKraken && process.platform === 'darwin' && toolPath.includes('GitKraken.app')) {
			cwd = toolPath.substring(0, toolPath.indexOf('GitKraken.app') + 'GitKraken.app/Contents'.length);
		}

		switch (tool) {
			case ExternalGitUITool.SublimeMerge:
				return { args: [repositoryPath], cwd };
			case ExternalGitUITool.Sourcetree:
				return { args: ['-f', repositoryPath], cwd };
			case ExternalGitUITool.GitKraken:
				return { args: ['-p', repositoryPath], cwd };
			case ExternalGitUITool.Tower:
				return { args: [repositoryPath], cwd };
			case ExternalGitUITool.GitHubDesktop:
				return { args: ['open', repositoryPath], cwd };
			default:
				throw new Error('Not supported');
		}
	}

	private getFileHistoryArgs(tool: ExternalGitUITool, repositoryPath: string, filePath: string): { args: string[]; cwd: string } {
		const cwd = repositoryPath;

		// Convert absolute path to relative path from repository root
		const relativePath = path.relative(repositoryPath, filePath);

		switch (tool) {
			case ExternalGitUITool.SublimeMerge: {
				// smerge search "file:<path>" <repo>
				const escapedPath = this.escapeSublimeMergeSearchQuery(relativePath);
				return { args: ['search', `file:"${escapedPath}"`], cwd };
			}
			default:
				throw new Error('Not supported');
		}
	}

	private getLineHistoryArgs(tool: ExternalGitUITool, repositoryPath: string, filePath: string, startLine: number, endLine: number): { args: string[]; cwd: string } {
		const cwd = repositoryPath;

		// Convert absolute path to relative path from repository root
		const relativePath = path.relative(repositoryPath, filePath);

		switch (tool) {
			case ExternalGitUITool.SublimeMerge: {
				// smerge search "file:<path> line:<start>-<end>" (with repo as CWD)
				// Line numbers are 1-based in Sublime Merge
				const escapedPath = this.escapeSublimeMergeSearchQuery(relativePath);
				return { args: ['search', `file:"${escapedPath}" line:${startLine + 1}-${endLine + 1}`], cwd };
			}
			default:
				throw new Error('Not supported');
		}
	}

	private getBlameArgs(tool: ExternalGitUITool, repositoryPath: string, filePath: string, line: number): { args: string[]; cwd: string } {
		const cwd = repositoryPath;

		// Convert absolute path to relative path from repository root
		const relativePath = path.relative(repositoryPath, filePath);

		switch (tool) {
			case ExternalGitUITool.SublimeMerge: {
				// smerge blame <file> [line]
				// Line numbers are 1-based in Sublime Merge
				// Sublime Merge expects forward slashes even on Windows
				const normalizedPath = relativePath.replace(/\\/g, '/');
				return { args: ['blame', normalizedPath, String(line + 1)], cwd };
			}
			default:
				throw new Error('Not supported');
		}
	}

	private launchTool(toolPath: string, args: string[], cwd: string): void {
		// If toolPath ends with .sh or .cmd, we need to launch it with bash/cmd
		let command = toolPath;
		let commandArgs = args;

		if (toolPath.endsWith('.sh')) {
			command = '/bin/bash';
			commandArgs = [toolPath, ...args];
		} else if (toolPath.endsWith('.cmd')) {
			command = 'cmd.exe';
			commandArgs = ['/c', toolPath, ...args];
		}

		const child = spawn(command, commandArgs, {
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			cwd
		});

		let stderr = '';
		let stdout = '';

		child.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('exit', (code) => {
			if (code !== 0 && code !== null) {
				const errorMessage = stderr || stdout || `Process exited with code ${code}`;
				throw new Error(`Failed to launch ${toolPath} ${args.join(' ')}: ${errorMessage}`);
			}
		});

		// Unref to allow the parent process to exit independently
		child.unref();
	}
}
