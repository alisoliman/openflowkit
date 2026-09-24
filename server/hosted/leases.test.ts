// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_LEASE_MS } from './config';
import { stateKey } from './credentials';
import { acquireGeneration } from './leases';
import { MemoryStateStore } from './stateStore';

afterEach(() => vi.restoreAllMocks());

describe('shared hosted generation admission', () => {
  it('allows exactly twenty different users and explicitly rejects the twenty-first', async () => {
    const store = new MemoryStateStore();
    const leases = await Promise.all(Array.from({ length: 20 }, (_, user) => acquireGeneration(store, String(user))));
    await expect(acquireGeneration(store, '21')).rejects.toMatchObject({ code: 'busy', status: 429 });
    await leases[0].release();
    const lease = await acquireGeneration(store, '21');
    await lease.release();
    await Promise.all(leases.map((held) => held.release()));
  });

  it('shares the one-account limit across independent callers and releases it after completion', async () => {
    const store = new MemoryStateStore();
    const requests = await Promise.allSettled([acquireGeneration(store, '1'), acquireGeneration(store, '1')]);
    expect(requests.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(requests.filter((result) => result.status === 'rejected')).toHaveLength(1);
    for (const request of requests) if (request.status === 'fulfilled') await request.value.release();
    await (await acquireGeneration(store, '1')).release();
  });

  it('recovers capacity after a crashed process without letting old cleanup delete a new lease', async () => {
    const store = new MemoryStateStore();
    const old = await acquireGeneration(store, '1');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + GENERATION_LEASE_MS + 1);
    const current = await acquireGeneration(store, '1');
    await old.release();
    await expect(acquireGeneration(store, '1')).rejects.toMatchObject({ code: 'busy' });
    await current.release();
    await (await acquireGeneration(store, '1')).release();
  });

  it('renews a held lease for another lifetime but never one that was taken over', async () => {
    const store = new MemoryStateStore();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await acquireGeneration(store, '1');
    clock.mockReturnValue(now + GENERATION_LEASE_MS - 1);
    await expect(old.renew()).resolves.toBe(true);
    expect((await store.get('users', stateKey('1')))?.expiresAt).toBe(now + 2 * GENERATION_LEASE_MS - 1);
    expect((await store.get('slots', '0'))?.expiresAt).toBe(now + 2 * GENERATION_LEASE_MS - 1);
    clock.mockReturnValue(now + GENERATION_LEASE_MS + 1);
    await expect(acquireGeneration(store, '1')).rejects.toMatchObject({ code: 'busy' });

    clock.mockReturnValue(now + 3 * GENERATION_LEASE_MS);
    const current = await acquireGeneration(store, '1');
    await expect(old.renew()).resolves.toBe(false);
    await old.release();
    await expect(acquireGeneration(store, '1')).rejects.toMatchObject({ code: 'busy' });
    await expect(current.renew()).resolves.toBe(true);
    await current.release();
  });

  it('does not renew a lease whose generation slot alone was taken over', async () => {
    const store = new MemoryStateStore();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await acquireGeneration(store, '1');
    clock.mockReturnValue(now + GENERATION_LEASE_MS + 1);
    const other = await acquireGeneration(store, '2');
    await expect(old.renew()).resolves.toBe(false);
    await old.release();
    await expect(other.renew()).resolves.toBe(true);
    expect((await store.get('slots', '0'))?.expiresAt).toBe(now + 2 * GENERATION_LEASE_MS + 1);
    await other.release();
  });

  it('fails closed when shared storage is unavailable', async () => {
    const store = new MemoryStateStore();
    vi.spyOn(store, 'get').mockRejectedValue(new Error('storage offline'));
    await expect(acquireGeneration(store, '1')).rejects.toThrow('storage offline');
  });
});
