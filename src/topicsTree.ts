import * as vscode from 'vscode';
import { StreamlineClient, TopicInfo, PartitionInfo } from './client';

export class TopicItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly topic?: TopicInfo,
        public readonly partition?: PartitionInfo
    ) {
        super(label, collapsibleState);

        if (topic && !partition) {
            // Topic item
            this.contextValue = 'topic';
            this.description = `${topic.partitions} partition${topic.partitions !== 1 ? 's' : ''}`;
            this.iconPath = new vscode.ThemeIcon('folder');
            this.tooltip = `Topic: ${topic.name}\nPartitions: ${topic.partitions}\nReplication: ${topic.replicationFactor}`;
        } else if (partition) {
            // Partition item
            this.contextValue = 'partition';
            this.description = `offsets: ${partition.beginningOffset}-${partition.endOffset}`;
            this.iconPath = new vscode.ThemeIcon('file');
            this.tooltip = `Partition: ${partition.partition}\nLeader: ${partition.leader}\nReplicas: ${partition.replicas.join(', ')}\nISR: ${partition.isr.join(', ')}\nBeginning Offset: ${partition.beginningOffset}\nEnd Offset: ${partition.endOffset}`;
        }
    }
}

export class TopicsTreeProvider implements vscode.TreeDataProvider<TopicItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TopicItem | undefined | null | void> = new vscode.EventEmitter<TopicItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TopicItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private client: StreamlineClient | undefined;
    private topics: TopicInfo[] = [];
    private topicDetails: Map<string, PartitionInfo[]> = new Map();

    constructor() {}

    setClient(client: StreamlineClient | undefined): void {
        this.client = client;
        this.topics = [];
        this.topicDetails.clear();
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TopicItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TopicItem): Promise<TopicItem[]> {
        if (!this.client) {
            return [new TopicItem('Not connected', vscode.TreeItemCollapsibleState.None)];
        }

        if (!element) {
            // Root level - show topics
            try {
                this.topics = await this.client.listTopics();

                if (this.topics.length === 0) {
                    return [new TopicItem('No topics found', vscode.TreeItemCollapsibleState.None)];
                }

                return this.topics.map(topic =>
                    new TopicItem(
                        topic.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        topic
                    )
                );
            } catch (error: any) {
                console.error('Failed to list topics:', error);
                return [new TopicItem(`Error: ${error.message}`, vscode.TreeItemCollapsibleState.None)];
            }
        } else if (element.topic && !element.partition) {
            // Topic level - show partitions
            try {
                const details = await this.client.describeTopic(element.topic.name);
                this.topicDetails.set(element.topic.name, details.partitions);

                return details.partitions.map(partition =>
                    new TopicItem(
                        `Partition ${partition.partition}`,
                        vscode.TreeItemCollapsibleState.None,
                        element.topic,
                        partition
                    )
                );
            } catch (error: any) {
                console.error('Failed to describe topic:', error);
                return [new TopicItem(`Error: ${error.message}`, vscode.TreeItemCollapsibleState.None)];
            }
        }

        return [];
    }

    getParent(element: TopicItem): vscode.ProviderResult<TopicItem> {
        if (element.partition && element.topic) {
            // Partition's parent is the topic
            return new TopicItem(
                element.topic.name,
                vscode.TreeItemCollapsibleState.Collapsed,
                element.topic
            );
        }
        return null;
    }
}
