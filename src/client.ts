import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as fs from 'fs';

export interface TopicInfo {
    name: string;
    partitions: number;
    replicationFactor: number;
}

export interface PartitionInfo {
    partition: number;
    leader: number;
    replicas: number[];
    isr: number[];
    beginningOffset: number;
    endOffset: number;
}

export interface ConsumerGroupInfo {
    groupId: string;
    state: string;
    protocol: string;
    members: number;
}

export interface ConsumerGroupMember {
    memberId: string;
    clientId: string;
    host: string;
    assignments: { topic: string; partitions: number[] }[];
}

export interface Message {
    topic: string;
    partition: number;
    offset: number;
    key: string | null;
    value: string;
    timestamp: number;
    headers: Record<string, string>;
}

export interface ProduceResult {
    topic: string;
    partition: number;
    offset: number;
}

export interface ConsumerGroupDetails {
    groupId: string;
    state: string;
    protocol: string;
    members: ConsumerGroupMember[];
    lag: { topic: string; partition: number; lag: number }[];
}

export interface TlsConfig {
    enabled: boolean;
    caCertPath?: string;
    clientCertPath?: string;
    clientKeyPath?: string;
    insecure?: boolean;
}

/**
 * HTTP client for Streamline server API
 */
export class StreamlineClient {
    private client: AxiosInstance;
    private host: string;
    private port: number;
    private tls: boolean;

