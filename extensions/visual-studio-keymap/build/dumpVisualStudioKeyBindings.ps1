# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
# ---------------------------------------------------------------------------------------------

# Dumps the keyboard mapping schemes of an installed Visual Studio to schemes/<scheme>.json.
#
# For each scheme, Visual Studio is started without UI (/Embedding) with an isolated settings root
# (/RootSuffix) and /ResetSettings with a settings file selecting that scheme, so the user's own
# Visual Studio settings are never touched. The script attaches to the instance through automation (DTE) and
# records every command's key bindings as "Scope::Keys" strings, in Visual Studio's order.
#
# Changing the scheme through automation (Tools > Options > Environment > Keyboard > SchemeName)
# or importing settings shows dialogs, which block automation without a visible desktop.
#
# Usage (Windows PowerShell): powershell -File dumpVisualStudioKeyBindings.ps1 [-VersionRange '[17.0,18.0)']
# Then run: node build/generate.mts

param(
	[string]$VersionRange = '[17.0,18.0)',
	[string]$OutputDirectory = (Join-Path $PSScriptRoot 'schemes'),
	[string]$RootSuffix = 'VsKeymapDump',
	[int]$StartTimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'

# Scheme id => Visual Studio keyboard mapping scheme name. The Default scheme has an empty name.
$schemes = [ordered]@{
	visualStudio = ''
	visualCpp6 = 'Visual C++ 6'
	visualCSharp2005 = 'Visual C# 2005'
	visualBasic6 = 'Visual Basic 6'
	visualCpp2 = 'Visual C++ 2'
	visualStudio6 = 'Visual Studio 6'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

// Finds the automation object a Visual Studio process registers in the running object table.
public static class RunningObjects {
	[DllImport("ole32.dll")] private static extern int GetRunningObjectTable(int reserved, out IRunningObjectTable table);
	[DllImport("ole32.dll")] private static extern int CreateBindCtx(int reserved, out IBindCtx context);

	public static object Find(string displayName) {
		IRunningObjectTable table;
		IEnumMoniker monikers;
		IBindCtx context;
		GetRunningObjectTable(0, out table);
		CreateBindCtx(0, out context);
		table.EnumRunning(out monikers);
		IMoniker[] moniker = new IMoniker[1];
		while (monikers.Next(1, moniker, IntPtr.Zero) == 0) {
			string name;
			moniker[0].GetDisplayName(context, null, out name);
			if (name == displayName) {
				object result;
				table.GetObject(moniker[0], out result);
				return result;
			}
		}
		return null;
	}
}
'@

function Get-KeyBindings($Dte) {
	$bindings = @{}
	foreach ($command in $Dte.Commands) {
		$name = $command.Name
		if (-not $name) {
			continue
		}
		try {
			$commandBindings = @($command.Bindings | Where-Object { $_ })
		} catch {
			continue
		}
		if ($commandBindings.Count -gt 0) {
			# Keep Visual Studio's order: the first binding is the one shown in menus
			$bindings[$name] = @($commandBindings | Select-Object -Unique)
		}
	}
	$sorted = [ordered]@{}
	foreach ($name in ($bindings.Keys | Sort-Object -CaseSensitive)) {
		$sorted[$name] = $bindings[$name]
	}
	return $sorted
}

function New-SchemeSettings([string]$Path, [string]$Version, [string]$SchemeName) {
	$schemeElement = if ($SchemeName) { "<ShortcutsScheme>$([System.Security.SecurityElement]::Escape($SchemeName))</ShortcutsScheme>" } else { '<ShortcutsScheme/>' }
	$xml = "<UserSettings><ApplicationIdentity version=`"$Version`"/><Category name=`"Environment_Group`" RegisteredName=`"Environment_Group`">" +
		'<Category name="Environment_KeyBindings" Category="{F09035F1-80D2-4312-8EC4-4D354A4BCB4C}" Package="{DA9FB551-C724-11d0-AE1F-00A0C90FFFC3}" RegisteredName="Environment_KeyBindings" PackageName="Visual Studio Environment Package">' +
		"<Version>$Version.0.0</Version><KeyboardShortcuts>$schemeElement<UserShortcuts/></KeyboardShortcuts></Category></Category></UserSettings>"
	[System.IO.File]::WriteAllText($Path, $xml, (New-Object System.Text.UTF8Encoding $false))
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$devenv = & $vswhere -version $VersionRange -latest -property productPath
$installationVersion = & $vswhere -version $VersionRange -latest -property installationVersion
if (-not $devenv) {
	throw "No Visual Studio $VersionRange found"
}
# Automation and settings files use the major version, such as 17.0
$version = "$(($installationVersion -split '\.')[0]).0"
Write-Host "Using Visual Studio $installationVersion ($devenv)"

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$settingsPath = Join-Path $env:TEMP "vs-keymap-scheme-$PID.vssettings"

function Export-Scheme([string]$Scheme, [string]$SchemeName) {
	New-SchemeSettings $settingsPath $version $SchemeName

	# /Embedding starts without UI, so the dump usually completes before first launch dialogs block automation
	$process = Start-Process -FilePath $devenv -ArgumentList @('/RootSuffix', $RootSuffix, '/ResetSettings', "`"$settingsPath`"", '/Embedding') -PassThru
	try {
		$dte = $null
		$deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
		while (-not $dte) {
			if ((Get-Date) -gt $deadline) {
				throw "Visual Studio did not register for automation within $StartTimeoutSeconds seconds"
			}
			if ($process.HasExited) {
				throw "Visual Studio exited with code $($process.ExitCode)"
			}
			Start-Sleep -Seconds 1
			$dte = [RunningObjects]::Find("!VisualStudio.DTE.${version}:$($process.Id)")
		}

		# The active scheme is reported as a name or a .vsk path
		$activeScheme = [System.IO.Path]::GetFileNameWithoutExtension($dte.Properties('Environment', 'Keyboard').Item('SchemeName').Value)
		$expectedScheme = if ($SchemeName) { $SchemeName } else { '(Default)' }
		if ($activeScheme -ne $expectedScheme) {
			throw "Expected scheme '$expectedScheme', the active scheme is '$activeScheme'"
		}

		$bindings = Get-KeyBindings $dte
		$output = [ordered]@{
			scheme = $Scheme
			source = "Visual Studio $installationVersion keyboard mapping scheme '$(if ($SchemeName) { $SchemeName } else { 'Default' })'"
			bindings = $bindings
		}
		$outputPath = Join-Path $OutputDirectory "$Scheme.json"
		$json = $output | ConvertTo-Json -Depth 4
		[System.IO.File]::WriteAllText($outputPath, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
		Write-Host "Wrote $($bindings.Count) commands to $outputPath"
	} finally {
		Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
		$process.WaitForExit(30000) | Out-Null
	}
}

try {
	foreach ($scheme in $schemes.Keys) {
		$schemeName = $schemes[$scheme]
		Write-Host "Dumping $scheme ('$schemeName')"
		# Visual Studio rejects automation calls while busy (RPC_E_CALL_REJECTED), so retry
		for ($attempt = 1; ; $attempt++) {
			try {
				Export-Scheme $scheme $schemeName
				break
			} catch {
				if ($attempt -ge 3) {
					throw
				}
				Write-Warning "Attempt $attempt failed, retrying: $_"
			}
		}
	}
} finally {
	Remove-Item $settingsPath -ErrorAction SilentlyContinue
	# Remove the isolated settings roots created for the dump
	foreach ($root in @("$env:LOCALAPPDATA\Microsoft\VisualStudio", "$env:APPDATA\Microsoft\VisualStudio")) {
		Get-ChildItem -Path $root -Directory -Filter "*$RootSuffix" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
	}
}
