# Contributing to Streamline for VS Code

Thank you for your interest in contributing! Please review the [organization-wide contributing guidelines](https://github.com/streamlinelabs/.github/blob/main/CONTRIBUTING.md) first.

## Development Setup

### Prerequisites

- Node.js 20+
- VS Code (for running/debugging the extension)

### Build & Test

```bash
npm install
npm run compile        # Build TypeScript
npm run lint           # Run ESLint
npm test               # Run tests (requires VS Code)
npm run watch          # Watch mode for development
npm run package        # Package as .vsix
```

### Running the Extension

1. Open this folder in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension will activate in the new VS Code window

### Running Tests

Tests require a VS Code instance and run via `@vscode/test-electron`:

```bash
npm run compile && npm test
```

### Adding a New Command

1. Define the command in `package.json` under `contributes.commands`
2. Register the handler in `src/extension.ts`
3. Add tree view context menu entries if applicable
4. Add tests in `src/test/suite/`

## Architecture

- `src/extension.ts` — Extension entry point and command registration
- `src/client.ts` — Streamline HTTP API client
- `src/topicsTree.ts` — Topics tree view provider
- `src/consumerGroupsTree.ts` — Consumer groups tree view
- `src/schemaTree.ts` — Schema registry tree view
- `src/connectionsTree.ts` — Connection management tree view
- `src/messageViewer.ts` — Message preview webview panel

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
<!-- docs: dedc8a8f -->
