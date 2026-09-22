import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CopilotClient, RuntimeConnection, type CopilotSession, type SessionConfig } from '@github/copilot-sdk';
import {
  COPILOT_LOGIN_MESSAGE,
  COPILOT_HOSTED_LOGIN_MESSAGE,
  COPILOT_MAX_RESPONSE_CHARS,
  CopilotRequestError,
  type CopilotRequest,
  type CopilotStatus,
} from '../src/services/copilot/protocol';
import type { HostedIdentity } from './hosted/authSessions';
import { HOSTED_CONCURRENCY } from './hosted/config';

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_CONCURRENT_REQUESTS = 2;
const CLEANUP_TIMEOUT_MS = 5_000;

async function waitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
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

interface HostedRuntimeOptions {
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
      sessionIdleTimeoutSeconds: 240,
      enableRemoteSessions: false,
    } : {}),
  };
}

function buildPrompt(request: CopilotRequest): string {
  if (request.history.length === 0) return request.prompt;

  // Replay history as context, not separate billable turns. The browser owns chat persistence.
  return [
    'Previous conversation (context only, not new requests):',
    JSON.stringify(request.history),
    '',
    'Current request:',
    request.prompt,
  ].join('\n');
}

export interface CopilotRuntime {
  status(identity?: HostedIdentity, signal?: AbortSignal): Promise<CopilotStatus>;
  generate(request: CopilotRequest, onDelta: (text: string) => void, signal: AbortSignal, identity?: HostedIdentity): Promise<string>;
  ready?(): Promise<void>;
  cancelConnection?(sessionKey: string): void;
  stop(): Promise<void>;
}

export function hostedCopilotError(error: unknown): CopilotRequestError {
  if (error instanceof CopilotRequestError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/quota|premium.{0,30}(exhaust|limit)|rate.?limit|\b429\b/i.test(message)) {
    return new CopilotRequestError('quota_exceeded', 'Your Copilot usage limit was reached. Check your GitHub plan or retry after the limit resets.', 429);
  }
  if (/unauthori[sz]ed|forbidden|subscription|entitlement|not.authenticated|\b40[13]\b/i.test(message)) {
    return new CopilotRequestError('copilot_access_denied', 'Copilot access was denied. Check your Copilot plan and organization policy, or reconnect GitHub.', 403);
  }
  return new CopilotRequestError('request_failed', 'Copilot could not complete the request. Check your connection and retry; no changes were applied.', 502);
}

const sessionModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  displayName: z.string().optional(),
  supportsVision: z.boolean().optional(),
  multiplier: z.number().optional(),
  capabilities: z.object({ supports: z.object({ vision: z.boolean().optional() }).optional() }).optional(),
  billing: z.object({ multiplier: z.number().optional() }).optional(),
  policy: z.object({ state: z.string() }).optional(),
});

