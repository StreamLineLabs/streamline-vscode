import * as assert from 'assert';
import * as vscode from 'vscode';
import { getEffectiveMaxMessages, getEffectiveRefreshInterval } from '../../config';
import { MessageViewerPanel } from '../../messageViewer';
import { StreamlineClient } from '../../client';

/**
 * Regression coverage for the canonical/deprecated setting pairs.
 *
 * The previous `get(canonical) ?? get(alias)` implementation could never reach
 * the alias, because `get()` returns the manifest default instead of
 * `undefined`. The helpers now use `inspect()`, so these tests pin down all
 * four states: canonical explicit, alias only, both set, and neither set.
 */

const SECTION = 'streamline';
const TARGET = vscode.ConfigurationTarget.Global;

async function set(key: string, value: number | undefined): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update(key, value, TARGET);
}

async function clearAll(): Promise<void> {
    const config = vscode.workspace.getConfiguration(SECTION);
    for (const key of ['maxMessages', 'maxMessagesToShow', 'refreshInterval', 'autoRefreshInterval']) {
        if (config.inspect(key)?.globalValue !== undefined) {
            await set(key, undefined);
        }
    }
}

suite('Effective settings (canonical keys vs deprecated aliases)', () => {
    setup(clearAll);
    teardown(clearAll);

    suite('getEffectiveMaxMessages', () => {
        test('uses the manifest default when nothing is configured', () => {
            assert.strictEqual(getEffectiveMaxMessages(), 100);
        });

        test('honours an explicitly configured canonical streamline.maxMessages', async () => {
            await set('maxMessages', 250);
            assert.strictEqual(getEffectiveMaxMessages(), 250);
        });

        test('honours the canonical key even when set to the manifest default value', async () => {
            await set('maxMessages', 100);
            await set('maxMessagesToShow', 42);
            assert.strictEqual(getEffectiveMaxMessages(), 100);
        });

        test('falls back to the deprecated alias when only the alias is configured', async () => {
            await set('maxMessagesToShow', 7);
            assert.strictEqual(getEffectiveMaxMessages(), 7);
        });

        test('canonical wins when both the canonical key and the alias are configured', async () => {
            await set('maxMessages', 250);
            await set('maxMessagesToShow', 50);
            assert.strictEqual(getEffectiveMaxMessages(), 250);
        });
    });

    suite('getEffectiveRefreshInterval', () => {
        test('uses the manifest default when nothing is configured', () => {
            assert.strictEqual(getEffectiveRefreshInterval(), 5000);
        });

        test('honours an explicitly configured canonical streamline.refreshInterval', async () => {
            await set('refreshInterval', 12000);
            assert.strictEqual(getEffectiveRefreshInterval(), 12000);
        });

        test('honours the canonical key even when set to the manifest default value', async () => {
            await set('refreshInterval', 5000);
            await set('autoRefreshInterval', 60000);
            assert.strictEqual(getEffectiveRefreshInterval(), 5000);
        });

        test('falls back to the deprecated alias when only the alias is configured', async () => {
            await set('autoRefreshInterval', 30000);
            assert.strictEqual(getEffectiveRefreshInterval(), 30000);
        });

        test('canonical wins when both the canonical key and the alias are configured', async () => {
            await set('refreshInterval', 2000);
            await set('autoRefreshInterval', 30000);
            assert.strictEqual(getEffectiveRefreshInterval(), 2000);
        });
    });

    suite('message viewer consumption limit', () => {
        const extensionUri = vscode.Uri.file(__dirname);

        teardown(() => {
            MessageViewerPanel.currentPanel?.dispose();
        });

        /** Opens the viewer and resolves with the `limit` passed to `consume`. */
        async function limitUsedByViewer(topic: string): Promise<number | undefined> {
            let resolveLimit: (limit: number | undefined) => void;
            const limitSeen = new Promise<number | undefined>(resolve => {
                resolveLimit = resolve;
            });
            const client = {
                consume: async (_topic: string, options?: { limit?: number }) => {
                    resolveLimit(options?.limit);
                    return [];
                }
            } as unknown as StreamlineClient;

            MessageViewerPanel.createOrShow(extensionUri, client, topic);
            return limitSeen;
        }

        test('uses the canonical streamline.maxMessages value', async () => {
            await set('maxMessages', 321);
            assert.strictEqual(await limitUsedByViewer('canonical-topic'), 321);
        });

        test('uses the deprecated alias when only the alias is configured', async () => {
            await set('maxMessagesToShow', 17);
            assert.strictEqual(await limitUsedByViewer('alias-topic'), 17);
        });

        test('falls back to the default limit when nothing is configured', async () => {
            assert.strictEqual(await limitUsedByViewer('default-topic'), 100);
        });
    });
});
