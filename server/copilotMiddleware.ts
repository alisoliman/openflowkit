import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  COPILOT_API_PATH,
  COPILOT_CLIENT_HEADER,
  COPILOT_MAX_BODY_BYTES,
  CopilotRequestError,
  copilotRequestSchema,
  type CopilotStreamEvent,
} from '../src/services/copilot/protocol';
import type { CopilotRuntime } from './copilotRuntime';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalRequest(request: IncomingMessage): boolean {
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? '')) return false;
  if (request.headers[COPILOT_CLIENT_HEADER] !== '1') return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;

  try {
    const url = new URL(`http://${request.headers.host}`);
    if (!LOOPBACK_HOSTS.has(url.hostname) || url.host !== request.headers.host) return false;
    const origin = request.headers.origin;
    return !origin || origin === url.origin;
  } catch {
    return false;
  }
}

async function readRequest(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new CopilotRequestError('invalid_request', 'Copilot requests must use application/json.', 415);
  }
  if (Number(request.headers['content-length']) > COPILOT_MAX_BODY_BYTES) {
    request.resume();
    throw new CopilotRequestError('invalid_request', 'The request is too large. Use a smaller image or shorter conversation.', 413);
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > COPILOT_MAX_BODY_BYTES) {
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
  const parsed = copilotRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new CopilotRequestError('invalid_request', 'The Copilot request is invalid. Check the prompt, model, conversation length, and image format (PNG, JPEG, WebP, or GIF).', 400);
  }
  return parsed.data;
}

function toRequestError(error: unknown): CopilotRequestError {
  if (error instanceof CopilotRequestError) return error;
  return new CopilotRequestError(
    'request_failed',
    `Copilot could not complete the request: ${error instanceof Error ? error.message : 'Unknown runtime error'}`,
    502,
  );
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export function createCopilotMiddleware(runtime: CopilotRuntime) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const route = request.url?.split('?')[0];
    if (route !== COPILOT_API_PATH && !route?.startsWith(`${COPILOT_API_PATH}/`)) {
      next();
      return;
    }
    if (!isLocalRequest(request)) {
      writeJson(response, 403, { code: 'invalid_request', message: 'Copilot is only available to the same-origin local app.' });
      return;
    }

    const controller = new AbortController();
    const onTransportError = (error: Error) => {
      if (!request.aborted && !controller.signal.aborted) {
        console.error('[Flowpilot] Copilot connection failed.', error);
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
      if (response.destroyed) return;
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
      if (route === `${COPILOT_API_PATH}/status` && request.method === 'GET') {
        const status = await runtime.status();
        if (!response.destroyed) writeJson(response, 200, status);
      } else if (route === `${COPILOT_API_PATH}/chat` && request.method === 'POST') {
        const body = await readRequest(request);
        const text = await runtime.generate(body, (delta) => writeEvent({ type: 'delta', text: delta }), controller.signal);
        if (!response.destroyed) {
          writeEvent({ type: 'done', text });
          response.end();
        }
      } else {
        writeJson(response, 404, { code: 'invalid_request', message: 'Unknown Copilot endpoint or method.' });
      }
    }

    void handle().catch((error: unknown) => {
      if (controller.signal.aborted || response.destroyed) return;
      const failure = toRequestError(error);
      console.error('[Flowpilot] Copilot request failed:', failure.message);
      if (response.headersSent) {
        writeEvent({ type: 'error', error: { code: failure.code, message: failure.message } });
        response.end();
      } else {
        writeJson(response, failure.status, { code: failure.code, message: failure.message });
      }
    }).finally(() => {
      response.removeListener('close', onClose);
    });
  };
}
