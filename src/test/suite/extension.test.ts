import * as assert from 'assert';
import * as vscode from 'vscode';
import { getEffectiveMaxMessages } from '../../extension';

// The extension identifier is `${publisher}.${name}` from package.json
// (publisher: "streamlinelabs", name: "streamline-vscode").
const EXTENSION_ID = 'streamlinelabs.streamline-vscode';

suite('Extension Activation', () => {
    test('Extension should be present', () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(ext, 'Extension should be registered');
    });

    test('Extension should export activate and deactivate', () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        if (ext) {
            assert.ok(ext.exports !== undefined || ext.isActive !== undefined);
        }
    });

    test('All commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        const expectedCommands = [
            'streamline.connect',
            'streamline.disconnect',
            'streamline.refreshTopics',
            'streamline.createTopic',
            'streamline.deleteTopic',
            'streamline.viewMessages',
            'streamline.produceMessage',
            'streamline.refreshSchemas',
            'streamline.registerSchema',
            'streamline.viewSchemaVersion',
            'streamline.deleteSubject',
            'streamline.checkCompatibility',
            'streamline.setCompatibility',
        ];

        for (const cmd of expectedCommands) {
            assert.ok(
                commands.includes(cmd),
                `Command '${cmd}' should be registered`
            );
        }
    });

    test('Views should be registered', () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        if (ext) {
            const pkg = ext.packageJSON;
            const views = pkg.contributes.views.streamline;
            assert.ok(views.length === 6, 'Should have 6 tree views');

            const viewIds = views.map((v: any) => v.id);
            assert.ok(viewIds.includes('streamlineTopics'));
            assert.ok(viewIds.includes('streamlineConsumerGroups'));
            assert.ok(viewIds.includes('streamlineSchemas'));
            assert.ok(viewIds.includes('streamlineConnections'));
            assert.ok(viewIds.includes('streamlineBranches'));
            assert.ok(viewIds.includes('streamlineMemory'));
        }
    });

    test('Configuration should have expected properties', () => {
        const config = vscode.workspace.getConfiguration('streamline');
        assert.strictEqual(config.get('maxMessagesToShow'), 100);
        assert.strictEqual(config.get('autoRefreshInterval'), 5000);
        assert.strictEqual(config.get('defaultConnection'), '');
    });

    suite('getEffectiveMaxMessages', () => {
        async function clearMaxMessageSettings(): Promise<void> {
            const config = vscode.workspace.getConfiguration('streamline');
            for (const key of ['maxMessages', 'maxMessagesToShow']) {
                if (config.inspect(key)?.globalValue !== undefined) {
                    await config.update(key, undefined, vscode.ConfigurationTarget.Global);
                }
            }
        }

        setup(clearMaxMessageSettings);
        teardown(clearMaxMessageSettings);

        test('falls back to default of 100 when unset', () => {
            assert.strictEqual(getEffectiveMaxMessages(), 100);
        });

        test('prefers maxMessages over the deprecated maxMessagesToShow alias', async () => {
            const config = vscode.workspace.getConfiguration('streamline');
            await config.update('maxMessages', 250, vscode.ConfigurationTarget.Global);
            await config.update('maxMessagesToShow', 50, vscode.ConfigurationTarget.Global);
            assert.strictEqual(getEffectiveMaxMessages(), 250);
        });
    });
});
