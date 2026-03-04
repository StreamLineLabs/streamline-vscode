import * as vscode from 'vscode';
import { StreamlineClient, ConsumerGroupInfo, ConsumerGroupMember } from './client';

class ConsumerGroupItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly group?: ConsumerGroupInfo,
        public readonly member?: ConsumerGroupMember,
        public readonly lagInfo?: { topic: string; partition: number; lag: number }
    ) {
        super(label, collapsibleState);

        if (group && !member && !lagInfo) {
            // Consumer group item
            this.contextValue = 'consumerGroup';
            this.description = `${group.state} (${group.members} members)`;
            this.iconPath = new vscode.ThemeIcon('organization');
            this.tooltip = `Group: ${group.groupId}\nState: ${group.state}\nProtocol: ${group.protocol}\nMembers: ${group.members}`;
        } else if (member) {
            // Member item
            this.contextValue = 'member';
            this.description = member.host;
            this.iconPath = new vscode.ThemeIcon('person');
            this.tooltip = `Member: ${member.memberId}\nClient: ${member.clientId}\nHost: ${member.host}\nAssignments: ${member.assignments.map(a => `${a.topic}[${a.partitions.join(',')}]`).join(', ')}`;
        } else if (lagInfo) {
            // Lag info item
            this.contextValue = 'lag';
            this.description = `lag: ${lagInfo.lag}`;
            this.iconPath = lagInfo.lag > 1000
                ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'))
                : new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
            this.tooltip = `Topic: ${lagInfo.topic}\nPartition: ${lagInfo.partition}\nLag: ${lagInfo.lag}`;
        }
    }
}

export class ConsumerGroupsTreeProvider implements vscode.TreeDataProvider<ConsumerGroupItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConsumerGroupItem | undefined | null | void> = new vscode.EventEmitter<ConsumerGroupItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConsumerGroupItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private client: StreamlineClient | undefined;
    private groups: ConsumerGroupInfo[] = [];

    constructor() {}

    setClient(client: StreamlineClient | undefined): void {
        this.client = client;
        this.groups = [];
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConsumerGroupItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ConsumerGroupItem): Promise<ConsumerGroupItem[]> {
        if (!this.client) {
            return [new ConsumerGroupItem('Not connected', vscode.TreeItemCollapsibleState.None)];
        }

        if (!element) {
            // Root level - show consumer groups
            try {
                this.groups = await this.client.listConsumerGroups();

                if (this.groups.length === 0) {
                    return [new ConsumerGroupItem('No consumer groups found', vscode.TreeItemCollapsibleState.None)];
                }

                return this.groups.map(group =>
                    new ConsumerGroupItem(
                        group.groupId,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        group
                    )
                );
            } catch (error: any) {
                console.error('Failed to list consumer groups:', error);
                return [new ConsumerGroupItem(`Error: ${error.message}`, vscode.TreeItemCollapsibleState.None)];
            }
        } else if (element.group && !element.member && !element.lagInfo) {
            // Group level - show members and lag
            try {
                const details = await this.client.describeConsumerGroup(element.group.groupId);
                const items: ConsumerGroupItem[] = [];

                // Add members section
                if (details.members.length > 0) {
                    items.push(new ConsumerGroupItem(
                        'Members',
                        vscode.TreeItemCollapsibleState.Expanded
                    ));
                    for (const member of details.members) {
                        items.push(new ConsumerGroupItem(
                            member.clientId,
                            vscode.TreeItemCollapsibleState.None,
                            element.group,
                            member
                        ));
                    }
                }

                // Add lag section
                if (details.lag && details.lag.length > 0) {
                    items.push(new ConsumerGroupItem(
                        'Partition Lag',
                        vscode.TreeItemCollapsibleState.Expanded
                    ));
                    for (const lag of details.lag) {
                        items.push(new ConsumerGroupItem(
                            `${lag.topic}[${lag.partition}]`,
                            vscode.TreeItemCollapsibleState.None,
                            element.group,
                            undefined,
                            lag
                        ));
                    }
                }

                return items.length > 0 ? items : [
                    new ConsumerGroupItem('No members or lag info', vscode.TreeItemCollapsibleState.None)
                ];
            } catch (error: any) {
                console.error('Failed to describe consumer group:', error);
                return [new ConsumerGroupItem(`Error: ${error.message}`, vscode.TreeItemCollapsibleState.None)];
            }
        }

        return [];
    }

    getParent(element: ConsumerGroupItem): vscode.ProviderResult<ConsumerGroupItem> {
        if ((element.member || element.lagInfo) && element.group) {
            return new ConsumerGroupItem(
                element.group.groupId,
                vscode.TreeItemCollapsibleState.Collapsed,
                element.group
            );
        }
        return null;
    }
}

