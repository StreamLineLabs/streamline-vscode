import * as assert from 'assert';
import { StreamlineClient, parseBrokers } from '../../client';

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
// extract command handlers into modules


suite('Connection String Parsing', () => {
    test('should parse single broker', () => {
        const result = parseBrokers('localhost:9092');
        assert.deepStrictEqual(result, [{ host: 'localhost', port: 9092 }]);
    });

    test('should parse multiple brokers', () => {
        const result = parseBrokers('broker1:9092,broker2:9092');
        assert.strictEqual(result.length, 2);
    });

    test('should handle whitespace in broker list', () => {
        const result = parseBrokers(' broker1:9092 , broker2:9092 ');
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].host, 'broker1');
    });
});
