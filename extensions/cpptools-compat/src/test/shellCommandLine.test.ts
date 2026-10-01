/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import { buildShellCommandLine, findOutputPath } from '../shellCommandLine';

suite('buildShellCommandLine', () => {

	test('posix', () => {
		assert.deepStrictEqual([
			buildShellCommandLine('/usr/bin/clang++', ['-g', '/src/*.cpp', '-o', '/build dir/app'], 'darwin'),
			buildShellCommandLine('/usr/bin/clang++', ['"already quoted"', '-DNAME=\'a b\''], 'darwin'),
			buildShellCommandLine('g++', [{ value: 'a b', quoting: 'escape' }, { value: 'c d', quoting: 'weak' }], 'linux'),
			buildShellCommandLine('make -j8', [], 'linux'),
			buildShellCommandLine('/my tools/build.sh', [], 'linux', '${workspaceFolder}/build.sh'),
			buildShellCommandLine('g++', ['/tmp/John\'s project/main.cpp', '/tmp/John\'s/main.cpp'], 'linux'),
		], [
			'/usr/bin/clang++ -g /src/*.cpp -o \'/build dir/app\'',
			'/usr/bin/clang++ "already quoted" -DNAME=\'a b\'',
			'g++ a\\ b "c d"',
			'make -j8',
			'\'/my tools/build.sh\'',
			'g++ \'/tmp/John\'\\\'\'s project/main.cpp\' \'/tmp/John\'\\\'\'s/main.cpp\'',
		]);
	});

	test('windows', () => {
		assert.deepStrictEqual([
			buildShellCommandLine('cl.exe', ['/Zi', '/Fe${fileDirname}\\app.exe', 'C:\\src\\main.cpp'], 'win32'),
			buildShellCommandLine('C:\\Program Files\\LLVM\\bin\\clang++.exe', ['C:\\my src\\main.cpp'], 'win32'),
		], [
			'cmd /c chcp 65001>nul && cl.exe /Zi /Fe${fileDirname}\\app.exe C:\\src\\main.cpp',
			'cmd /c "chcp 65001>nul && "C:\\Program Files\\LLVM\\bin\\clang++.exe" "C:\\my src\\main.cpp""',
		]);
	});
});

suite('findOutputPath', () => {

	test('finds the output file', () => {
		assert.deepStrictEqual([
			findOutputPath(['-g', 'main.cpp', '-o', 'build/app'], 'linux'),
			findOutputPath(['/Zi', '/Febuild\\app.exe', 'main.cpp'], 'win32'),
			findOutputPath(['/link', '/OUT:build\\app.exe'], 'win32'),
			findOutputPath(['-c', 'main.cpp'], 'linux'),
			findOutputPath(['-o', '"build dir/app"'], 'linux'),
			findOutputPath(['/Fe"build dir\\app.exe"', 'main.cpp'], 'win32'),
			findOutputPath(['/Fe:build\\app.exe', 'main.cpp'], 'win32'),
		], [
			'build/app',
			'build\\app.exe',
			'build\\app.exe',
			undefined,
			'build dir/app',
			'build dir\\app.exe',
			'build\\app.exe',
		]);
	});
});
