import { randomUUID } from 'node:crypto';
import { TableClient } from '@azure/data-tables';
import { ManagedIdentityCredential } from '@azure/identity';
import { STATE_TABLE } from './config';

export interface StateRecord {
  value: string;
  expiresAt: number;
  version: string;
}

export interface StateStore {
  get(partition: string, key: string): Promise<StateRecord | undefined>;
  put(partition: string, key: string, value: string, expiresAt: number, version: string | null): Promise<boolean>;
  delete(partition: string, key: string, version: string): Promise<boolean>;
  purgeExpired(now: number): Promise<void>;
}

function hasStatus(error: unknown, ...statuses: number[]): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    && typeof error.statusCode === 'number' && statuses.includes(error.statusCode);
}

export class AzureStateStore implements StateStore {
  private readonly client: TableClient;

  constructor(account: string) {
    this.client = new TableClient(
      `https://${account}.table.core.windows.net`,
      STATE_TABLE,
      new ManagedIdentityCredential({ clientId: process.env.AZURE_CLIENT_ID }),
      { retryOptions: { maxRetries: 2 } },
    );
  }

  async get(partition: string, key: string): Promise<StateRecord | undefined> {
    try {
      const entity = await this.client.getEntity<{ value: string; expiresAt: number }>(partition, key, {
        abortSignal: AbortSignal.timeout(10_000),
      });
      if (typeof entity.value !== 'string' || typeof entity.expiresAt !== 'number' || !entity.etag) {
        throw new Error('Invalid authentication storage record.');
      }
      return { value: entity.value, expiresAt: entity.expiresAt, version: entity.etag };
    } catch (error) {
      if (hasStatus(error, 404)) return undefined;
      throw error;
    }
  }

  async put(partition: string, key: string, value: string, expiresAt: number, version: string | null): Promise<boolean> {
    const entity = { partitionKey: partition, rowKey: key, value, expiresAt };
    const options = { abortSignal: AbortSignal.timeout(10_000) };
    try {
      if (version === null) await this.client.createEntity(entity, options);
      else await this.client.updateEntity(entity, 'Replace', { ...options, etag: version });
      return true;
    } catch (error) {
      if (hasStatus(error, 409, 412) || (version !== null && hasStatus(error, 404))) return false;
      throw error;
    }
  }

  async delete(partition: string, key: string, version: string): Promise<boolean> {
    try {
      await this.client.deleteEntity(partition, key, { etag: version, abortSignal: AbortSignal.timeout(10_000) });
      return true;
    } catch (error) {
      if (hasStatus(error, 404, 412)) return false;
      throw error;
    }
  }

  async purgeExpired(now: number): Promise<void> {
    const entities = this.client.listEntities({
      queryOptions: { filter: `expiresAt le ${now}.0`, select: ['PartitionKey', 'RowKey'] },
      abortSignal: AbortSignal.timeout(30_000),
    });
    for await (const entity of entities) {
      if (entity.partitionKey && entity.rowKey && entity.etag) {
        await this.delete(entity.partitionKey, entity.rowKey, entity.etag);
      }
    }
  }
}

// Used only by tests and explicit loopback-only development, never as an Azure fallback.
export class MemoryStateStore implements StateStore {
  private readonly records = new Map<string, StateRecord>();

  async get(partition: string, key: string): Promise<StateRecord | undefined> {
    const record = this.records.get(`${partition}:${key}`);
    return record ? { ...record } : undefined;
  }

  async put(partition: string, key: string, value: string, expiresAt: number, version: string | null): Promise<boolean> {
    const id = `${partition}:${key}`;
    const current = this.records.get(id);
    if (version === null ? Boolean(current) : current?.version !== version) return false;
    this.records.set(id, { value, expiresAt, version: randomUUID() });
    return true;
  }

  async delete(partition: string, key: string, version: string): Promise<boolean> {
    const id = `${partition}:${key}`;
    if (this.records.get(id)?.version !== version) return false;
    return this.records.delete(id);
  }

  async purgeExpired(now: number): Promise<void> {
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(key);
    }
  }
}
