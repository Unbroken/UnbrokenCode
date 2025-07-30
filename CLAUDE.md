# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the Visual Studio Code (VS Code) open-source repository. VS Code is built using TypeScript/JavaScript and runs on Electron. The codebase follows a layered architecture with clear separation between core editor functionality and workbench features.

## Common Development Commands

### Build and Compile
- `npm run compile` - Compile the entire project
- `npm run watch` - Watch mode for development (compiles client and extensions)
- `npm run watch-client` - Watch only client code
- `npm run watch-extensions` - Watch only extensions
- `./scripts/code.sh` - Run VS Code from source (macOS/Linux)
- `./scripts/code.bat` - Run VS Code from source (Windows)

### Testing
- `npm test` - Run tests (see scripts folder for specific test types)
- `npm run test-node` - Run Node.js unit tests
- `npm run test-browser` - Run browser tests
- `./scripts/test.sh` - Run tests from source
- `./scripts/test-integration.sh` - Run integration tests

### Code Quality
- `npm run eslint` - Run ESLint checks
- `npm run stylelint` - Run style linting
- `npm run hygiene` - Run hygiene checks (includes copyright headers, formatting)
- `npm run monaco-compile-check` - Check Monaco editor compilation
- `npm run valid-layers-check` - Validate architectural layers
- **Checking for TypeScript errors**: Use the MCP diagnostics tool (`mcp__ide__getDiagnostics`) to check for compile errors instead of running `npm run compile`
- **IMPORTANT**: Do not run compilation commands like `npm run compile` - the user runs watch scripts. Instead, ask if there are compilation errors or use the MCP diagnostics tool.

### Running Specific Tests
- To run a single test file: `npm run test-node -- --grep "test name pattern"`
- Integration tests: `./scripts/test-integration.sh`
- Smoke tests: `npm run smoketest`

## Architecture and Structure

### Core Components

1. **src/vs/base/** - Foundation layer with platform-agnostic utilities
   - `browser/` - DOM utilities, UI components
   - `common/` - Core utilities (arrays, strings, async, events)
   - `node/` - Node.js specific utilities

2. **src/vs/platform/** - Service layer providing core functionality
   - Services are registered through dependency injection
   - Key services: configuration, keybinding, storage, telemetry, lifecycle

3. **src/vs/editor/** - Monaco editor core
   - `browser/` - Editor rendering and DOM interaction
   - `common/` - Editor model, configuration, commands
   - `contrib/` - Editor features (find, folding, hover, etc.)

4. **src/vs/workbench/** - VS Code application layer
   - `browser/` - Main workbench implementation
   - `contrib/` - Workbench features (terminal, debug, search, etc.)
   - `services/` - Workbench-specific services
   - `api/` - Extension API implementation

5. **src/vs/code/** - Entry points
   - `electron-main/` - Main process code
   - `electron-browser/` - Renderer process bootstrap
   - `node/` - CLI implementation

6. **extensions/** - Built-in extensions
   - Each folder is a separate extension
   - Language support, themes, and features

### Key Architectural Patterns

- **Dependency Injection**: Services are injected via decorators (`@IServiceName`)
- **Event-Driven**: Heavy use of event emitters for decoupling
- **Layered Architecture**: Strict dependencies (base → platform → editor/workbench)
- **Contributions**: Features register themselves via contribution points
- **Electron IPC**: Main/renderer communication via IPC channels

### Extension API
- Public API defined in `src/vscode-dts/vscode.d.ts`
- Proposed APIs in `src/vscode-dts/vscode.proposed.*.d.ts`
- Implementation in `src/vs/workbench/api/`

## Development Tips

1. **Before Making Changes**: Always run `npm run compile` first to ensure a clean build
2. **Layer Violations**: The build will fail if you import from a higher layer
3. **Testing**: Write tests for new functionality in the appropriate test folder
4. **Debugging**: Use VS Code to debug VS Code - launch configurations are provided
5. **Performance**: Be mindful of the impact on startup time and memory usage

## Important Files
- `product.json` - Product configuration
- `package.json` - Dependencies and scripts
- `gulpfile.js` - Build system entry point
- `.eslintrc.json` - Linting rules
- `src/vs/workbench/workbench.common.main.ts` - Workbench initialization