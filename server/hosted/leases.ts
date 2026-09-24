import { CopilotRequestError } from '../../src/services/copilot/protocol';
import { GENERATION_LEASE_MS, HOSTED_CONCURRENCY } from './config';
import { opaqueId, stateKey } from './credentials';
import type { StateStore } from './stateStore';

export interface Lease {
  /** Extends the lease by its lifetime; false once it has expired and been taken over. */
  renew(): Promise<boolean>;
  release(): Promise<void>;
}

/** Conditional on the owner, so a lease that was lost is never extended. */
export async function renewLease(
  store: StateStore, partition: string, key: string, owner: string, lifetime: number,
): Promise<boolean> {
  const record = await store.get(partition, key);
  return record?.value === owner && await store.put(partition, key, owner, Date.now() + lifetime, record.version);
}

export async function acquireLease(
  store: StateStore, partition: string, key: string, lifetime: number,
): Promise<Lease | undefined> {
  const current = await store.get(partition, key);
  const now = Date.now();
  if (current && current.expiresAt > now) return undefined;
  const owner = opaqueId();
  if (!await store.put(partition, key, owner, now + lifetime, current?.version ?? null)) return undefined;
  return {
    renew: () => renewLease(store, partition, key, owner, lifetime),
    release: async () => {
      const record = await store.get(partition, key);
      if (record?.value === owner) await store.delete(partition, key, record.version);
    },
  };
}

export async function acquireGeneration(store: StateStore, userId: string): Promise<Lease> {
  const user = await acquireLease(store, 'users', stateKey(userId), GENERATION_LEASE_MS);
  if (!user) {
    throw new CopilotRequestError('busy', 'Your account already has a generation in progress. Finish or cancel it before retrying.', 429);
  }
  try {
    for (let slot = 0; slot < HOSTED_CONCURRENCY; slot++) {
      const lease = await acquireLease(store, 'slots', String(slot), GENERATION_LEASE_MS);
      if (lease) {
        return {
          renew: async () => (await Promise.all([user.renew(), lease.renew()])).every(Boolean),
          release: async () => {
            try { await lease.release(); }
            finally { await user.release(); }
          },
        };
      }
    }
    throw new CopilotRequestError('busy', 'All Copilot generation slots are busy. Please retry shortly.', 429);
  } catch (error) {
    await user.release();
    throw error;
  }
}
