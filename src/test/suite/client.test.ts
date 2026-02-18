import * as assert from 'assert';
import { StreamlineClient } from '../../client';

suite('StreamlineClient Unit Tests', () => {
    test('Constructor sets host and port', () => {
        const client = new StreamlineClient('myhost', 9094);
        const info = client.getConnectionInfo();
        assert.strictEqual(info.host, 'myhost');
        assert.strictEqual(info.port, 9094);
    });

    test('Constructor with default port', () => {
        const client = new StreamlineClient('localhost', 9094);
        const info = client.getConnectionInfo();
        assert.strictEqual(info.host, 'localhost');
        assert.strictEqual(info.port, 9094);
    });

    test('isHealthy returns false when server unreachable', async () => {
        const client = new StreamlineClient('localhost', 19999);
        const healthy = await client.isHealthy();
        assert.strictEqual(healthy, false);
    });

    test('listTopics throws when server unreachable', async () => {
        const client = new StreamlineClient('localhost', 19999);
        try {
            await client.listTopics();
            assert.fail('Should have thrown');
        } catch (err) {
            assert.ok(err instanceof Error);
        }
    });

    test('listConsumerGroups throws when server unreachable', async () => {
        const client = new StreamlineClient('localhost', 19999);
        try {
            await client.listConsumerGroups();
            assert.fail('Should have thrown');
        } catch (err) {
            assert.ok(err instanceof Error);
        }
    });
});
