import { CopilotRequestError } from '../../src/services/copilot/protocol';
import { GENERATION_LEASE_MS, HOSTED_CONCURRENCY } from './config';
import { opaqueId, stateKey } from './credentials';
import type { StateStore } from './stateStore';

export async function acquireLease(
  store: StateStore, partition: string, key: string, lifetime: number,
): Promise<(() => Promise<void>) | undefined> {
  const current = await store.get(partition, key);
  const now = Date.now();
  if (current && current.expiresAt > now) return undefined;
  const owner = opaqueId();
  if (!await store.put(partition, key, owner, now + lifetime, current?.version ?? null)) return undefined;
  return async () => {
    const record = await store.get(partition, key);
    if (record?.value === owner) await store.delete(partition, key, record.version);
  };
}

export async function acquireGeneration(store: StateStore, userId: string): Promise<() => Promise<void>> {
  const releaseUser = await acquireLease(store, 'users', stateKey(userId), GENERATION_LEASE_MS);
  if (!releaseUser) {
    throw new CopilotRequestError('busy', 'Your account already has a generation in progress. Finish or cancel it before retrying.', 429);
  }
  try {
    for (let slot = 0; slot < HOSTED_CONCURRENCY; slot++) {
      const releaseSlot = await acquireLease(store, 'slots', String(slot), GENERATION_LEASE_MS);
      if (releaseSlot) {
        return async () => {
          try { await releaseSlot(); }
          finally { await releaseUser(); }
        };
      }
    }
    throw new CopilotRequestError('busy', 'All Copilot generation slots are busy. Please retry shortly.', 429);
  } catch (error) {
    await releaseUser();
    throw error;
  }
}
