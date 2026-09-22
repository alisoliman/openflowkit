import { homedir } from 'node:os';
import { join } from 'node:path';
import { CopilotClient, type CopilotSession } from '@github/copilot-sdk';
import {
  COPILOT_LOGIN_MESSAGE,
  COPILOT_MAX_RESPONSE_CHARS,
  CopilotRequestError,
  type CopilotRequest,
  type CopilotStatus,
} from '../src/services/copilot/protocol';

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

async function disposeSession(client: CopilotClient, session: CopilotSession, abort: boolean): Promise<void> {
  if (abort) {
    try {
      await waitWithSignal(session.abort(), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
    } catch (error) {
      console.error('[Flowpilot] Could not abort the Copilot request.', error);
    }
  }
  try {
    await waitWithSignal(client.deleteSession(session.sessionId), AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
  } catch (error) {
    console.error('[Flowpilot] Could not remove the temporary Copilot session.', error);
  }
}

export function createCopilotClientOptions() {
  const env = { ...process.env };
  // An inherited automation token must not silently replace the user's CLI identity.
  for (const key of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_COPILOT_API_TOKEN']) {
    delete env[key];
  }
  return {
    mode: 'empty' as const,
    baseDirectory: process.env.COPILOT_HOME || join(homedir(), '.copilot'),
    useLoggedInUser: true,
    env,
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
  status(): Promise<CopilotStatus>;
  generate(request: CopilotRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<string>;
  stop(): Promise<void>;
}

export function createCopilotRuntime(): CopilotRuntime {
  let startup: Promise<CopilotClient> | undefined;
  let activeRequests = 0;
  let stopped = false;

  function getClient(): Promise<CopilotClient> {
    if (stopped) {
      return Promise.reject(new CopilotRequestError('runtime_unavailable', 'The Copilot runtime has stopped. Restart the local app.'));
    }
    if (!startup) {
      const client = new CopilotClient(createCopilotClientOptions());
      startup = client.start().then(() => client).catch(async (error: unknown) => {
        startup = undefined;
        await client.forceStop();
        throw error;
      });
    }
    return startup;
  }

  return {
    async status() {
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

    async generate(request, onDelta, signal) {
      signal.throwIfAborted();
      if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        throw new CopilotRequestError('busy', 'Copilot is already working on two requests. Wait for one to finish or cancel it.', 429);
      }

      activeRequests++;
      const controller = new AbortController();
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
        const auth = await waitWithSignal(client.getAuthStatus(), requestSignal);
        requestSignal.throwIfAborted();
        if (!auth.isAuthenticated) {
          throw new CopilotRequestError('not_authenticated', COPILOT_LOGIN_MESSAGE, 401);
        }
        const sessionCreation = client.createSession({
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
        });
        try {
          session = await waitWithSignal(sessionCreation, requestSignal);
        } catch (error) {
          if (requestSignal.aborted) {
            const sessionClient = client;
            // Session creation is not cancellable in the SDK. Dispose its late
            // result without holding the HTTP request or a concurrency slot.
            void sessionCreation.then((lateSession) => disposeSession(sessionClient, lateSession, true))
              .catch((creationError: unknown) => {
                console.error('[Flowpilot] Cancelled session creation failed.', creationError);
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
        if (session && client) {
          await disposeSession(client, session, !completed);
        }
        activeRequests--;
      }
    },

    async stop() {
      stopped = true;
      if (!startup) return;
      const client = await startup;
      const errors = await client.stop();
      if (errors.length > 0) {
        await client.forceStop();
        throw new AggregateError(errors, 'Could not gracefully stop the Copilot runtime.');
      }
    },
  };
}
