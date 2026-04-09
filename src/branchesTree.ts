// Read-only Branches tree view (Moonshot M5).
//
// Lists branches reported by the Streamline Moonshot HTTP API. This view is
// intentionally read-only: branch creation/merge/delete are admin operations
// that should be performed via the SDKs / Terraform / kubectl, not from a
// developer's editor.
import * as vscode from 'vscode';

export interface MoonshotBranch {
    name: string;
    parent?: string;
    createdAtMs?: number;
}

/** Minimal HTTP client used by the tree view. Injectable for tests. */
export interface BranchesClient {
    listBranches(): Promise<MoonshotBranch[]>;
    baseUrl(): string;
}

export class HttpBranchesClient implements BranchesClient {
    constructor(
        private readonly base: string,
        private readonly token?: string,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    baseUrl(): string {
        return this.base;
    }

    async listBranches(): Promise<MoonshotBranch[]> {
        const url = this.base.replace(/\/+$/, '') + '/api/v1/branches';
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await this.fetchImpl(url, { headers });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Moonshot list branches failed: HTTP ${res.status} ${body}`);
        }
        const json = await res.json() as { branches?: MoonshotBranch[] };
        return Array.isArray(json.branches) ? json.branches : [];
    }
}

export class BranchItem extends vscode.TreeItem {
    constructor(public readonly branch: MoonshotBranch) {
        super(branch.name, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'moonshotBranch';
        this.iconPath = new vscode.ThemeIcon('git-branch');
        const parts: string[] = [];
        if (branch.parent) {
            parts.push(`parent: ${branch.parent}`);
        }
        if (branch.createdAtMs) {
            parts.push(`created: ${new Date(branch.createdAtMs).toISOString()}`);
        }
        this.description = parts.join('  ');
        this.tooltip = `Branch: ${branch.name}\n${parts.join('\n')}`;
    }
}

export class BranchesTreeProvider implements vscode.TreeDataProvider<BranchItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<BranchItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private client: BranchesClient | undefined;
    private branches: MoonshotBranch[] = [];
    private lastError: string | undefined;

    setClient(client: BranchesClient | undefined): void {
        this.client = client;
        this.branches = [];
        this.lastError = undefined;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BranchItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BranchItem): Promise<BranchItem[]> {
        if (element) {
            return [];
        }
        if (!this.client) {
            const item = new BranchItem({ name: '(no Moonshot URL configured)' });
            item.iconPath = new vscode.ThemeIcon('info');
            item.contextValue = 'moonshotInfo';
            return [item];
        }
        try {
            this.branches = await this.client.listBranches();
            this.lastError = undefined;
        } catch (err) {
            this.lastError = (err as Error).message;
            this.branches = [];
        }
        if (this.lastError) {
            const item = new BranchItem({ name: `Error: ${this.lastError}` });
            item.iconPath = new vscode.ThemeIcon('error');
            item.contextValue = 'moonshotError';
            return [item];
        }
        if (this.branches.length === 0) {
            const item = new BranchItem({ name: '(no branches)' });
            item.iconPath = new vscode.ThemeIcon('info');
            item.contextValue = 'moonshotInfo';
            return [item];
        }
        return this.branches.map(b => new BranchItem(b));
    }
}

/**
 * Read Moonshot connection info from the workspace configuration. Returns
 * undefined when no URL is set, in which case the tree view shows a hint.
 *
 * Configuration keys:
 *   streamline.moonshotUrl: string (e.g. http://localhost:9094)
 *   streamline.moonshotToken: string (optional bearer token)
 */
export function buildBranchesClientFromConfig(
    config: vscode.WorkspaceConfiguration,
    fetchImpl: typeof fetch = fetch,
): BranchesClient | undefined {
    const url = config.get<string>('moonshotUrl');
    if (!url) {
        return undefined;
    }
    const token = config.get<string>('moonshotToken') || undefined;
    return new HttpBranchesClient(url, token, fetchImpl);
}
