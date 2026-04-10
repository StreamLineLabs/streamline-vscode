import * as vscode from 'vscode';
import { TopicsTreeProvider, TopicItem } from './topicsTree';
import { ConsumerGroupsTreeProvider } from './consumerGroupsTree';
import { ConnectionsTreeProvider } from './connectionsTree';
import { SchemaTreeProvider, SchemaTreeItem, SchemaViewerPanel } from './schemaTree';
import { BranchesTreeProvider, buildBranchesClientFromConfig } from './branchesTree';
import { MemoryTreeProvider, MemoryItem, buildMemoryClientFromConfig } from './memoryTree';
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

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createStyledWebviewPanel(
    viewType: string,
    title: string,
    bodyContent: string
): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        viewType,
        title,
        vscode.ViewColumn.One,
        { enableScripts: false }
    );
    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }
        h1 { font-size: 1.4em; margin-bottom: 16px; }
        h2 { font-size: 1.1em; margin-top: 20px; margin-bottom: 8px; color: var(--vscode-descriptionForeground); }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
        }
        th, td {
            text-align: left;
            padding: 8px 12px;
            border: 1px solid var(--vscode-panel-border);
        }
        th {
            background: var(--vscode-editor-inactiveSelectionBackground);
            font-weight: bold;
        }
        tr:hover td { background: var(--vscode-list-hoverBackground); }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.85em;
        }
        .badge-stable { background: #2ea04370; color: #3fb950; }
        .badge-warn { background: #d2992270; color: #e3b341; }
        .badge-error { background: #f8514970; color: #f85149; }
        .info-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 6px 16px;
            margin-bottom: 16px;
        }
        .info-label { color: var(--vscode-descriptionForeground); }
        .empty { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
        .code {
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 2px;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .bar-container {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 2px;
            overflow: hidden;
            height: 16px;
            min-width: 100px;
        }
        .bar-fill {
            height: 100%;
            border-radius: 2px;
        }
        .bar-hot { background: #f85149; }
        .bar-warm { background: #e3b341; }
        .bar-normal { background: #3fb950; }
    </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
    return panel;
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
    const branchesProvider = new BranchesTreeProvider();
    branchesProvider.setClient(buildBranchesClientFromConfig(vscode.workspace.getConfiguration('streamline')));
    const memoryProvider = new MemoryTreeProvider();
    memoryProvider.setClient(buildMemoryClientFromConfig(vscode.workspace.getConfiguration('streamline')));

    // Register tree views
    vscode.window.registerTreeDataProvider('streamlineTopics', topicsProvider);
    vscode.window.registerTreeDataProvider('streamlineConsumerGroups', consumerGroupsProvider);
    vscode.window.registerTreeDataProvider('streamlineConnections', connectionsProvider);
    vscode.window.registerTreeDataProvider('streamlineSchemas', schemaProvider);
    vscode.window.registerTreeDataProvider('streamlineBranches', branchesProvider);
    vscode.window.registerTreeDataProvider('streamlineMemory', memoryProvider);

    // Re-resolve the moonshot client when the relevant settings change.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('streamline.moonshotUrl') || e.affectsConfiguration('streamline.moonshotToken')) {
                branchesProvider.setClient(buildBranchesClientFromConfig(vscode.workspace.getConfiguration('streamline')));
                memoryProvider.setClient(buildMemoryClientFromConfig(vscode.workspace.getConfiguration('streamline')));
            }
        }),
        vscode.commands.registerCommand('streamline.refreshBranches', () => branchesProvider.refresh()),
        vscode.commands.registerCommand('streamline.refreshMemory', () => memoryProvider.refresh()),
        vscode.commands.registerCommand('streamline.searchTopic', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }
            const topics = await client.listTopics();
            const topicNames = topics.map(t => t.name);
            const topic = await vscode.window.showQuickPick(topicNames, {
                placeHolder: 'Select a topic to search',
            });
            if (!topic) { return; }
            const query = await vscode.window.showInputBox({
                prompt: `Search messages in topic '${topic}'`,
                placeHolder: 'Enter search query...',
            });
            if (!query) { return; }
            try {
                const messages = await client.consume(topic, { limit: 100 });
                const filtered = messages.filter(m =>
                    (m.value && m.value.includes(query)) ||
                    (m.key && m.key.includes(query))
                );
                if (filtered.length === 0) {
                    vscode.window.showInformationMessage(`No messages matching '${query}' in topic '${topic}'`);
                    return;
                }
                const items = filtered.map(m => ({
                    label: `P${m.partition} @ ${m.offset}`,
                    description: m.key || '',
                    detail: m.value.substring(0, 200),
                }));
                await vscode.window.showQuickPick(items, { placeHolder: `${filtered.length} results in ${topic}` });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Search failed: ${error.message}`);
            }
        }),
        vscode.commands.registerCommand('streamline.viewContract', async (item: TopicItem) => {
            if (!item?.topicMeta?.contractName) {
                vscode.window.showInformationMessage('No contract associated with this topic');
                return;
            }
            const contractName = item.topicMeta.contractName;
            const config = vscode.workspace.getConfiguration('streamline');
            const moonshotUrl = config.get<string>('moonshotUrl');
            if (!moonshotUrl) {
                vscode.window.showErrorMessage('Moonshot URL not configured');
                return;
            }
            try {
                const headers: Record<string, string> = { Accept: 'application/json' };
                const token = config.get<string>('moonshotToken');
                if (token) { headers['Authorization'] = `Bearer ${token}`; }
                const res = await fetch(
                    `${moonshotUrl.replace(/\/+$/, '')}/api/v1/contracts/${encodeURIComponent(contractName)}`,
                    { headers },
                );
                if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                const contract = await res.json() as { name: string; schema: any; compatibility?: string };
                const doc = await vscode.workspace.openTextDocument({
                    content: JSON.stringify(contract, null, 2),
                    language: 'json',
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to fetch contract: ${error.message}`);
            }
        }),
        vscode.commands.registerCommand('streamline.searchMemories', async (item?: MemoryItem) => {
            const config = vscode.workspace.getConfiguration('streamline');
            const moonshotUrl = config.get<string>('moonshotUrl');
            if (!moonshotUrl) {
                vscode.window.showErrorMessage('Moonshot URL not configured');
                return;
            }
            let agentId = item?.agent?.agentId;
            if (!agentId) {
                agentId = await vscode.window.showInputBox({
                    prompt: 'Enter agent ID to search memories for',
                    placeHolder: 'agent-001',
                });
            }
            if (!agentId) { return; }
            const query = await vscode.window.showInputBox({
                prompt: `Search memories for agent '${agentId}'`,
                placeHolder: 'Enter search query...',
            });
            if (!query) { return; }
            try {
                const headers: Record<string, string> = {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                };
                const token = config.get<string>('moonshotToken');
                if (token) { headers['Authorization'] = `Bearer ${token}`; }
                const res = await fetch(
                    `${moonshotUrl.replace(/\/+$/, '')}/api/v1/memories/${encodeURIComponent(agentId)}/search`,
                    { method: 'POST', headers, body: JSON.stringify({ query }) },
                );
                if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                const data = await res.json() as { results?: { tier: string; key: string; value: string; score: number }[] };
                const results = data.results ?? [];
                if (results.length === 0) {
                    vscode.window.showInformationMessage(`No memories matching '${query}' for agent '${agentId}'`);
                    return;
                }
                const items = results.map(r => ({
                    label: `[${r.tier}] ${r.key}`,
                    description: `score: ${r.score.toFixed(3)}`,
                    detail: r.value.substring(0, 200),
                }));
                await vscode.window.showQuickPick(items, { placeHolder: `${results.length} memory results` });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Memory search failed: ${error.message}`);
            }
        }),
    );

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
        }),

        // ==================== Advanced commands ====================

        vscode.commands.registerCommand('streamline.viewConsumerGroups', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            try {
                const groups = await client.listConsumerGroups();

                if (groups.length === 0) {
                    createStyledWebviewPanel(
                        'streamlineConsumerGroupsView',
                        'Consumer Groups',
                        '<h1>Consumer Groups</h1><div class="empty">No consumer groups found</div>'
                    );
                    return;
                }

                const details = await Promise.all(
                    groups.map(g => client!.describeConsumerGroup(g.groupId).catch(() => null))
                );

                let tableRows = '';
                for (let i = 0; i < groups.length; i++) {
                    const g = groups[i];
                    const d = details[i];
                    const stateClass = g.state === 'Stable' ? 'badge-stable'
                        : g.state === 'Empty' ? 'badge-warn' : 'badge-error';
                    const totalLag = d?.lag?.reduce((sum, l) => sum + l.lag, 0) ?? 'N/A';
                    const memberDetails = d?.members?.map(m =>
                        `${escapeHtml(m.clientId)} (${escapeHtml(m.host)})`
                    ).join(', ') || 'None';

                    tableRows += `<tr>
                        <td>${escapeHtml(g.groupId)}</td>
                        <td><span class="badge ${stateClass}">${escapeHtml(g.state)}</span></td>
                        <td>${escapeHtml(g.protocol || 'N/A')}</td>
                        <td title="${escapeHtml(memberDetails)}">${g.members}</td>
                        <td>${totalLag}</td>
                    </tr>`;
                }

                createStyledWebviewPanel(
                    'streamlineConsumerGroupsView',
                    'Consumer Groups',
                    `<h1>Consumer Groups</h1>
                    <p>${groups.length} group(s) found</p>
                    <table>
                        <thead>
                            <tr><th>Group ID</th><th>State</th><th>Protocol</th><th>Members</th><th>Total Lag</th></tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to load consumer groups: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('streamline.viewTopology', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            try {
                const [info, topics] = await Promise.all([
                    client.getInfo(),
                    client.listTopics()
                ]);

                const uptimeHours = Math.floor(info.uptime / 3600);
                const uptimeMinutes = Math.floor((info.uptime % 3600) / 60);
                const uptimeStr = `${uptimeHours}h ${uptimeMinutes}m`;

                const connInfo = client.getConnectionInfo();

                let topicRows = '';
                for (const t of topics) {
                    topicRows += `<tr>
                        <td>${escapeHtml(t.name)}</td>
                        <td>${t.partitions}</td>
                        <td>${t.replicationFactor}</td>
                    </tr>`;
                }

                const topicTable = topics.length > 0
                    ? `<table>
                        <thead>
                            <tr><th>Topic</th><th>Partitions</th><th>Replication Factor</th></tr>
                        </thead>
                        <tbody>${topicRows}</tbody>
                    </table>`
                    : '<div class="empty">No topics found</div>';

                createStyledWebviewPanel(
                    'streamlineTopology',
                    'Cluster Topology',
                    `<h1>Cluster Topology</h1>
                    <h2>Server Info</h2>
                    <div class="info-grid">
                        <span class="info-label">Address:</span><span>${escapeHtml(connInfo.host)}:${connInfo.port}</span>
                        <span class="info-label">Version:</span><span>${escapeHtml(info.version)}</span>
                        <span class="info-label">Uptime:</span><span>${uptimeStr}</span>
                    </div>
                    <h2>Topics (${topics.length})</h2>
                    ${topicTable}`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to load cluster topology: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('streamline.traceMessage', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            try {
                const topics = await client.listTopics();
                const topicNames = topics.map(t => t.name);

                if (topicNames.length === 0) {
                    vscode.window.showWarningMessage('No topics available');
                    return;
                }

                const topic = await vscode.window.showQuickPick(topicNames, {
                    placeHolder: 'Select topic to trace message from'
                });
                if (!topic) { return; }

                const partitionStr = await vscode.window.showInputBox({
                    prompt: 'Partition number',
                    value: '0',
                    placeHolder: '0'
                });
                if (partitionStr === undefined) { return; }
                const partition = parseInt(partitionStr) || 0;

                const offsetStr = await vscode.window.showInputBox({
                    prompt: 'Message offset',
                    value: '0',
                    placeHolder: '0'
                });
                if (offsetStr === undefined) { return; }
                const offset = parseInt(offsetStr) || 0;

                const messages = await client.consume(topic, {
                    partition,
                    offset,
                    limit: 1
                });

                if (messages.length === 0) {
                    createStyledWebviewPanel(
                        'streamlineTraceMessage',
                        `Trace: ${topic}`,
                        `<h1>Trace Message</h1>
                        <div class="empty">No message found at partition ${partition}, offset ${offset}</div>`
                    );
                    return;
                }

                const msg = messages[0];
                let formattedValue = msg.value;
                try {
                    formattedValue = JSON.stringify(JSON.parse(msg.value), null, 2);
                } catch { /* not JSON, show raw */ }

                const headersHtml = Object.keys(msg.headers || {}).length > 0
                    ? `<h2>Headers</h2>
                    <div class="info-grid">
                        ${Object.entries(msg.headers).map(([k, v]) =>
                            `<span class="info-label">${escapeHtml(k)}:</span><span>${escapeHtml(v)}</span>`
                        ).join('')}
                    </div>`
                    : '';

                createStyledWebviewPanel(
                    'streamlineTraceMessage',
                    `Trace: ${topic}[${partition}]@${offset}`,
                    `<h1>Trace Message</h1>
                    <h2>Metadata</h2>
                    <div class="info-grid">
                        <span class="info-label">Topic:</span><span>${escapeHtml(msg.topic)}</span>
                        <span class="info-label">Partition:</span><span>${msg.partition}</span>
                        <span class="info-label">Offset:</span><span>${msg.offset}</span>
                        <span class="info-label">Timestamp:</span><span>${new Date(msg.timestamp).toISOString()}</span>
                        <span class="info-label">Key:</span><span>${msg.key ? escapeHtml(msg.key) : '<em>null</em>'}</span>
                    </div>
                    ${headersHtml}
                    <h2>Value</h2>
                    <div class="code">${escapeHtml(formattedValue)}</div>`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to trace message: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('streamline.viewLagDashboard', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            try {
                const groups = await client.listConsumerGroups();

                if (groups.length === 0) {
                    createStyledWebviewPanel(
                        'streamlineLagDashboard',
                        'Consumer Lag Dashboard',
                        '<h1>Consumer Lag Dashboard</h1><div class="empty">No consumer groups found</div>'
                    );
                    return;
                }

                const details = await Promise.all(
                    groups.map(g => client!.describeConsumerGroup(g.groupId).catch(() => null))
                );

                let summaryRows = '';
                let detailSections = '';

                for (let i = 0; i < groups.length; i++) {
                    const g = groups[i];
                    const d = details[i];
                    const lagEntries = d?.lag || [];
                    const totalLag = lagEntries.reduce((sum, l) => sum + l.lag, 0);
                    const maxLag = lagEntries.length > 0 ? Math.max(...lagEntries.map(l => l.lag)) : 0;
                    const lagClass = totalLag === 0 ? 'badge-stable'
                        : totalLag < 1000 ? 'badge-warn' : 'badge-error';

                    summaryRows += `<tr>
                        <td>${escapeHtml(g.groupId)}</td>
                        <td><span class="badge ${lagClass}">${totalLag}</span></td>
                        <td>${maxLag}</td>
                        <td>${lagEntries.length}</td>
                    </tr>`;

                    if (lagEntries.length > 0) {
                        const lagRows = lagEntries.map(l => {
                            const pct = maxLag > 0 ? Math.round((l.lag / maxLag) * 100) : 0;
                            const barClass = l.lag === 0 ? 'bar-normal'
                                : l.lag > maxLag * 0.8 ? 'bar-hot' : 'bar-warm';
                            return `<tr>
                                <td>${escapeHtml(l.topic)}</td>
                                <td>${l.partition}</td>
                                <td>${l.lag}</td>
                                <td><div class="bar-container"><div class="bar-fill ${barClass}" style="width: ${Math.max(pct, 2)}%"></div></div></td>
                            </tr>`;
                        }).join('');

                        detailSections += `<h2>${escapeHtml(g.groupId)}</h2>
                        <table>
                            <thead><tr><th>Topic</th><th>Partition</th><th>Lag</th><th>Relative</th></tr></thead>
                            <tbody>${lagRows}</tbody>
                        </table>`;
                    }
                }

                createStyledWebviewPanel(
                    'streamlineLagDashboard',
                    'Consumer Lag Dashboard',
                    `<h1>Consumer Lag Dashboard</h1>
                    <h2>Summary</h2>
                    <table>
                        <thead><tr><th>Group ID</th><th>Total Lag</th><th>Max Partition Lag</th><th>Partitions</th></tr></thead>
                        <tbody>${summaryRows}</tbody>
                    </table>
                    ${detailSections}`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to load lag dashboard: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('streamline.viewPartitionHotspots', async () => {
            if (!client) {
                vscode.window.showErrorMessage('Not connected to Streamline');
                return;
            }

            try {
                const topics = await client.listTopics();

                if (topics.length === 0) {
                    createStyledWebviewPanel(
                        'streamlinePartitionHotspots',
                        'Partition Hotspots',
                        '<h1>Partition Hotspots</h1><div class="empty">No topics found</div>'
                    );
                    return;
                }

                const topicDetails = await Promise.all(
                    topics.map(t => client!.describeTopic(t.name).catch(() => null))
                );

                let sections = '';
                for (let i = 0; i < topics.length; i++) {
                    const t = topics[i];
                    const d = topicDetails[i];
                    if (!d || !d.partitions || d.partitions.length === 0) { continue; }

                    const partitions = d.partitions.map(p => ({
                        id: p.partition,
                        size: p.endOffset - p.beginningOffset,
                        leader: p.leader,
                        isr: p.isr
                    }));

                    const totalMessages = partitions.reduce((sum, p) => sum + p.size, 0);
                    const maxSize = Math.max(...partitions.map(p => p.size));
                    const avgSize = totalMessages / partitions.length;

                    const rows = partitions.map(p => {
                        const pct = maxSize > 0 ? Math.round((p.size / maxSize) * 100) : 0;
                        const deviation = avgSize > 0 ? ((p.size - avgSize) / avgSize * 100).toFixed(1) : '0.0';
                        const isHot = p.size > avgSize * 1.5;
                        const barClass = isHot ? 'bar-hot'
                            : p.size > avgSize * 1.1 ? 'bar-warm' : 'bar-normal';

                        return `<tr>
                            <td>${p.id}</td>
                            <td>${p.size.toLocaleString()}</td>
                            <td>${deviation}%</td>
                            <td>${p.leader}</td>
                            <td>${p.isr.length}/${d!.partitions.length > 0 ? d!.partitions[0].replicas?.length ?? 1 : 1}</td>
                            <td><div class="bar-container"><div class="bar-fill ${barClass}" style="width: ${Math.max(pct, 2)}%"></div></div></td>
                        </tr>`;
                    }).join('');

                    const skew = avgSize > 0
                        ? Math.round(((maxSize - avgSize) / avgSize) * 100)
                        : 0;
                    const skewClass = skew > 50 ? 'badge-error'
                        : skew > 20 ? 'badge-warn' : 'badge-stable';

                    sections += `<h2>${escapeHtml(t.name)}
                        <span class="badge ${skewClass}">skew: ${skew}%</span>
                    </h2>
                    <div class="info-grid">
                        <span class="info-label">Total messages:</span><span>${totalMessages.toLocaleString()}</span>
                        <span class="info-label">Avg per partition:</span><span>${Math.round(avgSize).toLocaleString()}</span>
                        <span class="info-label">Max partition:</span><span>${maxSize.toLocaleString()}</span>
                    </div>
                    <table>
                        <thead><tr><th>Partition</th><th>Messages</th><th>Deviation</th><th>Leader</th><th>ISR</th><th>Distribution</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>`;
                }

                if (!sections) {
                    sections = '<div class="empty">No partition data available</div>';
                }

                createStyledWebviewPanel(
                    'streamlinePartitionHotspots',
                    'Partition Hotspots',
                    `<h1>Partition Hotspots</h1>
                    <p>Analyzing partition size distribution across ${topics.length} topic(s)</p>
                    ${sections}`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to load partition hotspots: ${error.message}`);
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
