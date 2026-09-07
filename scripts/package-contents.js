#!/usr/bin/env node
/**
 * Deterministic VSIX package-content assertions.
 *
 * Two modes:
 *   node scripts/package-contents.js                 # assert on `vsce ls` output
 *   node scripts/package-contents.js --vsix <file>   # assert on a built .vsix
 *
 * The pure `evaluatePackageContents` function is unit tested from the
 * extension test suite, so the release gate and the tests share one rule set.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

/** Files that must be present for the extension to run once installed. */
const REQUIRED_FILES = [
    'package.json',
    'README.md',
    'CHANGELOG.md',
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
    'out/memoryTree.js'
];

/** At least one file must match each of these prefixes. */
const REQUIRED_PREFIXES = [];

/**
 * Groups where at least one alternative must be present. vsce renames the
 * license file to `LICENSE.txt` inside the VSIX, so both spellings are valid.
 */
const REQUIRED_ANY_OF = [['LICENSE', 'LICENSE.txt', 'LICENSE.md']];

/**
 * Locate a dependency package using Node's search paths from its parent.
 *
 * @param {string} packageName Dependency package name.
 * @param {string} from Parent package directory.
 * @returns {{root: string, manifest: object}}
 */
function findPackageRoot(packageName, from) {
    const resolver = createRequire(path.join(from, '__streamline_runtime_requirements__.js'));
    for (const searchPath of resolver.resolve.paths(packageName) || []) {
        const root = path.join(searchPath, packageName);
        const manifestPath = path.join(root, 'package.json');
        if (!fs.existsSync(manifestPath)) {
            continue;
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.name === packageName) {
            return { root, manifest, resolver };
        }
    }
    throw new Error(`Could not resolve runtime dependency ${packageName} from ${from}`);
}

/** Runtime JavaScript targets exposed by a package with no root entrypoint. */
function exportedRuntimeTargets(exportsField) {
    const targets = [];
    const visit = value => {
        if (typeof value === 'string') {
            if (/^\.\/.*\.(?:cjs|mjs|js)$/.test(value)) {
                targets.push(value.slice(2));
            }
            return;
        }
        if (value && typeof value === 'object') {
            for (const child of Object.values(value)) {
                visit(child);
            }
        }
    };
    visit(exportsField);
    return [...new Set(targets)];
}

/**
 * Resolve the complete production dependency closure from the installed tree
 * and return each package manifest plus the entrypoint Node will actually load.
 *
 * Checking only `node_modules/axios/package.json` or an arbitrary `axios/lib/`
 * file can approve a VSIX that fails at activation: axios loads
 * `dist/node/axios.cjs` and requires several production dependencies. Walking
 * the real manifests keeps this assertion aligned with package-lock/node
 * resolution without hard-coding today's transitive dependency list.
 *
 * @param {string} cwd Extension repository root.
 * @returns {string[]} Extension-relative POSIX paths.
 */
function runtimeRequirements(cwd) {
    const rootManifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    const queue = Object.keys(rootManifest.dependencies || {}).map(name => ({ name, from: cwd }));
    const visited = new Set();
    const required = new Set();

    while (queue.length > 0) {
        const { name, from } = queue.shift();
        const { root, manifest, resolver } = findPackageRoot(name, from);
        const manifestPath = path.join(root, 'package.json');
        const relativeManifest = path.relative(cwd, manifestPath).replace(/\\/g, '/');
        if (visited.has(relativeManifest)) {
            continue;
        }
        visited.add(relativeManifest);

        if (!relativeManifest.startsWith('node_modules/')) {
            throw new Error(`Runtime dependency ${name} resolved outside node_modules`);
        }
        required.add(relativeManifest);

        try {
            const entry = resolver.resolve(name);
            const relativeEntry = path.relative(cwd, entry).replace(/\\/g, '/');
            if (!relativeEntry.startsWith('node_modules/')) {
                throw new Error(`Runtime dependency ${name} entrypoint resolved outside node_modules`);
            }
            required.add(relativeEntry);
        } catch (error) {
            // Some runtime packages intentionally expose only subpaths
            // (`math-intrinsics/abs`, etc.) and have no root `require(name)`.
            // Require every JavaScript export target instead of treating that
            // valid package shape as an unresolved dependency.
            const targets = exportedRuntimeTargets(manifest.exports);
            if (targets.length === 0) {
                throw error;
            }
            for (const target of targets) {
                required.add(path.relative(cwd, path.join(root, target)).replace(/\\/g, '/'));
            }
        }

        for (const dependency of Object.keys(manifest.dependencies || {})) {
            queue.push({ name: dependency, from: root });
        }
    }

    return [...required].sort();
}

