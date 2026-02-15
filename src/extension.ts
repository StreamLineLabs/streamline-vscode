import * as vscode from 'vscode';
import { TopicsTreeProvider, TopicItem } from './topicsTree';
import { ConsumerGroupsTreeProvider } from './consumerGroupsTree';
import { ConnectionsTreeProvider } from './connectionsTree';
import { SchemaTreeProvider, SchemaTreeItem, SchemaViewerPanel } from './schemaTree';
import { StreamlineClient } from './client';
import { MessageViewerPanel } from './messageViewer';

let client: StreamlineClient | undefined;
let statusBarItem: vscode.StatusBarItem;
let reconnectTimer: NodeJS.Timeout | undefined;
let autoRefreshTimer: NodeJS.Timeout | undefined;
let lastConnectionHost: string | undefined;
let lastConnectionPort: number | undefined;
let lastConnectionTls: boolean | undefined;

function getEffectiveMaxMessages(): number {
    const config = vscode.workspace.getConfiguration('streamline');
    return config.get<number>('maxMessages')
        ?? config.get<number>('maxMessagesToShow')
        ?? 100;
}

function getEffectiveRefreshInterval(): number {
    const config = vscode.workspace.getConfiguration('streamline');
    return config.get<number>('refreshInterval')
        ?? config.get<number>('autoRefreshInterval')
        ?? 5000;
}

function validateJsonSchema(value: string, schema: any): string[] {
    const errors: string[] = [];
    try {
        const parsed = JSON.parse(value);
        if (schema.type && typeof parsed !== schema.type && !(schema.type === 'object' && typeof parsed === 'object')) {
            errors.push(`Expected type '${schema.type}', got '${typeof parsed}'`);
        }
        if (schema.type === 'object' && schema.required && Array.isArray(schema.required)) {
            for (const field of schema.required) {
                if (!(field in parsed)) {
                    errors.push(`Missing required field: '${field}'`);
                }
            }
        }
        if (schema.type === 'object' && schema.properties && typeof parsed === 'object') {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                if (key in parsed && (propSchema as any).type) {
                    const expectedType = (propSchema as any).type;
                    const actualType = typeof parsed[key];
                    if (expectedType === 'integer' || expectedType === 'number') {
                        if (actualType !== 'number') {
                            errors.push(`Field '${key}': expected ${expectedType}, got ${actualType}`);
                        }
                    } else if (actualType !== expectedType) {
                        errors.push(`Field '${key}': expected ${expectedType}, got ${actualType}`);
                    }
                }
            }
        }
    } catch {
        errors.push('Value is not valid JSON');
    }
    return errors;
}

function stopAutoRefresh(): void {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = undefined;
    }
}

function startAutoRefresh(
    topicsProvider: TopicsTreeProvider,
    consumerGroupsProvider: ConsumerGroupsTreeProvider,
    schemaProvider: SchemaTreeProvider
): void {
    stopAutoRefresh();
    const config = vscode.workspace.getConfiguration('streamline');
    const enabled = config.get<boolean>('autoRefresh') ?? true;
    if (!enabled || !client) { return; }

    const interval = getEffectiveRefreshInterval();
    autoRefreshTimer = setInterval(() => {
        if (client) {
            topicsProvider.refresh();
            consumerGroupsProvider.refresh();
            schemaProvider.refresh();
        }
    }, interval);
}

function stopReconnect(): void {
    if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = undefined;
    }
}