export function createCopilotRuntime(options?: HostedRuntimeOptions): CopilotRuntime {
  let startup: Promise<CopilotClient> | undefined;
  let ownedClient: CopilotClient | undefined;
  let activeRequests = 0;
  let statusRequests = 0;
  let stopped = false;
  const connections = new Map<string, AbortController>();
  const hosted = Boolean(options);
  const shutdown = new AbortController();

  function sessionOptions(request: CopilotRequest, identity?: HostedIdentity): SessionConfig {
    return {
      model: request.model === 'auto' ? undefined : request.model,
      systemMessage: { mode: 'replace', content: request.systemInstruction },
      streaming: true,
      availableTools: [],
      tools: [],
      mcpServers: {},
      enableConfigDiscovery: false,
      skipCustomInstructions: true,
      enableFileHooks: false,
      enableSkills: false,
      enableSessionStore: false,
      infiniteSessions: { enabled: false },
      onPermissionRequest: () => ({ kind: 'reject', feedback: 'Flowpilot only generates diagram text; host tools are disabled.' }),
      ...(hosted ? {
        sessionId: `flowpilot-${randomUUID()}`,
        gitHubToken: identity?.token,
        enableHostGitOperations: false,
        enableOnDemandInstructionDiscovery: false,
        enableSessionTelemetry: false,
        skipEmbeddingRetrieval: true,
        embeddingCacheStorage: 'in-memory' as const,
        memory: { enabled: false },
      } : {}),
    };
  }

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
    if (stopped) {
      return Promise.reject(new CopilotRequestError('runtime_unavailable', hosted
        ? 'The hosted Copilot runtime is restarting. Please retry shortly.'
        : 'The Copilot runtime has stopped. Restart the local app.'));
    }
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
    async ready() {
      const signal = AbortSignal.any([AbortSignal.timeout(15_000), shutdown.signal]);
      const client = await waitWithSignal(getClient(), signal);
      await waitWithSignal(client.getStatus(), signal);
    },

    cancelConnection(sessionKey) {
      connections.get(sessionKey)?.abort(new CopilotRequestError('not_authenticated', 'GitHub was disconnected. Connect again to continue.', 401));
    },

    async status(identity, signal) {
      if (hosted) {
        const base: CopilotStatus = {
          runtime: 'github-copilot-sdk', mode: 'hosted',
          signedIn: Boolean(identity), authenticated: false, login: identity?.login, models: [],
        };
        if (!identity) return base;
        if (statusRequests >= HOSTED_CONCURRENCY) throw new CopilotRequestError('busy', 'Copilot connection checks are busy. Please retry shortly.', 429);
        statusRequests++;
        const statusSignal = AbortSignal.any([AbortSignal.timeout(20_000), shutdown.signal, ...(signal ? [signal] : [])]);
        let session: CopilotSession | undefined;
        let client: CopilotClient | undefined;
        try {
          client = await waitWithSignal(getClient(), statusSignal);
          const creation = client.createSession(sessionOptions({
            prompt: 'List models', systemInstruction: 'Flowpilot model discovery. No tools.', model: 'auto', history: [],
          }, identity));
          try {
            session = await waitWithSignal(creation, statusSignal);
          } catch (error) {
            const sessionClient = client;
            void creation.then((late) => cleanup(sessionClient, late, true)).catch(() => {
              console.error('[Flowpilot hosted] Model discovery session cleanup failed.');
            });
            throw error;
          }
          const result = await waitWithSignal(session.rpc.model.list(), statusSignal);
          const parsed = z.array(sessionModelSchema).safeParse(result.list);
          if (!parsed.success) throw new CopilotRequestError('bad_response', 'Copilot returned an invalid model catalog. Please retry.', 502);
          const models = parsed.data.filter((model) => model.policy?.state !== 'disabled').map((model) => ({
            id: model.id,
            name: model.name ?? model.displayName ?? model.id,
            vision: model.capabilities?.supports?.vision ?? model.supportsVision,
            multiplier: model.billing?.multiplier ?? model.multiplier,
          }));
          return { ...base, authenticated: models.length > 0, models, issue: models.length ? undefined : 'Your GitHub account has no available Copilot models. Check your plan and organization policy.' };
        } catch (error) {
          const failure = hostedCopilotError(error);
          if (failure.code === 'copilot_access_denied' || failure.code === 'quota_exceeded') {
            return { ...base, issue: failure.message };
          }
          throw failure;
        } finally {
          try { if (client && session) await cleanup(client, session, statusSignal.aborted); }
          finally { statusRequests--; }
        }
      }
      const client = await getClient();
      const auth = await client.getAuthStatus();
      const models = auth.isAuthenticated ? await client.listModels() : [];
      return {
        runtime: 'github-copilot-sdk',
        authenticated: auth.isAuthenticated,
        login: auth.login,
        models: models
          .filter((model) => !model.policy || model.policy.state === 'enabled')
          .map((model) => ({
            id: model.id,
            name: model.name,
            vision: model.capabilities?.supports?.vision,
            multiplier: model.billing?.multiplier,
          })),
      };
    },

    async generate(request, onDelta, signal, identity) {
      signal.throwIfAborted();
      if (hosted && !identity) throw new CopilotRequestError('not_authenticated', COPILOT_HOSTED_LOGIN_MESSAGE, 401);
      if (activeRequests >= (hosted ? HOSTED_CONCURRENCY : MAX_CONCURRENT_REQUESTS)) {
        throw new CopilotRequestError('busy', hosted
          ? 'Copilot is busy. Please retry shortly.'
          : 'Copilot is already working on two requests. Wait for one to finish or cancel it.', 429);
      }

      activeRequests++;
      const controller = new AbortController();
      if (identity) connections.set(identity.sessionKey, controller);
      const deadline = setTimeout(() => {
        controller.abort(new CopilotRequestError('timeout', 'Copilot took too long to respond. The request was cancelled; try again.', 504));
      }, REQUEST_TIMEOUT_MS);
      const requestSignal = AbortSignal.any([signal, controller.signal]);
      let session: CopilotSession | undefined;
      let client: CopilotClient | undefined;
      let unsubscribe: (() => void) | undefined;
      let completed = false;

      try {
        client = await waitWithSignal(getClient(), requestSignal);
        requestSignal.throwIfAborted();
        if (!hosted) {
          const auth = await waitWithSignal(client.getAuthStatus(), requestSignal);
          requestSignal.throwIfAborted();
          if (!auth.isAuthenticated) {
            throw new CopilotRequestError('not_authenticated', COPILOT_LOGIN_MESSAGE, 401);
          }
        }
        const sessionCreation = client.createSession(sessionOptions(request, identity));
        try {
          session = await waitWithSignal(sessionCreation, requestSignal);
        } catch (error) {
          if (requestSignal.aborted) {
            const sessionClient = client;
            // Session creation is not cancellable in the SDK. Dispose its late
            // result without holding the HTTP request or a concurrency slot.
            void sessionCreation.then((lateSession) => cleanup(sessionClient, lateSession, true))
              .catch((creationError: unknown) => {
                if (hosted) console.error('[Flowpilot hosted] Cancelled session cleanup failed.');
                else console.error('[Flowpilot] Cancelled session creation failed.', creationError);
              });
          }
          throw error;
        }
        requestSignal.throwIfAborted();

        let streamedLength = 0;
        unsubscribe = session.on('assistant.message_delta', (event) => {
          if (requestSignal.aborted) return;
          streamedLength += event.data.deltaContent.length;
          if (streamedLength > COPILOT_MAX_RESPONSE_CHARS) {
            controller.abort(new CopilotRequestError('bad_response', 'The Copilot response was too large. Try a smaller diagram.', 502));
            return;
          }
          try {
            onDelta(event.data.deltaContent);
          } catch (error) {
            controller.abort(error);
          }
        });

        const image = request.image?.match(/^data:(image\/[^;]+);base64,(.+)$/);
        const response = await waitWithSignal(
          session.sendAndWait({
            prompt: buildPrompt(request),
            attachments: image
              ? [{ type: 'blob', mimeType: image[1], data: image[2], displayName: 'Diagram reference' }]
              : undefined,
          }, REQUEST_TIMEOUT_MS),
          requestSignal,
        );
        requestSignal.throwIfAborted();
        const text = response?.data.content;
        if (!text?.trim() || text.length > COPILOT_MAX_RESPONSE_CHARS) {
          throw new CopilotRequestError('bad_response', 'Copilot did not return a usable response. Try again with a smaller, more specific request.', 502);
        }
        completed = true;
        return text;
      } finally {
        clearTimeout(deadline);
        unsubscribe?.();
        try {
          if (session && client) await cleanup(client, session, !completed);
        } finally {
          if (identity) connections.delete(identity.sessionKey);
          activeRequests--;
        }
      }
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
