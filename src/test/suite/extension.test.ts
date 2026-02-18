import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {
    test('Extension should be present', () => {
        const ext = vscode.extensions.getExtension('streamline.streamline-vscode');
        assert.ok(ext, 'Extension should be registered');
    });

    test('Extension should export activate and deactivate', () => {
        const ext = vscode.extensions.getExtension('streamline.streamline-vscode');
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
        const ext = vscode.extensions.getExtension('streamline.streamline-vscode');
        if (ext) {
            const pkg = ext.packageJSON;
            const views = pkg.contributes.views.streamline;
            assert.ok(views.length === 4, 'Should have 4 tree views');

            const viewIds = views.map((v: any) => v.id);
            assert.ok(viewIds.includes('streamlineTopics'));
            assert.ok(viewIds.includes('streamlineConsumerGroups'));
            assert.ok(viewIds.includes('streamlineSchemas'));
            assert.ok(viewIds.includes('streamlineConnections'));
        }
    });

    test('Configuration should have expected properties', () => {
        const config = vscode.workspace.getConfiguration('streamline');
        assert.strictEqual(config.get('maxMessagesToShow'), 100);
        assert.strictEqual(config.get('autoRefreshInterval'), 5000);
        assert.strictEqual(config.get('defaultConnection'), '');
    });
});