async function attemptReconnect(
    topicsProvider: TopicsTreeProvider,
    consumerGroupsProvider: ConsumerGroupsTreeProvider,
    schemaProvider: SchemaTreeProvider
): Promise<void> {
    if (!lastConnectionHost || !lastConnectionPort) { return; }
    const config = vscode.workspace.getConfiguration('streamline');
    if (!(config.get<boolean>('autoReconnect') ?? true)) { return; }

    stopReconnect();
    const interval = config.get<number>('autoReconnectInterval') ?? 5000;

    statusBarItem.text = '$(sync~spin) Streamline: Reconnecting...';

    reconnectTimer = setInterval(async () => {
        try {
            const newClient = new StreamlineClient(lastConnectionHost!, lastConnectionPort!, lastConnectionTls);
            const healthy = await newClient.isHealthy();
            if (healthy) {
                stopReconnect();
                client = newClient;
                statusBarItem.text = `$(check) Streamline: ${lastConnectionHost}:${lastConnectionPort}`;
                topicsProvider.setClient(client);
                consumerGroupsProvider.setClient(client);
                schemaProvider.setClient(client);
                startAutoRefresh(topicsProvider, consumerGroupsProvider, schemaProvider);
                vscode.window.showInformationMessage('Reconnected to Streamline');
            }
        } catch {
            // Will retry on next interval
        }
    }, interval);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Streamline extension activating...');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(plug) Streamline: Disconnected';
    statusBarItem.command = 'streamline.connect';
    statusBarItem.tooltip = 'Click to connect to Streamline';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Create tree providers
    const topicsProvider = new TopicsTreeProvider();
    const consumerGroupsProvider = new ConsumerGroupsTreeProvider();
    const connectionsProvider = new ConnectionsTreeProvider();
    const schemaProvider = new SchemaTreeProvider();

    // Register tree views
    vscode.window.registerTreeDataProvider('streamlineTopics', topicsProvider);
    vscode.window.registerTreeDataProvider('streamlineConsumerGroups', consumerGroupsProvider);
    vscode.window.registerTreeDataProvider('streamlineConnections', connectionsProvider);
    vscode.window.registerTreeDataProvider('streamlineSchemas', schemaProvider);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('streamline.connect', async () => {
            const config = vscode.workspace.getConfiguration('streamline');
            const connections = config.get<any[]>('connections') || [];
            const defaultConnection = config.get<string>('defaultConnection');

            let host = 'localhost';
            let port = 9094;
            let useTls = false;

            if (connections.length > 0) {
                const items = connections.map(c => ({
                    label: c.name,
                    description: `${c.host}:${c.httpPort || 9094}${c.tls ? ' (TLS)' : ''}`,
                    connection: c
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a connection or enter a new one'
                });

                if (selected) {
                    host = selected.connection.host;
                    port = selected.connection.httpPort || 9094;
                    useTls = selected.connection.tls || false;
                }
            } else {
                const httpAddr = config.get<string>('httpAddress') || 'localhost:9094';
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter Streamline HTTP API address',
                    value: httpAddr,
                    placeHolder: 'host:port'
                });

                if (input) {
                    const parts = input.split(':');
                    host = parts[0];
                    port = parseInt(parts[1]) || 9094;
                }
            }

            stopReconnect();

            try {
                client = new StreamlineClient(host, port, useTls);
                const healthy = await client.isHealthy();

                if (healthy) {
                    lastConnectionHost = host;
                    lastConnectionPort = port;
                    lastConnectionTls = useTls;
                    statusBarItem.text = `$(check) Streamline: ${host}:${port}`;
                    statusBarItem.tooltip = `Connected to ${host}:${port}${useTls ? ' (TLS)' : ''}`;
                    topicsProvider.setClient(client);
                    consumerGroupsProvider.setClient(client);
                    schemaProvider.setClient(client);
                    startAutoRefresh(topicsProvider, consumerGroupsProvider, schemaProvider);
                    vscode.window.showInformationMessage(`Connected to Streamline at ${host}:${port}`);
                } else {
                    throw new Error('Server health check failed');
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
                statusBarItem.text = '$(error) Streamline: Connection failed';
                statusBarItem.tooltip = `Connection failed: ${error.message}`;
                lastConnectionHost = host;
                lastConnectionPort = port;
                lastConnectionTls = useTls;
                attemptReconnect(topicsProvider, consumerGroupsProvider, schemaProvider);
            }
        }),

        vscode.commands.registerCommand('streamline.disconnect', () => {
            stopReconnect();
            stopAutoRefresh();
            client = undefined;
            lastConnectionHost = undefined;
            lastConnectionPort = undefined;
            lastConnectionTls = undefined;
            topicsProvider.setClient(undefined);
            consumerGroupsProvider.setClient(undefined);
            schemaProvider.setClient(undefined);
            statusBarItem.text = '$(plug) Streamline: Disconnected';
            statusBarItem.tooltip = 'Click to connect to Streamline';
            vscode.window.showInformationMessage('Disconnected from Streamline');
        }),

        vscode.commands.registerCommand('streamline.refreshTopics', () => {
            topicsProvider.refresh();
        }),

        vscode.commands.registerCommand('streamline.createTopic', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            const name = await vscode.window.showInputBox({
                prompt: 'Enter topic name',
                placeHolder: 'my-topic'
            });

            if (!name) return;

            const partitionsStr = await vscode.window.showInputBox({
                prompt: 'Number of partitions',
                value: '1'
            });

            const partitions = parseInt(partitionsStr || '1');

            try {
                await client.createTopic(name, partitions);
                vscode.window.showInformationMessage(`Topic '${name}' created with ${partitions} partitions`);
                topicsProvider.refresh();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to create topic: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('streamline.deleteTopic', async (item: TopicItem) => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Delete topic '${item.label}'? This cannot be undone.`,
                'Delete',
                'Cancel'
            );

            if (confirm === 'Delete') {
                try {
                    await client.deleteTopic(item.label as string);
                    vscode.window.showInformationMessage(`Topic '${item.label}' deleted`);
                    topicsProvider.refresh();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to delete topic: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('streamline.viewMessages', async (item: TopicItem) => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            MessageViewerPanel.createOrShow(context.extensionUri, client, item.label as string);
        }),

        vscode.commands.registerCommand('streamline.produceMessage', async (item: TopicItem) => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            const topic = item?.label as string || await vscode.window.showInputBox({
                prompt: 'Enter topic name'
            });

            if (!topic) return;

            const key = await vscode.window.showInputBox({
                prompt: 'Message key (optional)'
            });

            const value = await vscode.window.showInputBox({
                prompt: 'Message value'
            });

            if (!value) return;

            // Validate against JSON Schema if configured
            const config = vscode.workspace.getConfiguration('streamline');
            const schema = config.get<any>('produceMessageSchema');
            if (schema) {
                const errors = validateJsonSchema(value, schema);
                if (errors.length > 0) {
                    const proceed = await vscode.window.showWarningMessage(
                        `Schema validation failed:\n${errors.join('\n')}`,
                        'Send Anyway',
                        'Cancel'
                    );
                    if (proceed !== 'Send Anyway') { return; }
                }
            }

            try {
                const result = await client.produce(topic, key || null, value);
                vscode.window.showInformationMessage(
                    `Message sent to partition ${result.partition} at offset ${result.offset}`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to produce message: ${error.message}`);
            }
        }),

        // Schema Registry commands
        vscode.commands.registerCommand('streamline.refreshSchemas', () => {
            schemaProvider.refresh();
        }),

        vscode.commands.registerCommand('streamline.viewSchemaVersion', async (item: SchemaTreeItem) => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            SchemaViewerPanel.createOrShow(
                context.extensionUri,
                client,
                item.data.subject,
                item.data.version
            );
        }),

        vscode.commands.registerCommand('streamline.registerSchema', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            const subject = await vscode.window.showInputBox({
                prompt: 'Enter subject name (e.g., my-topic-value)',
                placeHolder: 'my-topic-value'
            });

            if (!subject) return;

            const schemaTypes = ['AVRO', 'JSON', 'PROTOBUF'];
            const schemaType = await vscode.window.showQuickPick(schemaTypes, {
                placeHolder: 'Select schema type'
            });

            if (!schemaType) return;

            const schema = await vscode.window.showInputBox({
                prompt: 'Enter schema definition (JSON)',
                placeHolder: '{"type": "record", "name": "Test", "fields": [...]}'
            });

            if (!schema) return;

            try {
                const result = await client.registerSchema(subject, schema, schemaType);
                vscode.window.showInformationMessage(`Schema registered with ID ${result.id}`);
                schemaProvider.refresh();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to register schema: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('streamline.deleteSubject', async (item: SchemaTreeItem) => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Delete all schemas for subject '${item.data.subject}'? This cannot be undone.`,
                'Delete',
                'Cancel'
            );

            if (confirm === 'Delete') {
                try {
                    await client.deleteSubject(item.data.subject);
                    vscode.window.showInformationMessage(`Subject '${item.data.subject}' deleted`);
                    schemaProvider.refresh();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to delete subject: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('streamline.checkCompatibility', async (item: SchemaTreeItem) => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            const schema = await vscode.window.showInputBox({
                prompt: 'Enter new schema to check compatibility',
                placeHolder: '{"type": "record", "name": "Test", "fields": [...]}'
            });

            if (!schema) return;

            try {
                const result = await client.checkCompatibility(item.data.subject, schema, 'AVRO', 'latest');
                if (result.is_compatible) {
                    vscode.window.showInformationMessage('Schema is compatible!');
                } else {
                    const messages = result.messages?.join('\n') || 'Unknown incompatibility';
                    vscode.window.showWarningMessage(`Schema is NOT compatible:\n${messages}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to check compatibility: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('streamline.setCompatibility', async (item: SchemaTreeItem) => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            const levels = ['BACKWARD', 'BACKWARD_TRANSITIVE', 'FORWARD', 'FORWARD_TRANSITIVE', 'FULL', 'FULL_TRANSITIVE', 'NONE'];
            const level = await vscode.window.showQuickPick(levels, {
                placeHolder: 'Select compatibility level'
            });

            if (!level) return;

            try {
                await client.setSubjectCompatibility(item.data.subject, level);
                vscode.window.showInformationMessage(`Compatibility for '${item.data.subject}' set to ${level}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to set compatibility: ${error.message}`);
            }
        })
    );

    console.log('Streamline extension activated');
}

export function deactivate() {
    stopReconnect();
    stopAutoRefresh();
    client = undefined;
}
