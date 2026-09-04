import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isWorkspaceTrusted } from '../../extension';

const repoRoot = path.resolve(__dirname, '../../../');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageContents = require(path.join(repoRoot, 'scripts', 'package-contents.js')) as {
    evaluatePackageContents(
        files: string[],
        options?: { cwd?: string; requiredRuntimeFiles?: string[] }
    ): { ok: boolean; missing: string[]; forbidden: string[]; total: number };
    listVsixEntries(vsixPath: string): string[];
    runtimeRequirements(cwd: string): string[];
};

function readManifest(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
}

/** A minimal file list that satisfies every packaging rule. */
const RUNTIME_FILES = packageContents.runtimeRequirements(repoRoot);
const GOOD_FILES = [
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE.txt',
    'language-configuration.json',
    'syntaxes/streamql.tmLanguage.json',
    'images/icon.png',
    'out/extension.js',
    'out/client.js',
    'out/html.js',
    'out/config.js',
    'out/schemaTree.js',
    'out/messageViewer.js',
    'out/topicsTree.js',
    'out/consumerGroupsTree.js',
    'out/connectionsTree.js',
    'out/branchesTree.js',
    'out/memoryTree.js',
    ...RUNTIME_FILES
];

suite('VSIX package contents', () => {
    test('accepts a complete, pruned file list', () => {
        const result = packageContents.evaluatePackageContents(GOOD_FILES);
        assert.deepStrictEqual(result.missing, []);
        assert.deepStrictEqual(result.forbidden, []);
        assert.strictEqual(result.ok, true);
    });

    test('rejects a package missing its runtime dependency', () => {
        const files = GOOD_FILES.filter(f => !f.startsWith('node_modules/axios'));
        const result = packageContents.evaluatePackageContents(files);
        assert.strictEqual(result.ok, false);
        assert.ok(result.missing.some(m => m.includes('axios')), 'axios must be reported as missing');
    });

    test('requires the entrypoints and transitive packages Node actually loads', () => {
        assert.ok(
            RUNTIME_FILES.includes('node_modules/axios/dist/node/axios.cjs'),
            'axios Node entrypoint must be required'
        );
        for (const dependency of ['follow-redirects', 'form-data', 'proxy-from-env']) {
            assert.ok(
                RUNTIME_FILES.some(file => file.startsWith(`node_modules/${dependency}/`)),
                `${dependency} must be part of the runtime closure`
            );
        }

        const withoutFormData = GOOD_FILES.filter(f => !f.startsWith('node_modules/form-data/'));
        const result = packageContents.evaluatePackageContents(withoutFormData);
        assert.strictEqual(result.ok, false);
        assert.ok(
            result.missing.some(m => m.startsWith('node_modules/form-data/')),
            'a missing transitive runtime package must fail the VSIX gate'
        );
    });

    test('accepts either LICENSE spelling but requires one', () => {
        const withPlainLicense = GOOD_FILES.map(f => (f === 'LICENSE.txt' ? 'LICENSE' : f));
        assert.strictEqual(packageContents.evaluatePackageContents(withPlainLicense).ok, true);

        const withoutLicense = GOOD_FILES.filter(f => f !== 'LICENSE.txt');
        const result = packageContents.evaluatePackageContents(withoutLicense);
        assert.strictEqual(result.ok, false);
        assert.ok(result.missing.some(m => m.includes('LICENSE')));
    });

    test('rejects a package missing compiled extension code', () => {
        const result = packageContents.evaluatePackageContents(GOOD_FILES.filter(f => f !== 'out/extension.js'));
        assert.strictEqual(result.ok, false);
        assert.ok(result.missing.includes('out/extension.js'));
    });

    test('rejects internal, contributor-only and dev-dependency files', () => {
        const offenders = [
            'AUDIT.md',
            'CLAUDE.md',
            '.devcontainer/devcontainer.json',
            '.github/CODEOWNERS',
            '.pre-commit-config.yaml',
            'Makefile',
            'src/extension.ts',
            'out/test/suite/index.js',
            'out/extension.js.map',
            'package-lock.json',
            'tsconfig.json',
            'scripts/package-contents.js',
            'node_modules/typescript/lib/tsc.js',
            'node_modules/@vscode/vsce/package.json',
            'node_modules/mocha/index.js'
        ];
        const result = packageContents.evaluatePackageContents([...GOOD_FILES, ...offenders]);
        assert.strictEqual(result.ok, false);
        for (const offender of offenders) {
            assert.ok(
                result.forbidden.some(f => f.startsWith(offender)),
                `${offender} must be rejected by the package content rules`
            );
        }
    });

    test('.vscodeignore prunes internal and contributor-only paths', () => {
        const ignore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.startsWith('#'));

        for (const expected of [
            'src/**', 'out/test/**', '**/*.map', '**/*.ts', 'AUDIT.md', 'CLAUDE.md',
            '.devcontainer/**', '.github/**', 'CODEOWNERS', '.pre-commit-config.yaml',
            'Makefile', 'scripts/**', 'package-lock.json'
        ]) {
            assert.ok(ignore.includes(expected), `.vscodeignore must ignore ${expected}`);
        }
        // node_modules must NOT be ignored wholesale: vsce prunes it to production deps.
        assert.ok(!ignore.some(l => /^node_modules(\/|$)/.test(l)), 'node_modules must not be excluded wholesale');
        // Blanket re-includes would defeat the out/test exclusion (vsce negations are order independent).
        assert.ok(!ignore.some(l => l.startsWith('!')), '.vscodeignore must not use negated patterns');
    });

    test('optional: a built VSIX passes the same assertions', function () {
        const vsix = process.env.STREAMLINE_VSIX;
        if (!vsix || !fs.existsSync(vsix)) {
            this.skip();
            return;
        }
        const result = packageContents.evaluatePackageContents(packageContents.listVsixEntries(vsix));
        assert.deepStrictEqual({ missing: result.missing, forbidden: result.forbidden }, { missing: [], forbidden: [] });
    });
});

