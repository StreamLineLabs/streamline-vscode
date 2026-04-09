// Memory tree view for AI agent memory coordination (Moonshot M1).
//
// Displays agents and their memory tiers (episodic, semantic, procedural)
// via the Streamline Moonshot HTTP API. Provides a "Search Memories" command.
import * as vscode from 'vscode';

export interface MemoryAgent {
    agentId: string;
    tenant: string;
    tiers: {
        episodicRetentionDays: number;
        semanticRetentionDays: number;
        proceduralRetentionDays: number;
    };
    decay?: {
        halfLifeDays: number;
        threshold: number;
    };
    encryptionEnabled: boolean;
    status?: string;
    episodicEventCount?: number;
    semanticEventCount?: number;
    proceduralEventCount?: number;
}

/** Minimal HTTP client used by the tree view. Injectable for tests. */
export interface MemoryClient {
    listMemories(): Promise<MemoryAgent[]>;
    searchMemories(agentId: string, query: string): Promise<MemorySearchResult[]>;
    baseUrl(): string;
}

export interface MemorySearchResult {
    tier: string;
    key: string;
    value: string;
    score: number;
    timestamp: number;
}

export class HttpMemoryClient implements MemoryClient {
    constructor(
        private readonly base: string,
        private readonly token?: string,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    baseUrl(): string {
        return this.base;
    }

    async listMemories(): Promise<MemoryAgent[]> {
        const url = this.base.replace(/\/+$/, '') + '/api/v1/memories';
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await this.fetchImpl(url, { headers });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Moonshot list memories failed: HTTP ${res.status} ${body}`);
        }
        const json = await res.json() as { memories?: MemoryAgent[] };
        return Array.isArray(json.memories) ? json.memories : [];
    }

    async searchMemories(agentId: string, query: string): Promise<MemorySearchResult[]> {
        const url = this.base.replace(/\/+$/, '') + `/api/v1/memories/${encodeURIComponent(agentId)}/search`;
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await this.fetchImpl(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Moonshot search memories failed: HTTP ${res.status} ${body}`);
        }
        const json = await res.json() as { results?: MemorySearchResult[] };
        return Array.isArray(json.results) ? json.results : [];
    }
}

type MemoryItemKind = 'agent' | 'tier' | 'info' | 'error';

export class MemoryItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsible: vscode.TreeItemCollapsibleState,
        public readonly kind: MemoryItemKind,
        public readonly agent?: MemoryAgent,
        public readonly tierName?: string,
    ) {
        super(label, collapsible);

        switch (kind) {
            case 'agent':
                this.contextValue = 'memoryAgent';
                this.iconPath = new vscode.ThemeIcon('hubot');
                if (agent) {
                    const parts: string[] = [`tenant: ${agent.tenant}`];
                    if (agent.encryptionEnabled) { parts.push('🔒'); }
                    this.description = parts.join('  ');
                    this.tooltip = `Agent: ${agent.agentId}\nTenant: ${agent.tenant}\nEncryption: ${agent.encryptionEnabled ? 'on' : 'off'}`;
                }
                break;
            case 'tier':
                this.contextValue = 'memoryTier';
                this.iconPath = new vscode.ThemeIcon('layers');
                break;
            case 'info':
                this.contextValue = 'memoryInfo';
                this.iconPath = new vscode.ThemeIcon('info');
                break;
            case 'error':
                this.contextValue = 'memoryError';
                this.iconPath = new vscode.ThemeIcon('error');
                break;
        }
    }
}

export class MemoryTreeProvider implements vscode.TreeDataProvider<MemoryItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<MemoryItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private client: MemoryClient | undefined;
    private agents: MemoryAgent[] = [];
    private lastError: string | undefined;

    setClient(client: MemoryClient | undefined): void {
        this.client = client;
        this.agents = [];
        this.lastError = undefined;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: MemoryItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: MemoryItem): Promise<MemoryItem[]> {
        if (!element) {
            // Root: list agents
            if (!this.client) {
                const item = new MemoryItem('(no Moonshot URL configured)', vscode.TreeItemCollapsibleState.None, 'info');
                return [item];
            }
            try {
                this.agents = await this.client.listMemories();
                this.lastError = undefined;
            } catch (err) {
                this.lastError = (err as Error).message;
                this.agents = [];
            }
            if (this.lastError) {
                return [new MemoryItem(`Error: ${this.lastError}`, vscode.TreeItemCollapsibleState.None, 'error')];
            }
            if (this.agents.length === 0) {
                return [new MemoryItem('(no agent memories)', vscode.TreeItemCollapsibleState.None, 'info')];
            }
            return this.agents.map(a =>
                new MemoryItem(a.agentId, vscode.TreeItemCollapsibleState.Collapsed, 'agent', a)
            );
        }

        if (element.kind === 'agent' && element.agent) {
            // Show tiers under an agent
            const agent = element.agent;
            const tiers = [
                {
                    name: 'episodic',
                    retention: agent.tiers.episodicRetentionDays,
                    count: agent.episodicEventCount,
                },
                {
                    name: 'semantic',
                    retention: agent.tiers.semanticRetentionDays,
                    count: agent.semanticEventCount,
                },
                {
                    name: 'procedural',
                    retention: agent.tiers.proceduralRetentionDays,
                    count: agent.proceduralEventCount,
                },
            ];

            return tiers.map(t => {
                const retDesc = t.retention < 0 ? '∞' : `${t.retention}d`;
                const countDesc = t.count !== undefined ? ` (${t.count} events)` : '';
                const item = new MemoryItem(
                    t.name,
                    vscode.TreeItemCollapsibleState.None,
                    'tier',
                    agent,
                    t.name,
                );
                item.description = `retention: ${retDesc}${countDesc}`;
                item.tooltip = `Tier: ${t.name}\nRetention: ${retDesc}\nEvents: ${t.count ?? 'unknown'}`;
                return item;
            });
        }

        return [];
    }
}

/**
 * Read Moonshot connection info from the workspace configuration and build
 * a MemoryClient. Returns undefined when no URL is set.
 */
export function buildMemoryClientFromConfig(
    config: vscode.WorkspaceConfiguration,
    fetchImpl: typeof fetch = fetch,
): MemoryClient | undefined {
    const url = config.get<string>('moonshotUrl');
    if (!url) {
        return undefined;
    }
    const token = config.get<string>('moonshotToken') || undefined;
    return new HttpMemoryClient(url, token, fetchImpl);
}
