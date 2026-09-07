import * as vscode from 'vscode';
import { StreamlineClient, Message } from './client';
import { escapeHtml, createNonce, cspMetaTag } from './html';
import { getEffectiveMaxMessages, getEffectiveRefreshInterval } from './config';

/** A full page means the server may have another page to fetch. */
export function hasMoreMessages(receivedCount: number, pageSize: number): boolean {
    return receivedCount >= pageSize;
}

export class MessageViewerPanel {
    public static currentPanel: MessageViewerPanel | undefined;
    public static readonly viewType = 'streamlineMessageViewer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _client: StreamlineClient;
    private readonly _topic: string;
    private _disposables: vscode.Disposable[] = [];
    private _messages: Message[] = [];
    private _hasMoreMessages: boolean = false;
    private _autoRefresh: boolean = false;
    private _refreshInterval: NodeJS.Timeout | undefined;

    public static createOrShow(extensionUri: vscode.Uri, client: StreamlineClient, topic: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (MessageViewerPanel.currentPanel && MessageViewerPanel.currentPanel._topic === topic) {
            MessageViewerPanel.currentPanel._panel.reveal(column);
            return;
        }

        if (MessageViewerPanel.currentPanel) {
            MessageViewerPanel.currentPanel.dispose();
        }

        const panel = vscode.window.createWebviewPanel(
            MessageViewerPanel.viewType,
            `Messages: ${topic}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        MessageViewerPanel.currentPanel = new MessageViewerPanel(panel, extensionUri, client, topic);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        client: StreamlineClient,
        topic: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._client = client;
        this._topic = topic;

        this._update();
        this._loadMessages();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'refresh':
                        await this._loadMessages();
                        break;
                    case 'toggleAutoRefresh':
                        this._toggleAutoRefresh();
                        break;
                    case 'loadMore':
                        await this._loadMore(message.offset);
                        break;
                    case 'copyMessage':
                        await vscode.env.clipboard.writeText(message.content);
                        vscode.window.showInformationMessage('Message copied to clipboard');
                        break;
                    case 'filter':
                        this._filterMessages(message.query);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _loadMessages() {
        try {
            const limit = getEffectiveMaxMessages();

            this._messages = await this._client.consume(this._topic, {
                limit,
                offset: 0
            });
            this._hasMoreMessages = hasMoreMessages(this._messages.length, limit);

            this._updateContent();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load messages: ${error.message}`);
        }
    }

    private async _loadMore(fromOffset: number) {
        try {
            const limit = getEffectiveMaxMessages();

            const moreMessages = await this._client.consume(this._topic, {
                limit,
                offset: fromOffset
            });

            this._messages = [...this._messages, ...moreMessages];
            this._hasMoreMessages = hasMoreMessages(moreMessages.length, limit);
            this._updateContent();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load more messages: ${error.message}`);
        }
    }

    private _toggleAutoRefresh() {
        this._autoRefresh = !this._autoRefresh;

        if (this._autoRefresh) {
            const interval = getEffectiveRefreshInterval();

            this._refreshInterval = setInterval(() => {
                this._loadMessages();
            }, interval);
        } else if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = undefined;
        }

        this._updateContent();
    }

    private _filterMessages(query: string) {
        // Send filtered messages to webview
        const filtered = query
            ? this._messages.filter(m =>
                m.value.toLowerCase().includes(query.toLowerCase()) ||
                (m.key && m.key.toLowerCase().includes(query.toLowerCase()))
            )
            : this._messages;

        this._panel.webview.postMessage({
            command: 'updateMessages',
            messages: filtered,
            total: this._messages.length,
            hasMore: this._hasMoreMessages
        });
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _updateContent() {
        this._panel.webview.postMessage({
            command: 'updateMessages',
            messages: this._messages,
            total: this._messages.length,
            hasMore: this._hasMoreMessages,
            autoRefresh: this._autoRefresh
        });
    }

    private _getHtmlForWebview(): string {
        const nonce = createNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${cspMetaTag(nonce, this._panel.webview.cspSource)}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Messages: ${escapeHtml(this._topic)}</title>
    <style nonce="${nonce}">
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 10px;
            margin: 0;
        }
        .toolbar {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            padding: 10px;
            background: var(--vscode-toolbar-background);
            border-radius: 4px;
        }
        .toolbar button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 2px;
        }
        .toolbar button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .toolbar button.active {
            background: var(--vscode-button-secondaryBackground);
        }
        .search-box {
            flex: 1;
            padding: 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        .stats {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-bottom: 10px;
        }
        .message-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .message {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .message-key {
            color: var(--vscode-symbolIcon-keywordForeground);
            font-weight: bold;
        }
        .message-value {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-all;
            background: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 2px;
            max-height: 200px;
            overflow: auto;
        }
        .message-actions {
            margin-top: 8px;
        }
        .message-actions button {
            background: transparent;
            color: var(--vscode-textLink-foreground);
            border: none;
            cursor: pointer;
            font-size: 11px;
            padding: 2px 6px;
        }
        .message-actions button:hover {
            text-decoration: underline;
        }
        .load-more {
            text-align: center;
            margin-top: 15px;
        }
        /* Toggled from script; inline style attributes are blocked by the CSP. */
        .hidden {
            display: none;
        }
        .empty {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="refreshBtn" title="Refresh">Refresh</button>
        <button id="autoRefreshBtn" title="Toggle Auto-Refresh">Auto-Refresh: OFF</button>
        <input type="text" class="search-box" id="searchBox" placeholder="Search messages...">
    </div>
    <div class="stats" id="stats">Loading messages...</div>
    <div class="message-list" id="messageList"></div>
    <div class="load-more hidden" id="loadMore">
        <button id="loadMoreBtn">Load More</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let messages = [];
        let lastOffset = 0;

        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        document.getElementById('autoRefreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'toggleAutoRefresh' });
        });

        document.getElementById('searchBox').addEventListener('input', (e) => {
            vscode.postMessage({ command: 'filter', query: e.target.value });
        });

        document.getElementById('loadMoreBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'loadMore', offset: lastOffset });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateMessages':
                    messages = message.messages;
                    renderMessages(messages, message.total, Boolean(message.hasMore));
                    if (message.autoRefresh !== undefined) {
                        document.getElementById('autoRefreshBtn').textContent =
                            'Auto-Refresh: ' + (message.autoRefresh ? 'ON' : 'OFF');
                    }
                    break;
            }
        });

        function setLoadMoreVisible(visible) {
            document.getElementById('loadMore').classList.toggle('hidden', !visible);
        }

        function renderMessages(msgs, total, hasMore) {
            const list = document.getElementById('messageList');
            const stats = document.getElementById('stats');

            stats.textContent = 'Showing ' + msgs.length + ' of ' + total + ' messages';

            if (msgs.length === 0) {
                list.innerHTML = '<div class="empty">No messages found</div>';
                setLoadMoreVisible(false);
                return;
            }

            list.innerHTML = msgs.map((m, i) => {
                let valueDisplay = m.value;
                try {
                    const parsed = JSON.parse(m.value);
                    valueDisplay = JSON.stringify(parsed, null, 2);
                } catch { /* value is not valid JSON — display as-is */ }

                lastOffset = Math.max(lastOffset, m.offset + 1);

                return '<div class="message">' +
                    '<div class="message-header">' +
                        '<span>Partition: ' + escapeHtml(m.partition) + ' | Offset: ' + escapeHtml(m.offset) + '</span>' +
                        '<span>' + escapeHtml(new Date(m.timestamp).toLocaleString()) + '</span>' +
                    '</div>' +
                    (m.key ? '<div class="message-key">Key: ' + escapeHtml(m.key) + '</div>' : '') +
                    '<div class="message-value">' + escapeHtml(valueDisplay) + '</div>' +
                    '<div class="message-actions">' +
                        '<button class="copy-btn" data-index="' + escapeHtml(i) + '">Copy</button>' +
                    '</div>' +
                '</div>';
            }).join('');

            list.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', () => copyMessage(Number(btn.dataset.index)));
            });

            setLoadMoreVisible(hasMore);
        }

        function copyMessage(index) {
            const msg = messages[index];
            if (!msg) { return; }
            vscode.postMessage({ command: 'copyMessage', content: msg.value });
        }

        // Escapes any server-provided value; input may be a number or object.
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text === null || text === undefined ? '' : String(text);
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        MessageViewerPanel.currentPanel = undefined;

        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
        }

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
