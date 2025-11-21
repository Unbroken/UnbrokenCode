#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TSGO="$ROOT_DIR/node_modules/@typescript/native-preview/bin/tsgo.js"

if [ ! -f "$TSGO" ]; then
	echo "Error: tsgo not found at $TSGO" >&2
	echo "Run 'npm ci' first to install dependencies." >&2
	exit 1
fi

ERRORS=0

# Type check each extension's tsconfig(s)
# vscode-clangd: uses tsconfig.typecheck.json to exclude test/ directory,
#   plus --skipLibCheck for node_modules/@types compatibility
# vscode-copilot-chat: main tsconfig + worker tsconfig

declare -a CHECKS=(
	"extensions/vscode-clangd/tsconfig.typecheck.json --skipLibCheck"
	"extensions/vscode-copilot-chat/tsconfig.json"
	"extensions/vscode-copilot-chat/tsconfig.worker.json"
)

for check in "${CHECKS[@]}"; do
read -r tsconfig extra_args <<< "$check"

	echo "Type checking $tsconfig..."
	if ! node "$TSGO" --noEmit -p "$ROOT_DIR/$tsconfig" $extra_args; then
		ERRORS=$((ERRORS + 1))
	fi
done

if [ $ERRORS -gt 0 ]; then
	echo ""
	echo "Type checking failed for $ERRORS config(s)"
	exit 1
fi

echo "All extension type checks passed"