    constructor(host: string, port: number, tls?: boolean, tlsConfig?: TlsConfig) {
        this.host = host;
        this.port = port;
        this.tls = tls || (tlsConfig?.enabled ?? false);

        const protocol = this.tls ? 'https' : 'http';
        let httpsAgent: https.Agent | undefined;

        if (this.tls) {
            const agentOptions: https.AgentOptions = {
                rejectUnauthorized: !(tlsConfig?.insecure),
            };
            if (tlsConfig?.caCertPath) {
                try { agentOptions.ca = fs.readFileSync(tlsConfig.caCertPath); } catch { /* ignore */ }
            }
            if (tlsConfig?.clientCertPath) {
                try { agentOptions.cert = fs.readFileSync(tlsConfig.clientCertPath); } catch { /* ignore */ }
            }
            if (tlsConfig?.clientKeyPath) {
                try { agentOptions.key = fs.readFileSync(tlsConfig.clientKeyPath); } catch { /* ignore */ }
            }
            httpsAgent = new https.Agent(agentOptions);
        }

        this.client = axios.create({
            baseURL: `${protocol}://${host}:${port}`,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            },
            ...(httpsAgent ? { httpsAgent } : {})
        });
    }

    /**
     * Check if the server is healthy
     */
    async isHealthy(): Promise<boolean> {
        try {
            const response = await this.client.get('/health');
            return response.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Get server info
     */
    async getInfo(): Promise<{ version: string; uptime: number }> {
        const response = await this.client.get('/api/v1/info');
        return response.data;
    }

    /**
     * List all topics
     */
    async listTopics(): Promise<TopicInfo[]> {
        const response = await this.client.get('/api/v1/topics');
        return response.data.topics || [];
    }

    /**
     * Get topic details
     */
    async describeTopic(name: string): Promise<{ topic: TopicInfo; partitions: PartitionInfo[] }> {
        const response = await this.client.get(`/api/v1/topics/${encodeURIComponent(name)}`);
        return response.data;
    }

    /**
     * Create a new topic
     */
    async createTopic(name: string, partitions: number, replicationFactor: number = 1): Promise<void> {
        await this.client.post('/api/v1/topics', {
            name,
            partitions,
            replication_factor: replicationFactor
        });
    }

    /**
     * Delete a topic
     */
    async deleteTopic(name: string): Promise<void> {
        await this.client.delete(`/api/v1/topics/${encodeURIComponent(name)}`);
    }

    /**
     * Produce a message to a topic
     */
    async produce(topic: string, key: string | null, value: string, headers?: Record<string, string>): Promise<ProduceResult> {
        const response = await this.client.post(`/api/v1/topics/${encodeURIComponent(topic)}/produce`, {
            key,
            value,
            headers
        });
        return response.data;
    }

    /**
     * Consume messages from a topic
     */
    async consume(topic: string, options: {
        partition?: number;
        offset?: number;
        limit?: number;
        timeout?: number;
    } = {}): Promise<Message[]> {
        const params = new URLSearchParams();
        if (options.partition !== undefined) {
            params.append('partition', options.partition.toString());
        }
        if (options.offset !== undefined) {
            params.append('offset', options.offset.toString());
        }
        if (options.limit !== undefined) {
            params.append('limit', options.limit.toString());
        }
        if (options.timeout !== undefined) {
            params.append('timeout', options.timeout.toString());
        }

        const response = await this.client.get(
            `/api/v1/topics/${encodeURIComponent(topic)}/consume?${params.toString()}`
        );
        return response.data.messages || [];
    }

    /**
     * List all consumer groups
     */
    async listConsumerGroups(): Promise<ConsumerGroupInfo[]> {
        const response = await this.client.get('/api/v1/groups');
        return response.data.groups || [];
    }

    /**
     * Get consumer group details
     */
    async describeConsumerGroup(groupId: string): Promise<ConsumerGroupDetails> {
        const response = await this.client.get(`/api/v1/groups/${encodeURIComponent(groupId)}`);
        return response.data;
    }

    /**
     * Delete a consumer group
     */
    async deleteConsumerGroup(groupId: string): Promise<void> {
        await this.client.delete(`/api/v1/groups/${encodeURIComponent(groupId)}`);
    }

    /**
     * Get metrics
     */
    async getMetrics(): Promise<string> {
        const response = await this.client.get('/metrics');
        return response.data;
    }

    /**
     * Get connection info
     */
    getConnectionInfo(): { host: string; port: number } {
        return { host: this.host, port: this.port };
    }

    // ==================== Schema Registry API ====================

    /**
     * List all schema subjects
     */
    async listSubjects(): Promise<string[]> {
        const response = await this.client.get('/subjects');
        return response.data || [];
    }

    /**
     * Get versions for a subject
     */
    async getSubjectVersions(subject: string): Promise<number[]> {
        const response = await this.client.get(`/subjects/${encodeURIComponent(subject)}/versions`);
        return response.data || [];
    }

    /**
     * Get schema by subject and version
     */
    async getSchema(subject: string, version: number | 'latest'): Promise<SchemaInfo> {
        const response = await this.client.get(
            `/subjects/${encodeURIComponent(subject)}/versions/${version}`
        );
        return response.data;
    }

    /**
     * Get schema by ID
     */
    async getSchemaById(id: number): Promise<{ schema: string; schemaType: string }> {
        const response = await this.client.get(`/schemas/ids/${id}`);
        return response.data;
    }

    /**
     * Register a new schema
     */
    async registerSchema(subject: string, schema: string, schemaType: string = 'AVRO'): Promise<{ id: number }> {
        const response = await this.client.post(
            `/subjects/${encodeURIComponent(subject)}/versions`,
            { schema, schemaType }
        );
        return response.data;
    }

    /**
     * Delete a subject
     */
    async deleteSubject(subject: string): Promise<number[]> {
        const response = await this.client.delete(`/subjects/${encodeURIComponent(subject)}`);
        return response.data;
    }

    /**
     * Delete a specific version
     */
    async deleteSchemaVersion(subject: string, version: number): Promise<number> {
        const response = await this.client.delete(
            `/subjects/${encodeURIComponent(subject)}/versions/${version}`
        );
        return response.data;
    }

    /**
     * Check schema compatibility
     */
    async checkCompatibility(
        subject: string,
        schema: string,
        schemaType: string = 'AVRO',
        version: number | 'latest' = 'latest'
    ): Promise<CompatibilityResult> {
        const response = await this.client.post(
            `/compatibility/subjects/${encodeURIComponent(subject)}/versions/${version}`,
            { schema, schemaType }
        );
        return response.data;
    }

    /**
     * Get global compatibility level
     */
    async getGlobalCompatibility(): Promise<{ compatibilityLevel: string }> {
        const response = await this.client.get('/config');
        return response.data;
    }

    /**
     * Set global compatibility level
     */
    async setGlobalCompatibility(level: string): Promise<void> {
        await this.client.put('/config', { compatibility: level });
    }

    /**
     * Get subject compatibility level
     */
    async getSubjectCompatibility(subject: string): Promise<{ compatibilityLevel: string }> {
        const response = await this.client.get(`/config/${encodeURIComponent(subject)}`);
        return response.data;
    }

    /**
     * Set subject compatibility level
     */
    async setSubjectCompatibility(subject: string, level: string): Promise<void> {
        await this.client.put(`/config/${encodeURIComponent(subject)}`, { compatibility: level });
    }

    /**
     * Get supported schema types
     */
    async getSchemaTypes(): Promise<string[]> {
        const response = await this.client.get('/schemas/types');
        return response.data || [];
    }
}

// Schema Registry types
export interface SchemaInfo {
    subject: string;
    version: number;
    id: number;
    schemaType?: string;
    schema: string;
}

export interface CompatibilityResult {
    is_compatible: boolean;
    messages?: string[];
}

/** Parsed broker address. */
export interface BrokerAddress {
    host: string;
    port: number;
}

/**
 * Parse a comma-separated broker connection string into structured addresses.
 *
 * @param connectionString Broker list, e.g. "broker1:9092,broker2:9092"
 * @returns Parsed broker addresses
 */
export function parseBrokers(connectionString: string): BrokerAddress[] {
    return connectionString
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(broker => {
            const lastColon = broker.lastIndexOf(':');
            if (lastColon === -1) {
                return { host: broker, port: 9092 };
            }
            const host = broker.substring(0, lastColon);
            const port = parseInt(broker.substring(lastColon + 1), 10);
            return { host, port: isNaN(port) ? 9092 : port };
        });
}

