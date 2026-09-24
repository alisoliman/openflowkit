import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCopilotRuntime } from '../copilotRuntime';
import { createHostedApp } from './app';
import { HostedConfigError, loadHostedConfig } from './config';
import { createGitHubAuth } from './githubAuth';
import { AzureStateStore, MemoryStateStore, type StateStore } from './stateStore';

async function main(): Promise<void> {
  const config = loadHostedConfig();
  let store: StateStore;
  if (config.development) {
    store = new MemoryStateStore();
  } else {
    if (!config.storageAccount) throw new Error('Hosted authentication requires a storage account.');
    store = new AzureStateStore(config.storageAccount);
  }
  if (config.development) console.warn('[Flowpilot hosted] Loopback development only: authentication state is in memory and is lost on restart.');
  const directory = await mkdtemp(join(tmpdir(), 'openflowkit-runtime-'));
  const runtime = createCopilotRuntime({ hosted: true, baseDirectory: directory });
  try {
    await store.get('health', 'probe');
    await runtime.ready?.();
    const app = await createHostedApp({
      config, store, runtime,
      github: createGitHubAuth(config),
      distDirectory: resolve('dist'),
      revision: process.env.APP_REVISION,
    });
    const server = createServer({ requestTimeout: 30_000, headersTimeout: 15_000, maxHeaderSize: 16_384 }, app.request);
    server.maxHeadersCount = 64;
    server.on('upgrade', app.upgrade);
    let purging = false;
    const housekeeping = setInterval(() => {
      if (purging) return;
      purging = true;
      void store.purgeExpired(Date.now()).catch(() => {
        console.error('[Flowpilot hosted] Expired authentication state cleanup failed.');
      }).finally(() => { purging = false; });
    }, 60_000);
    housekeeping.unref();

    let closing = false;
    const shutdown = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      clearInterval(housekeeping);
      server.close();
      server.closeIdleConnections();
      const deadline = setTimeout(() => {
        console.error('[Flowpilot hosted] Shutdown deadline exceeded.');
        process.exit(1);
      }, 15_000);
      deadline.unref();
      let failed = false;
      // Upgraded sockets are no longer tracked by the server; agent turns end with `interrupted`.
      const interrupted = app.close();
      try {
        await runtime.stop();
      } catch {
        console.error('[Flowpilot hosted] Runtime shutdown failed.');
        failed = true;
      }
      await interrupted;
      server.closeAllConnections();
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        console.error('[Flowpilot hosted] Temporary runtime cleanup failed.');
        failed = true;
      }
      clearTimeout(deadline);
      if (failed) process.exit(1);
    };
    process.once('SIGTERM', () => { void shutdown(); });
    process.once('SIGINT', () => { void shutdown(); });
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.development ? '127.0.0.1' : '0.0.0.0', resolveListen);
    });
    console.info(`[Flowpilot hosted] Listening on port ${config.port}.`);
  } catch (error) {
    try { await runtime.stop(); }
    finally { await rm(directory, { recursive: true, force: true }); }
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error('[Flowpilot hosted]', error instanceof HostedConfigError
    ? error.message
    : 'Startup failed. Check managed identity, table access, and the bundled Copilot runtime.');
  process.exitCode = 1;
});