suite('Workspace trust and settings scope', () => {
    test('manifest disables the extension in untrusted workspaces', () => {
        const manifest = readManifest() as {
            capabilities?: { untrustedWorkspaces?: { supported?: unknown; description?: string } };
        };
        assert.strictEqual(manifest.capabilities?.untrustedWorkspaces?.supported, false);
        assert.ok((manifest.capabilities?.untrustedWorkspaces?.description ?? '').length > 0);
    });

    test('endpoint and token settings are machine-scoped', () => {
        const manifest = readManifest() as {
            contributes: {
                configuration: {
                    properties: Record<string, { scope?: string; ignoreSync?: boolean }>;
                };
            };
        };
        const properties = manifest.contributes.configuration.properties;
        for (const key of [
            'streamline.serverAddress',
            'streamline.httpAddress',
            'streamline.moonshotUrl',
            'streamline.moonshotToken',
            'streamline.connections',
            'streamline.defaultConnection'
        ]) {
            assert.strictEqual(properties[key].scope, 'machine', `${key} must be machine-scoped`);
        }
        assert.strictEqual(properties['streamline.moonshotToken'].ignoreSync, true, 'token must not be synced');
    });

    test('README documents every machine-scoped endpoint setting', () => {
        const manifest = readManifest() as {
            contributes: { configuration: { properties: Record<string, { scope?: string }> } };
        };
        const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
        const machineScoped = Object.entries(manifest.contributes.configuration.properties)
            .filter(([, value]) => value.scope === 'machine')
            .map(([key]) => key);

        assert.ok(machineScoped.length >= 6, 'expected the endpoint settings to be machine-scoped');
        for (const key of machineScoped) {
            assert.ok(
                readme.includes(`\`${key}\``),
                `README must list ${key} among the machine-scoped settings`
            );
        }
        assert.ok(/machine-scoped/i.test(readme), 'README must explain the machine scope');
    });

    test('trust guard mirrors the workspace trust state', () => {
        assert.strictEqual(isWorkspaceTrusted(), vscode.workspace.isTrusted !== false);
        assert.strictEqual(isWorkspaceTrusted(), true, 'the test workspace is expected to be trusted');
    });
});
