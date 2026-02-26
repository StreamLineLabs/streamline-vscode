import * as assert from 'assert';
import * as vscode from 'vscode';
import { TopicsTreeProvider, TopicItem } from '../../topicsTree';
import { ConsumerGroupsTreeProvider } from '../../consumerGroupsTree';
import { SchemaTreeProvider } from '../../schemaTree';
import { ConnectionsTreeProvider } from '../../connectionsTree';

suite('Tree View Providers', () => {

    suite('TopicsTreeProvider', () => {
        test('should instantiate without a client', () => {
            const provider = new TopicsTreeProvider();
            assert.ok(provider, 'TopicsTreeProvider should be instantiated');
        });

        test('should return empty array when no client is set', async () => {
            const provider = new TopicsTreeProvider();
            const children = await provider.getChildren();
            assert.ok(Array.isArray(children), 'getChildren should return an array');
            // Without a client, should return empty or a "not connected" item
        });

        test('should implement TreeDataProvider interface', () => {
            const provider = new TopicsTreeProvider();
            assert.ok(typeof provider.getTreeItem === 'function');
            assert.ok(typeof provider.getChildren === 'function');
        });

        test('refresh should fire onDidChangeTreeData event', () => {
            const provider = new TopicsTreeProvider();
            let eventFired = false;
            provider.onDidChangeTreeData(() => {
                eventFired = true;
            });
            provider.refresh();
            assert.ok(eventFired, 'refresh() should fire the change event');
        });
    });

    suite('TopicItem', () => {
        test('should create topic item with correct properties', () => {
            const topicInfo = {
                name: 'test-topic',
                partitions: 3,
                replicationFactor: 1
            };
            const item = new TopicItem(
                'test-topic',
                vscode.TreeItemCollapsibleState.Collapsed,
                topicInfo
            );

            assert.strictEqual(item.label, 'test-topic');
            assert.strictEqual(item.contextValue, 'topic');
            assert.strictEqual(item.description, '3 partitions');
        });

        test('should handle single partition description', () => {
            const topicInfo = {
                name: 'single',
                partitions: 1,
                replicationFactor: 1
            };
            const item = new TopicItem(
                'single',
                vscode.TreeItemCollapsibleState.Collapsed,
                topicInfo
            );

            assert.strictEqual(item.description, '1 partition');
        });
    });

    suite('ConsumerGroupsTreeProvider', () => {
        test('should instantiate without a client', () => {
            const provider = new ConsumerGroupsTreeProvider();
            assert.ok(provider, 'ConsumerGroupsTreeProvider should be instantiated');
        });

        test('should implement TreeDataProvider interface', () => {
            const provider = new ConsumerGroupsTreeProvider();
            assert.ok(typeof provider.getTreeItem === 'function');
            assert.ok(typeof provider.getChildren === 'function');
        });
    });

    suite('SchemaTreeProvider', () => {
        test('should instantiate without a client', () => {
            const provider = new SchemaTreeProvider();
            assert.ok(provider, 'SchemaTreeProvider should be instantiated');
        });

        test('should implement TreeDataProvider interface', () => {
            const provider = new SchemaTreeProvider();
            assert.ok(typeof provider.getTreeItem === 'function');
            assert.ok(typeof provider.getChildren === 'function');
        });
    });

    suite('ConnectionsTreeProvider', () => {
        test('should instantiate', () => {
            const provider = new ConnectionsTreeProvider();
            assert.ok(provider, 'ConnectionsTreeProvider should be instantiated');
        });

        test('should implement TreeDataProvider interface', () => {
            const provider = new ConnectionsTreeProvider();
            assert.ok(typeof provider.getTreeItem === 'function');
            assert.ok(typeof provider.getChildren === 'function');
        });
    });
});
// TODO: add integration tests for language server
