@echo off
setlocal

:: VS Code CLI compatibility wrapper (dev mode).
:: Provides 'code' for extensions that expect it (e.g. Claude Code).

set ROOT=%~dp0..

:: Dev-mode: launch via Electron directly. The running dev instance will be
:: detected via singleton IPC (both use the same user-data-dir and version).
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" "%ROOT%\product.json"') do set NAMESHORT=%%~a
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE="%ROOT%\.build\electron\%NAMESHORT%"

:: If the running instance's user-data-dir is known (set by localTerminalBackend),
:: pass it through so the CLI spawns an Electron instance with the matching IPC
:: handle. This is needed when the debug launcher uses a custom --user-data-dir.
set USER_DATA_ARGS=
if defined VSCODE_COMPAT_USER_DATA_DIR (
	set USER_DATA_ARGS=--user-data-dir "%VSCODE_COMPAT_USER_DATA_DIR%"
)

:: Pass %ROOT% as the app location argument — VSCODE_DEV causes parseCLIProcessArgv
:: to strip the first non-option argument, so %ROOT% is consumed instead of real args.
:: We use %ROOT% (not '.') because cli.ts re-spawns the Electron main process with
:: argv.slice(2) as arguments, and Electron needs the absolute app path — not a
:: relative '.' that would resolve to the user's CWD.
set VSCODE_DEV=1
set ELECTRON_RUN_AS_NODE=1
%CODE% "%ROOT%\out\cli.js" "%ROOT%" %USER_DATA_ARGS% %*

endlocal
