#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# Use the same root TypeScript 7 alias as build/lib/tsgo.ts.
TSGO="$ROOT_DIR/node_modules/@typescript/native/bin/tsc"

if [ ! -f "$TSGO" ]; then
	echo "Error: tsgo not found at $TSGO" >&2
	echo "Run 'npm ci' first to install dependencies." >&2
	exit 1
fi

ERRORS=0

# Type check each extension's tsconfig(s)
# vscode-clangd: uses tsconfig.typecheck.json to exclude test/ directory,
#   plus --skipLibCheck for node_modules/@types compatibility
# copilot: main tsconfig + worker tsconfig

declare -a CHECKS=(
	"extensions/vscode-clangd/tsconfig.typecheck.json --skipLibCheck"
	"extensions/copilot/tsconfig.json"
	"extensions/copilot/tsconfig.worker.json"
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
