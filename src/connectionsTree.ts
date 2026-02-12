import * as vscode from 'vscode';

interface ConnectionConfig {
    name: string;
    host: string;
    port: number;
    httpPort: number;
}

class ConnectionItem extends vscode.TreeItem {
    constructor(
        public readonly connection: ConnectionConfig,
        public readonly isActive: boolean
    ) {
        super(connection.name, vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'connection';
        this.description = `${connection.host}:${connection.httpPort || 9094}`;
        this.iconPath = isActive
            ? new vscode.ThemeIcon('plug', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('plug');
        this.tooltip = `Name: ${connection.name}\nHost: ${connection.host}\nKafka Port: ${connection.port}\nHTTP Port: ${connection.httpPort || 9094}`;

        this.command = {
            command: 'streamline.selectConnection',
            title: 'Select Connection',
            arguments: [this]
        };
    }
}

export class ConnectionsTreeProvider implements vscode.TreeDataProvider<ConnectionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConnectionItem | undefined | null | void> = new vscode.EventEmitter<ConnectionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConnectionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private activeConnectionName: string | undefined;

    constructor() {}

    setActiveConnection(name: string | undefined): void {
        this.activeConnectionName = name;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConnectionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ConnectionItem): Promise<ConnectionItem[]> {
        if (element) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('streamline');
        const connections = config.get<ConnectionConfig[]>('connections') || [];

        if (connections.length === 0) {
            // Return a placeholder item
            const item = new vscode.TreeItem('No saved connections');
            item.description = 'Use Command Palette to connect';
            return [item as any];
        }

        return connections.map(conn =>
            new ConnectionItem(conn, conn.name === this.activeConnectionName)
        );
    }

    getParent(): vscode.ProviderResult<ConnectionItem> {
        return null;
    }

    async addConnection(): Promise<ConnectionConfig | undefined> {
        const name = await vscode.window.showInputBox({
            prompt: 'Connection name',
            placeHolder: 'my-cluster'
        });

        if (!name) {
            return undefined;
        }

        const host = await vscode.window.showInputBox({
            prompt: 'Server host',
            value: 'localhost'
        });

        if (!host) {
            return undefined;
        }

        const portStr = await vscode.window.showInputBox({
            prompt: 'Kafka protocol port',
            value: '9092'
        });

        const httpPortStr = await vscode.window.showInputBox({
            prompt: 'HTTP API port',
            value: '9094'
        });

        const connection: ConnectionConfig = {
            name,
            host,
            port: parseInt(portStr || '9092'),
            httpPort: parseInt(httpPortStr || '9094')
        };

        const config = vscode.workspace.getConfiguration('streamline');
        const connections = config.get<ConnectionConfig[]>('connections') || [];
        connections.push(connection);
        await config.update('connections', connections, vscode.ConfigurationTarget.Global);

        this.refresh();
        return connection;
    }

    async removeConnection(item: ConnectionItem): Promise<void> {
        const config = vscode.workspace.getConfiguration('streamline');
        const connections = config.get<ConnectionConfig[]>('connections') || [];
        const updated = connections.filter(c => c.name !== item.connection.name);
        await config.update('connections', updated, vscode.ConfigurationTarget.Global);
        this.refresh();
    }
}
