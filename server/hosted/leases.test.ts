// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_LEASE_MS } from './config';
import { acquireGeneration } from './leases';
import { MemoryStateStore } from './stateStore';

afterEach(() => vi.restoreAllMocks());

describe('shared hosted generation admission', () => {
  it('allows exactly twenty different users and explicitly rejects the twenty-first', async () => {
    const store = new MemoryStateStore();
    const releases = await Promise.all(Array.from({ length: 20 }, (_, user) => acquireGeneration(store, String(user))));
    await expect(acquireGeneration(store, '21')).rejects.toMatchObject({ code: 'busy', status: 429 });
    await releases[0]();
    const release = await acquireGeneration(store, '21');
    await release();
    await Promise.all(releases.map((done) => done()));
  });

  it('shares the one-account limit across independent callers and releases it after completion', async () => {
    const store = new MemoryStateStore();
    const requests = await Promise.allSettled([acquireGeneration(store, '1'), acquireGeneration(store, '1')]);
    expect(requests.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(requests.filter((result) => result.status === 'rejected')).toHaveLength(1);
    for (const request of requests) if (request.status === 'fulfilled') await request.value();
    await (await acquireGeneration(store, '1'))();
  });

  it('recovers capacity after a crashed process without letting old cleanup delete a new lease', async () => {
    const store = new MemoryStateStore();
    const releaseOld = await acquireGeneration(store, '1');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + GENERATION_LEASE_MS + 1);
    const releaseNew = await acquireGeneration(store, '1');
    await releaseOld();
    await expect(acquireGeneration(store, '1')).rejects.toMatchObject({ code: 'busy' });
    await releaseNew();
    await (await acquireGeneration(store, '1'))();
  });

  it('fails closed when shared storage is unavailable', async () => {
    const store = new MemoryStateStore();
    vi.spyOn(store, 'get').mockRejectedValue(new Error('storage offline'));
    await expect(acquireGeneration(store, '1')).rejects.toThrow('storage offline');
  });
});
