import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CopilotClient,
  RuntimeConnection,
  type CopilotSession,
  type MessageOptions,
  type SessionConfig,
} from '@github/copilot-sdk';
import { COPILOT_LOGIN_MESSAGE, CopilotRequestError } from '../src/services/copilot/protocol';
import type { HostedIdentity } from './hosted/authSessions';

// Shared by the one-shot runtime (copilotRuntime.ts) and agent turns (copilotAgentRuntime.ts): one CLI
// process per server, the same locked-down sessions, and the same fail-closed cleanup.
const CLEANUP_TIMEOUT_MS = 5_000;

export async function waitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function disposeSession(client: CopilotClient, session: CopilotSession, abort: boolean, hosted = false): Promise<void> {
  let failed = false;
  if (abort) {
    try {
      await waitWithSignal(session.abort(), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
    } catch (error) {
      failed = true;
      if (hosted) console.error('[Flowpilot hosted] Session abort failed.');
      else console.error('[Flowpilot] Could not abort the Copilot request.', error);
    }
  }
  try {
    await waitWithSignal(client.deleteSession(session.sessionId), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
  } catch (error) {
    failed = true;
    if (hosted) console.error('[Flowpilot hosted] Session cleanup failed.');
    else console.error('[Flowpilot] Could not remove the temporary Copilot session.', error);
  }
  if (hosted && failed) throw new CopilotRequestError('runtime_unavailable', 'Copilot cleanup failed. The runtime is restarting; please retry.');
}

export interface HostedRuntimeOptions {
  hosted: true;
  baseDirectory: string;
}

export function createCopilotClientOptions(options?: HostedRuntimeOptions) {
  const env: NodeJS.ProcessEnv = options
    ? { PATH: process.env.PATH, HOME: options.baseDirectory, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR }
    : { ...process.env };
  // An inherited automation token must not silently replace the user's CLI identity.
  for (const key of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_COPILOT_API_TOKEN']) {
    delete env[key];
  }
  return {
    mode: 'empty' as const,
    baseDirectory: options?.baseDirectory ?? (process.env.COPILOT_HOME || join(homedir(), '.copilot')),
    useLoggedInUser: !options,
    env,
    ...(options ? {
      connection: RuntimeConnection.forStdio(),
      logLevel: 'none' as const,
      workingDirectory: options.baseDirectory,
      // The CLI cleans up sessions without activity for this long. An agent turn can wait up to 10 minutes for
      // an answer or a destructive-change confirmation, so this must stay above that. Finished sessions are
      // deleted explicitly, so this only reaps sessions whose cleanup was lost.
      sessionIdleTimeoutSeconds: 900,
      enableRemoteSessions: false,
    } : {}),
  };
}

export const COPILOT_QUOTA_MESSAGE = 'Your Copilot usage limit was reached. Check your GitHub plan or retry after the limit resets.';
export const COPILOT_ACCESS_DENIED_MESSAGE = 'Copilot access was denied. Check your Copilot plan and organization policy, or reconnect GitHub.';

export function hostedCopilotError(error: unknown): CopilotRequestError {
  if (error instanceof CopilotRequestError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/quota|premium.{0,30}(exhaust|limit)|rate.?limit|\b429\b/i.test(message)) {
    return new CopilotRequestError('quota_exceeded', COPILOT_QUOTA_MESSAGE, 429);
  }
  if (/unauthori[sz]ed|forbidden|subscription|entitlement|not.authenticated|\b40[13]\b/i.test(message)) {
    return new CopilotRequestError('copilot_access_denied', COPILOT_ACCESS_DENIED_MESSAGE, 403);
  }
  return new CopilotRequestError('request_failed', 'Copilot could not complete the request. Check your connection and retry; no changes were applied.', 502);
}

export function toRequestError(error: unknown): CopilotRequestError {
  if (error instanceof CopilotRequestError) return error;
  return new CopilotRequestError(
    'request_failed',
    `Copilot could not complete the request: ${error instanceof Error ? error.message : 'Unknown runtime error'}`,
    502,
  );
}

export function runtimeUnavailableError(hosted: boolean): CopilotRequestError {
  return new CopilotRequestError('runtime_unavailable', hosted
    ? 'The hosted Copilot runtime is restarting. Please retry shortly.'
    : 'The Copilot runtime has stopped. Restart the local app.');
}

export function imageAttachments(image: string | undefined): MessageOptions['attachments'] {
  const match = image?.match(/^data:(image\/[^;]+);base64,(.+)$/);
  return match ? [{ type: 'blob', mimeType: match[1], data: match[2], displayName: 'Diagram reference' }] : undefined;
}

export interface CopilotHost {
  readonly hosted: boolean;
  /** Per-user requests, aborted when that user disconnects GitHub or the runtime fails closed. */
  readonly connections: Map<string, AbortController>;
  /** Aborted when the runtime stops or fails closed. */
  readonly stopping: AbortSignal;
  getClient(): Promise<CopilotClient>;
  /** Options every Flowpilot session shares: no MCP, config discovery, instructions, hooks, skills, memory or session store. */
  sessionOptions(model: string, identity?: HostedIdentity): SessionConfig;
  /** Starts the client, checks the local sign-in and creates a session, disposing one that arrives after `signal` aborts. */
  openSession(config: SessionConfig, signal: AbortSignal): Promise<{ client: CopilotClient; session: CopilotSession }>;
  cleanup(client: CopilotClient, session: CopilotSession, abort: boolean): Promise<void>;
  ready(): Promise<void>;
  cancelConnection(sessionKey: string): void;
  stop(): Promise<void>;
}

export function createCopilotHost(options?: HostedRuntimeOptions): CopilotHost {
  let startup: Promise<CopilotClient> | undefined;
  let ownedClient: CopilotClient | undefined;
  let stopped = false;
  const connections = new Map<string, AbortController>();
  const hosted = Boolean(options);
  const shutdown = new AbortController();

  async function cleanup(client: CopilotClient, session: CopilotSession, abort: boolean): Promise<void> {
    try {
      await disposeSession(client, session, abort, hosted);
    } catch (error) {
      stopped = true;
      shutdown.abort(error);
      for (const controller of connections.values()) controller.abort(error);
      await waitWithSignal(client.forceStop(), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
      throw error;
    }
  }

  function getClient(): Promise<CopilotClient> {
    if (stopped) return Promise.reject(runtimeUnavailableError(hosted));
    if (!startup) {
      const client = new CopilotClient(createCopilotClientOptions(options));
      ownedClient = client;
      startup = client.start().then(() => client).catch(async (error: unknown) => {
        await waitWithSignal(client.forceStop(), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
        if (ownedClient === client) {
          ownedClient = undefined;
          startup = undefined;
        }
        throw error;
      });
    }
    return startup;
  }

  return {
    hosted,
    connections,
    stopping: shutdown.signal,
    getClient,
    cleanup,

    sessionOptions(model, identity) {
      return {
        model: model === 'auto' ? undefined : model,
        streaming: true,
        mcpServers: {},
        enableConfigDiscovery: false,
        skipCustomInstructions: true,
        enableFileHooks: false,
        enableSkills: false,
        enableSessionStore: false,
        infiniteSessions: { enabled: false },
        ...(hosted ? {
          sessionId: `flowpilot-${randomUUID()}`,
          // The session keeps this token. SDK 1.0.14's gitHubTokenProvider leaves the session unauthenticated,
          // so agent sockets are renewed further ahead instead (authSessions.ts).
          gitHubToken: identity?.token,
          enableHostGitOperations: false,
          enableOnDemandInstructionDiscovery: false,
          enableSessionTelemetry: false,
          skipEmbeddingRetrieval: true,
          embeddingCacheStorage: 'in-memory' as const,
          memory: { enabled: false },
        } : {}),
      };
    },

    async openSession(config, signal) {
      const client = await waitWithSignal(getClient(), signal);
      signal.throwIfAborted();
      if (!hosted) {
        const auth = await waitWithSignal(client.getAuthStatus(), signal);
        signal.throwIfAborted();
        if (!auth.isAuthenticated) {
          throw new CopilotRequestError('not_authenticated', COPILOT_LOGIN_MESSAGE, 401);
        }
      }
      const creation = client.createSession(config);
      try {
        return { client, session: await waitWithSignal(creation, signal) };
      } catch (error) {
        if (signal.aborted) {
          // Session creation is not cancellable in the SDK. Dispose its late
          // result without holding the request or a concurrency slot.
          void creation.then((lateSession) => cleanup(client, lateSession, true))
            .catch((creationError: unknown) => {
              if (hosted) console.error('[Flowpilot hosted] Cancelled session cleanup failed.');
              else console.error('[Flowpilot] Cancelled session creation failed.', creationError);
            });
        }
        throw error;
      }
    },

    async ready() {
      const signal = AbortSignal.any([AbortSignal.timeout(15_000), shutdown.signal]);
      const client = await waitWithSignal(getClient(), signal);
      await waitWithSignal(client.getStatus(), signal);
    },

    cancelConnection(sessionKey) {
      connections.get(sessionKey)?.abort(new CopilotRequestError('not_authenticated', 'GitHub was disconnected. Connect again to continue.', 401));
    },

    async stop() {
      stopped = true;
      shutdown.abort(new CopilotRequestError('runtime_unavailable', 'The Copilot runtime is shutting down.'));
      for (const controller of connections.values()) controller.abort();
      const client = ownedClient;
      if (!client) return;
      try {
        const errors = await waitWithSignal(client.stop(), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
        if (errors.length > 0) throw new AggregateError(errors, 'Could not gracefully stop the Copilot runtime.');
      } catch (error) {
        await waitWithSignal(client.forceStop(), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
        throw error;
      }
    },
  };
}
