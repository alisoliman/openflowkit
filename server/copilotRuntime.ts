import { z } from 'zod';
import type { CopilotClient, CopilotSession, SessionConfig } from '@github/copilot-sdk';
import {
  COPILOT_HOSTED_LOGIN_MESSAGE,
  COPILOT_MAX_RESPONSE_CHARS,
  CopilotRequestError,
  type CopilotRequest,
  type CopilotStatus,
} from '../src/services/copilot/protocol';
import { createCopilotAgentRuntime, type CopilotAgentRuntime } from './copilotAgentRuntime';
import { createCopilotHost, hostedCopilotError, imageAttachments, waitWithSignal, type HostedRuntimeOptions } from './copilotHost';
import type { HostedIdentity } from './hosted/authSessions';
import { HOSTED_CONCURRENCY } from './hosted/config';

export { createCopilotClientOptions, hostedCopilotError } from './copilotHost';

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_CONCURRENT_REQUESTS = 2;

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
  /** Flowpilot agent turns, sharing this runtime's Copilot client. */
  agent?: CopilotAgentRuntime;
  ready?(): Promise<void>;
  cancelConnection?(sessionKey: string): void;
  stop(): Promise<void>;
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
  const host = createCopilotHost(options);
  const { hosted, connections } = host;
  let activeRequests = 0;
  let statusRequests = 0;

  function sessionOptions(request: CopilotRequest, identity?: HostedIdentity): SessionConfig {
    return {
      ...host.sessionOptions(request.model, identity),
      systemMessage: { mode: 'replace', content: request.systemInstruction },
      availableTools: [],
      tools: [],
      onPermissionRequest: () => ({ kind: 'reject', feedback: 'Flowpilot only generates diagram text; host tools are disabled.' }),
    };
  }

  return {
    agent: createCopilotAgentRuntime(host),
    ready: host.ready,
    cancelConnection: host.cancelConnection,
    stop: host.stop,

    async status(identity, signal) {
      if (hosted) {
        const base: CopilotStatus = {
          runtime: 'github-copilot-sdk', mode: 'hosted',
          signedIn: Boolean(identity), authenticated: false, login: identity?.login, models: [],
        };
        if (!identity) return base;
        if (statusRequests >= HOSTED_CONCURRENCY) throw new CopilotRequestError('busy', 'Copilot connection checks are busy. Please retry shortly.', 429);
        statusRequests++;
        const statusSignal = AbortSignal.any([AbortSignal.timeout(20_000), host.stopping, ...(signal ? [signal] : [])]);
        let session: CopilotSession | undefined;
        let client: CopilotClient | undefined;
        try {
          ({ client, session } = await host.openSession(sessionOptions({
            prompt: 'List models', systemInstruction: 'Flowpilot model discovery. No tools.', model: 'auto', history: [],
          }, identity), statusSignal));
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
          try { if (client && session) await host.cleanup(client, session, statusSignal.aborted); }
          finally { statusRequests--; }
        }
      }
      const client = await host.getClient();
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
        ({ client, session } = await host.openSession(sessionOptions(request, identity), requestSignal));
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

        const response = await waitWithSignal(
          session.sendAndWait({ prompt: buildPrompt(request), attachments: imageAttachments(request.image) }, REQUEST_TIMEOUT_MS),
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
          if (session && client) await host.cleanup(client, session, !completed);
        } finally {
          if (identity) connections.delete(identity.sessionKey);
          activeRequests--;
        }
      }
    },
  };
}