/** Nothing matching these may ship to the Marketplace. */
const FORBIDDEN_PATTERNS = [
    { name: 'TypeScript sources', re: /^src\// },
    { name: 'compiled tests', re: /^out\/test\// },
    { name: 'source maps', re: /\.map$/ },
    { name: 'TypeScript files', re: /\.ts$/ },
    { name: 'CI workflows', re: /^\.github\// },
    { name: 'devcontainer', re: /^\.devcontainer\// },
    { name: 'internal audit doc', re: /^AUDIT\.md$/i },
    { name: 'agent instructions', re: /^CLAUDE\.md$/i },
    { name: 'code owners', re: /(^|\/)CODEOWNERS$/ },
    { name: 'pre-commit config', re: /^\.pre-commit-config\.yaml$/ },
    { name: 'Makefile', re: /^Makefile$/ },
    { name: 'contributor docs', re: /^(CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\.md$/ },
    { name: 'lockfile', re: /^package-lock\.json$/ },
    { name: 'build config', re: /^(tsconfig\.json|\.eslintrc\.json|\.editorconfig|\.nvmrc|\.gitattributes|\.gitignore)$/ },
    { name: 'packaging scripts', re: /^scripts\// },
    { name: 'nested vsix', re: /\.vsix$/ },
    {
        name: 'dev dependencies',
        re: /^node_modules\/(typescript|eslint|mocha|sinon|glob|@types|@typescript-eslint|@vscode\/vsce|@vscode\/test-electron)(\/|$)/
    }
];

/**
 * Assert a packaged file list against the required/forbidden rule set.
 *
 * @param {string[]} files Extension-relative POSIX paths.
 * @returns {{ok: boolean, missing: string[], forbidden: string[], total: number}}
 */
function evaluatePackageContents(files, options = {}) {
    const normalized = (files || [])
        .map(f => String(f).replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter(f => f.length > 0);
    const present = new Set(normalized);
    const cwd = options.cwd || path.resolve(__dirname, '..');
    const requiredRuntimeFiles = options.requiredRuntimeFiles || runtimeRequirements(cwd);

    const missing = [...REQUIRED_FILES, ...requiredRuntimeFiles].filter(f => !present.has(f));
    for (const prefix of REQUIRED_PREFIXES) {
        if (!normalized.some(f => f.startsWith(prefix))) {
            missing.push(`${prefix}*`);
        }
    }
    for (const group of REQUIRED_ANY_OF) {
        if (!group.some(f => present.has(f))) {
            missing.push(group.join(' | '));
        }
    }

    const forbidden = [];
    for (const file of normalized) {
        for (const rule of FORBIDDEN_PATTERNS) {
            if (rule.re.test(file)) {
                forbidden.push(`${file} (${rule.name})`);
                break;
            }
        }
    }

    return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden, total: normalized.length };
}

/**
 * Read entry names from a zip (VSIX) archive without third-party dependencies.
 *
 * @param {string} vsixPath Path to the .vsix file.
 * @returns {string[]} Extension-relative paths (the `extension/` prefix is stripped).
 */
function listVsixEntries(vsixPath) {
    const buf = fs.readFileSync(vsixPath);
    const EOCD_SIG = 0x06054b50;
    const CD_SIG = 0x02014b50;

    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === EOCD_SIG) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error(`Not a valid zip/VSIX archive: ${vsixPath}`);
    }

    const entryCount = buf.readUInt16LE(eocd + 10);
    let offset = buf.readUInt32LE(eocd + 16);
    const names = [];

    for (let i = 0; i < entryCount; i++) {
        if (buf.readUInt32LE(offset) !== CD_SIG) {
            throw new Error(`Corrupt central directory at offset ${offset} in ${vsixPath}`);
        }
        const nameLen = buf.readUInt16LE(offset + 28);
        const extraLen = buf.readUInt16LE(offset + 30);
        const commentLen = buf.readUInt16LE(offset + 32);
        const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
        names.push(name);
        offset += 46 + nameLen + extraLen + commentLen;
    }

    return names
        .filter(n => n.startsWith('extension/'))
        .map(n => n.slice('extension/'.length))
        .filter(n => n.length > 0 && !n.endsWith('/'));
}

/** List the files vsce would package, without building a VSIX. */
function listVsceFiles(cwd) {
    const vsce = path.join(cwd, 'node_modules', '.bin', 'vsce');
    const bin = fs.existsSync(vsce) ? vsce : 'vsce';
    const stdout = execFileSync(bin, ['ls'], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return stdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('WARNING') && !l.startsWith('ERROR'));
}

function main(argv) {
    const cwd = path.resolve(__dirname, '..');
    const vsixFlag = argv.indexOf('--vsix');
    let files;
    let source;

    if (vsixFlag !== -1) {
        const vsixPath = argv[vsixFlag + 1];
        if (!vsixPath) {
            console.error('Usage: node scripts/package-contents.js --vsix <path-to-vsix>');
            return 2;
        }
        files = listVsixEntries(path.resolve(cwd, vsixPath));
        source = path.resolve(cwd, vsixPath);
    } else {
        files = listVsceFiles(cwd);
        source = 'vsce ls';
    }

    const result = evaluatePackageContents(files);
    console.log(`Checked ${result.total} packaged files from ${source}`);
    for (const m of result.missing) {
        console.error(`  MISSING: ${m}`);
    }
    for (const f of result.forbidden) {
        console.error(`  FORBIDDEN: ${f}`);
    }
    if (!result.ok) {
        console.error('Package content assertions failed.');
        return 1;
    }
    console.log('Package content assertions passed.');
    return 0;
}

module.exports = {
    evaluatePackageContents,
    listVsixEntries,
    listVsceFiles,
    REQUIRED_FILES,
    REQUIRED_PREFIXES,
    REQUIRED_ANY_OF,
    FORBIDDEN_PATTERNS,
    runtimeRequirements
};

if (require.main === module) {
    try {
        process.exit(main(process.argv.slice(2)));
    } catch (err) {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    }
}
