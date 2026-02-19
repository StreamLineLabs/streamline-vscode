# CLAUDE.md — Streamline VS Code Extension

## Overview
VS Code extension for [Streamline](https://github.com/streamlinelabs/streamline). Provides a topic browser, message viewer, consumer group management, schema registry UI, and StreamQL language support.

## Build & Test
```bash
npm install              # Install dependencies
npm run compile          # TypeScript → JavaScript (tsc -p ./)
npm test                 # Run tests
npm run package          # Package as .vsix (vsce package)
```

## Architecture
```
src/
├── extension.ts         # Extension activation/deactivation
├── client.ts            # Streamline HTTP API client
├── topicsTree.ts        # Topics tree view provider
├── consumerGroupsTree.ts  # Consumer groups tree view
├── schemaTree.ts        # Schema registry tree view
├── connectionsTree.ts   # Multi-server connection manager
├── messageViewer.ts     # Message viewer panel
syntaxes/
├── streamql.tmLanguage.json  # StreamQL syntax highlighting
language-configuration.json   # StreamQL language config
```

## Coding Conventions
- **TypeScript strict mode**: `strict: true`, `noImplicitAny`, `noImplicitReturns`
- **VS Code API**: Use `vscode.TreeDataProvider` for tree views, `vscode.WebviewPanel` for message viewer
- **Configuration**: Declared in `package.json` `contributes.configuration`
- **Commands**: Register in `package.json` `contributes.commands`, implement in `extension.ts`
- **Error handling**: Show user-facing errors via `vscode.window.showErrorMessage()`

## Key Features
- **Topic browser**: Create, delete, describe topics; view messages
- **Consumer groups**: Monitor lag, describe members, reset offsets
- **Schema registry**: View subjects, versions, compatibility
- **Connection profiles**: Multiple server connections with TLS/SASL
- **StreamQL**: Syntax highlighting for Streamline's SQL dialect

## Configuration Properties
- `streamline.serverAddress` — Server HTTP address (default: `http://localhost:9094`)
- `streamline.tls.*` — TLS certificate paths
- `streamline.autoRefresh` — Auto-refresh interval
- `streamline.maxMessages` — Max messages in viewer

## Publishing
```bash
npm run package          # Creates .vsix file
vsce publish             # Publish to VS Code Marketplace
```
