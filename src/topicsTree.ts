import * as vscode from 'vscode';
import { StreamlineClient, TopicInfo, PartitionInfo } from './client';

/** Additional topic metadata fetched from the HTTP API. */
export interface TopicMeta {
    semanticEmbed?: boolean;
    hasContract?: boolean;
    contractName?: string;
}

export class TopicItem extends vscode.TreeItem {
    public topicMeta?: TopicMeta;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly topic?: TopicInfo,
        public readonly partition?: PartitionInfo,
        topicMeta?: TopicMeta,
    ) {
        super(label, collapsibleState);
        this.topicMeta = topicMeta;

        if (topic && !partition) {
            // Topic item
            this.contextValue = 'topic';
            const badges: string[] = [];
            if (topicMeta?.semanticEmbed) { badges.push('🧠'); }
            if (topicMeta?.hasContract) { badges.push('📜'); }
            const badgeStr = badges.length > 0 ? ` ${badges.join(' ')}` : '';
            this.description = `${topic.partitions} partition${topic.partitions !== 1 ? 's' : ''}${badgeStr}`;
            this.iconPath = new vscode.ThemeIcon(
                topicMeta?.semanticEmbed ? 'symbol-field' : 'folder'
            );
            let tip = `Topic: ${topic.name}\nPartitions: ${topic.partitions}\nReplication: ${topic.replicationFactor}`;
            if (topicMeta?.semanticEmbed) { tip += '\nSemantic Embed: on'; }
            if (topicMeta?.hasContract) { tip += `\nContract: ${topicMeta.contractName ?? 'active'}`; }
            this.tooltip = tip;
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
    private topicMetaCache: Map<string, TopicMeta> = new Map();

    constructor() {}

    setClient(client: StreamlineClient | undefined): void {
        this.client = client;
        this.topics = [];
        this.topicDetails.clear();
        this.topicMetaCache.clear();
        this.refresh();
    }

    /** Update metadata cache from topic config. Called externally after connect. */
    setTopicMeta(topicName: string, meta: TopicMeta): void {
        this.topicMetaCache.set(topicName, meta);
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

                // Attempt to enrich topic metadata from topic config
                for (const topic of this.topics) {
                    if (!this.topicMetaCache.has(topic.name)) {
                        try {
                            const detail = await this.client.describeTopic(topic.name);
                            const config = (detail as any).config as Record<string, string> | undefined;
                            if (config) {
                                this.topicMetaCache.set(topic.name, {
                                    semanticEmbed: config['semantic.embed'] === 'on',
                                    hasContract: !!config['contract.name'],
                                    contractName: config['contract.name'] || undefined,
                                });
                            }
                        } catch {
                            // Config may not be available; ignore
                        }
                    }
                }

                return this.topics.map(topic =>
                    new TopicItem(
                        topic.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        topic,
                        undefined,
                        this.topicMetaCache.get(topic.name),
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


/**
 * Formats a partition offset for display, handling special values.
 */
function formatOffset(offset: number): string {
    if (offset === -1) return 'latest';
    if (offset === -2) return 'earliest';
    return offset.toLocaleString();
}
