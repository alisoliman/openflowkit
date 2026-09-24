import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  COPILOT_API_PATH,
  COPILOT_CLIENT_HEADER,
  COPILOT_MAX_BODY_BYTES,
  COPILOT_HOSTED_LOGIN_MESSAGE,
  CopilotRequestError,
  copilotRequestSchema,
  type CopilotStreamEvent,
} from '../src/services/copilot/protocol';
import { toRequestError } from './copilotHost';
import { hostedCopilotError, type CopilotRuntime } from './copilotRuntime';
import type { HostedIdentity } from './hosted/authSessions';
import type { Lease } from './hosted/leases';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The origin a local request was served on, or undefined unless both its socket and its exact Host are loopback. */
export function localOrigin(request: IncomingMessage): string | undefined {
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? '')) return undefined;
  try {
    const url = new URL(`http://${request.headers.host}`);
    return LOOPBACK_HOSTS.has(url.hostname) && url.host === request.headers.host ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function isLocalRequest(request: IncomingMessage): boolean {
  const origin = localOrigin(request);
  if (!origin || request.headers[COPILOT_CLIENT_HEADER] !== '1') return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  return !request.headers.origin || request.headers.origin === origin;
}

export async function readJsonRequest(request: IncomingMessage, maxBytes = COPILOT_MAX_BODY_BYTES): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new CopilotRequestError('invalid_request', 'Copilot requests must use application/json.', 415);
  }
  if (Number(request.headers['content-length']) > maxBytes) {
    request.resume();
    throw new CopilotRequestError('invalid_request', 'The request is too large. Use a smaller image or shorter conversation.', 413);
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      request.resume();
      throw new CopilotRequestError('invalid_request', 'The request is too large. Use a smaller image or shorter conversation.', 413);
    }
    chunks.push(buffer);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CopilotRequestError('invalid_request', 'The Copilot request is not valid JSON.', 400);
  }
  return body;
}

async function readRequest(request: IncomingMessage) {
  const parsed = copilotRequestSchema.safeParse(await readJsonRequest(request));
  if (!parsed.success) {
    throw new CopilotRequestError('invalid_request', 'The Copilot request is invalid. Check the prompt, model, conversation length, and image format (PNG, JPEG, WebP, or GIF).', 400);
  }
  return parsed.data;
}

export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

/** Shared by the one-shot middleware and the agent socket endpoint. */
export interface HostedCopilotBoundary {
  /** Agent socket upgrades pass no response, which also renews their token further ahead of expiry. */
  authorize(request: IncomingMessage, response?: ServerResponse): Promise<HostedIdentity | undefined>;
  acquire(identity: HostedIdentity): Promise<Lease>;
  isActive(identity: HostedIdentity): Promise<boolean>;
}

export function createCopilotMiddleware(runtime: CopilotRuntime, hosted?: HostedCopilotBoundary) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const route = request.url?.split('?')[0];
    if (route !== COPILOT_API_PATH && !route?.startsWith(`${COPILOT_API_PATH}/`)) {
      next();
      return;
    }
    if (!hosted && !isLocalRequest(request)) {
      writeJson(response, 403, { code: 'invalid_request', message: 'Copilot is only available to the same-origin local app.' });
      return;
    }

    const controller = new AbortController();
    let finished = false;
    let checkingAuthorization = false;
    let authorizationMonitor: ReturnType<typeof setInterval> | undefined;
    const deadline = hosted ? setTimeout(() => {
      controller.abort(new CopilotRequestError('timeout', 'The hosted Copilot request timed out. Please retry.', 504));
    }, 210_000) : undefined;
    const onTransportError = (error: Error) => {
      if (!request.aborted && !controller.signal.aborted) {
        if (hosted) console.error('[Flowpilot hosted] Copilot connection failed.');
        else console.error('[Flowpilot] Copilot connection failed.', error);
      }
      controller.abort(error);
    };
    request.once('error', onTransportError);
    response.once('error', onTransportError);
    const onClose = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on('close', onClose);

    const writeEvent = (event: CopilotStreamEvent) => {
      if (response.destroyed || (!hosted && controller.signal.aborted)) return;
      if (!response.headersSent) {
        response.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
        });
      }
      response.write(`${JSON.stringify(event)}\n`);
    };

    async function handle(): Promise<void> {
      const identity = hosted ? await hosted.authorize(request, response) : undefined;
      controller.signal.throwIfAborted();
      if (route === `${COPILOT_API_PATH}/status` && request.method === 'GET') {
        const status = hosted ? await runtime.status(identity, controller.signal) : await runtime.status();
        if (!response.destroyed) writeJson(response, 200, status);
      } else if (route === `${COPILOT_API_PATH}/chat` && request.method === 'POST') {
        if (hosted && !identity) throw new CopilotRequestError('not_authenticated', COPILOT_HOSTED_LOGIN_MESSAGE, 401);
        const checkAuthorization = async () => {
          if (hosted && identity && !await hosted.isActive(identity)) {
            throw new CopilotRequestError('not_authenticated', 'Your GitHub connection ended. Connect again to continue.', 401);
          }
        };
        if (hosted) {
          authorizationMonitor = setInterval(() => {
            if (finished || checkingAuthorization) return;
            checkingAuthorization = true;
            void checkAuthorization().catch((error: unknown) => {
              if (!finished) controller.abort(error);
            }).finally(() => { checkingAuthorization = false; });
          }, 5000);
        }
        const lease = hosted && identity ? await hosted.acquire(identity) : undefined;
        let text: string;
        try {
          controller.signal.throwIfAborted();
          const body = await readRequest(request);
          await checkAuthorization();
          controller.signal.throwIfAborted();
          text = await runtime.generate(body, (delta) => writeEvent({ type: 'delta', text: delta }), controller.signal, identity);
          await checkAuthorization();
        } finally {
          await lease?.release();
        }
        controller.signal.throwIfAborted();
        if (!response.destroyed) {
          writeEvent({ type: 'done', text });
          response.end();
        }
      } else {
        writeJson(response, 404, { code: 'invalid_request', message: 'Unknown Copilot endpoint or method.' });
      }
    }

    void handle().catch((error: unknown) => {
      if (response.destroyed) return;
      const failure = hosted ? hostedCopilotError(error) : toRequestError(error);
      if (hosted) console.error('[Flowpilot hosted] Copilot request failed:', failure.code);
      else console.error('[Flowpilot] Copilot request failed:', failure.message);
      if (response.headersSent) {
        writeEvent({ type: 'error', error: { code: failure.code, message: failure.message } });
        response.end();
      } else {
        writeJson(response, failure.status, { code: failure.code, message: failure.message });
      }
    }).finally(() => {
      finished = true;
      clearInterval(authorizationMonitor);
      clearTimeout(deadline);
      response.removeListener('close', onClose);
    });
  };
}
