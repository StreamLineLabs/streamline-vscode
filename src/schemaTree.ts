import * as vscode from 'vscode';
import { StreamlineClient, SchemaInfo } from './client';

export class SchemaTreeProvider implements vscode.TreeDataProvider<SchemaTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SchemaTreeItem | undefined | null | void> =
        new vscode.EventEmitter<SchemaTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SchemaTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private client: StreamlineClient | undefined;

    setClient(client: StreamlineClient | undefined) {
        this.client = client;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SchemaTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SchemaTreeItem): Promise<SchemaTreeItem[]> {
        if (!this.client) {
            return [new SchemaTreeItem('Not connected', vscode.TreeItemCollapsibleState.None, 'info')];
        }

        try {
            if (!element) {
                // Root level - show subjects
                const subjects = await this.client.listSubjects();
                if (subjects.length === 0) {
                    return [new SchemaTreeItem('No schemas registered', vscode.TreeItemCollapsibleState.None, 'info')];
                }
                return subjects.map(subject =>
                    new SchemaTreeItem(
                        subject,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'subject',
                        { subject }
                    )
                );
            }

            if (element.itemType === 'subject') {
                // Show versions for this subject
                const versions = await this.client.getSubjectVersions(element.data.subject);
                return versions.map(version =>
                    new SchemaTreeItem(
                        `v${version}`,
                        vscode.TreeItemCollapsibleState.None,
                        'version',
                        { subject: element.data.subject, version }
                    )
                );
            }

            return [];
        } catch (error: any) {
            console.error('Error fetching schemas:', error);
            return [new SchemaTreeItem(`Error: ${error.message}`, vscode.TreeItemCollapsibleState.None, 'error')];
        }
    }
}

export class SchemaTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: 'subject' | 'version' | 'info' | 'error',
        public readonly data: any = {}
    ) {
        super(label, collapsibleState);

        this.contextValue = itemType;

        switch (itemType) {
            case 'subject':
                this.iconPath = new vscode.ThemeIcon('file-code');
                this.tooltip = `Schema subject: ${label}`;
                break;
            case 'version':
                this.iconPath = new vscode.ThemeIcon('versions');
                this.tooltip = `Version ${data.version} of ${data.subject}`;
                this.command = {
                    command: 'streamline.viewSchemaVersion',
                    title: 'View Schema',
                    arguments: [this]
                };
                break;
            case 'info':
                this.iconPath = new vscode.ThemeIcon('info');
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error');
                break;
        }
    }
}

/**
 * Panel for viewing schema details
 */
export class SchemaViewerPanel {
    public static currentPanel: SchemaViewerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        client: StreamlineClient,
        subject: string,
        version: number | 'latest'
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (SchemaViewerPanel.currentPanel) {
            SchemaViewerPanel.currentPanel._panel.reveal(column);
            await SchemaViewerPanel.currentPanel._update(client, subject, version);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'streamlineSchemaViewer',
            `Schema: ${subject}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SchemaViewerPanel.currentPanel = new SchemaViewerPanel(panel, extensionUri);
        await SchemaViewerPanel.currentPanel._update(client, subject, version);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public dispose() {
        SchemaViewerPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update(client: StreamlineClient, subject: string, version: number | 'latest') {
        this._panel.title = `Schema: ${subject}`;

        try {
            const schema = await client.getSchema(subject, version);
            const compatibility = await client.getSubjectCompatibility(subject).catch(() => ({ compatibilityLevel: 'UNKNOWN' }));
            const versions = await client.getSubjectVersions(subject);

            this._panel.webview.html = this._getHtmlForWebview(schema, compatibility.compatibilityLevel, versions);
        } catch (error: any) {
            this._panel.webview.html = this._getErrorHtml(error.message);
        }
    }

    private _getHtmlForWebview(schema: SchemaInfo, compatibility: string, versions: number[]): string {
        // Pretty print the schema
        let formattedSchema = schema.schema;
        try {
            const parsed = JSON.parse(schema.schema);
            formattedSchema = JSON.stringify(parsed, null, 2);
        } catch {
            // Keep original if not valid JSON
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Schema Viewer</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 16px;
            margin-bottom: 16px;
        }
        .header h1 {
            margin: 0 0 8px 0;
            font-size: 1.5em;
        }
        .metadata {
            display: flex;
            gap: 24px;
            flex-wrap: wrap;
        }
        .metadata-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .metadata-label {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }
        .metadata-value {
            font-weight: 500;
        }
        .badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.85em;
        }
        .schema-container {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 16px;
            overflow-x: auto;
        }
        pre {
            margin: 0;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.5;
        }
        .versions {
            margin-top: 16px;
        }
        .versions-list {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 8px;
        }
        .version-chip {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            cursor: pointer;
        }
        .version-chip.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .section-title {
            font-size: 1.1em;
            font-weight: 500;
            margin: 16px 0 8px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${escapeHtml(schema.subject)}</h1>
        <div class="metadata">
            <div class="metadata-item">
                <span class="metadata-label">Version:</span>
                <span class="badge">${schema.version}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Schema ID:</span>
                <span class="metadata-value">${schema.id}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Type:</span>
                <span class="badge">${schema.schemaType || 'AVRO'}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Compatibility:</span>
                <span class="badge">${compatibility}</span>
            </div>
        </div>
    </div>

    <div class="versions">
        <div class="section-title">Available Versions</div>
        <div class="versions-list">
            ${versions.map(v => `<span class="version-chip ${v === schema.version ? 'active' : ''}">v${v}</span>`).join('')}
        </div>
    </div>

    <div class="section-title">Schema Definition</div>
    <div class="schema-container">
        <pre>${escapeHtml(formattedSchema)}</pre>
    </div>
</body>
</html>`;
    }

    private _getErrorHtml(message: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <h2>Error Loading Schema</h2>
    <p>${escapeHtml(message)}</p>
</body>
</html>`;
    }
}

function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
