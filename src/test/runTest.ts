import * as path from 'path';

import { runTests } from '@vscode/test-electron';

// Pin the downloaded VS Code test runtime to a version compatible with the
// declared `engines.vscode` range (^1.85.0) in package.json. Letting
// @vscode/test-electron fall back to its "stable" default can silently pull
// down a much newer VS Code release whose packaging (e.g. the macOS
// executable name) is incompatible with this harness. Override via
// VSCODE_TEST_VERSION for local experimentation with other versions.
const DEFAULT_VSCODE_TEST_VERSION = '1.85.2';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const version = process.env.VSCODE_TEST_VERSION || DEFAULT_VSCODE_TEST_VERSION;

        await runTests({ extensionDevelopmentPath, extensionTestsPath, version });
    } catch (err) {
        console.error('Failed to run tests:', err);
        process.exit(1);
    }
}

main();
