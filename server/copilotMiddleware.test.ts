// @vitest-environment node
import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCopilotMiddleware } from './copilotMiddleware';
import { COPILOT_MAX_BODY_BYTES, CopilotRequestError, type CopilotStatus } from '../src/services/copilot/protocol';
import type { CopilotRuntime } from './copilotRuntime';

const STATUS: CopilotStatus = { runtime: 'github-copilot-sdk', authenticated: true, models: [] };
const INPUT = { prompt: 'Draw a diagram', systemInstruction: 'Return DSL', history: [], model: 'auto' };
const HEADERS = { 'x-flowpilot-client': '1', 'Content-Type': 'application/json' };
let server: Server;
let origin: string;
let runtime: CopilotRuntime;

beforeEach(async () => {
  runtime = {
    status: vi.fn().mockResolvedValue(STATUS),
    generate: vi.fn(async (_request, onDelta) => {
      onDelta('flow: ');
      onDelta('"Test"');
      return 'flow: "Test"';
    }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const middleware = createCopilotMiddleware(runtime);
  server = createServer((request, response) => middleware(request, response, () => {
    response.writeHead(404);
    response.end('not found');
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  origin = `http://127.0.0.1:${address.port}`;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  vi.restoreAllMocks();
});

describe('local Copilot HTTP boundary', () => {
  it('serves local status without enabling cross-origin access', async () => {
    const response = await fetch(`${origin}/api/copilot/status`, { headers: HEADERS });
    expect(await response.json()).toEqual(STATUS);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each([
    {},
    { ...HEADERS, origin: 'https://untrusted.example' },
    { ...HEADERS, origin: 'null' },
    { ...HEADERS, 'sec-fetch-site': 'cross-site' },
  ])('rejects unsafe requests before starting the SDK: %j', async (headers) => {
    const response = await fetch(`${origin}/api/copilot/status`, { headers });
    expect(response.status).toBe(403);
    expect(runtime.status).not.toHaveBeenCalled();
    expect(runtime.generate).not.toHaveBeenCalled();
  });

  it('rejects DNS rebinding hostnames even on a loopback socket', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${origin}/api/copilot/status`, {
        headers: { ...HEADERS, host: 'rebound.example' },
      }, (response) => {
        response.on('error', reject);
        response.on('end', () => resolve(response.statusCode));
        response.resume();
      });
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(403);
    expect(runtime.status).not.toHaveBeenCalled();
  });

  it.each([false, true])('bounds request bodies before calling the SDK (chunked: %s)', async (chunked) => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${origin}/api/copilot/chat`, {
        method: 'POST',
        agent: false,
        headers: {
          ...HEADERS,
          ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': COPILOT_MAX_BODY_BYTES + 1 }),
        },
      }, (response) => {
        response.on('error', reject);
        response.on('end', () => resolve(response.statusCode));
        response.resume();
      });
      request.on('error', reject);
      // A declared oversized body must be rejected before the client uploads it.
      request.end(chunked ? ' '.repeat(COPILOT_MAX_BODY_BYTES + 1) : undefined);
    });
    expect(status).toBe(413);
    expect(runtime.generate).not.toHaveBeenCalled();
  });

  it('streams a complete response for a same-origin request', async () => {
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: { ...HEADERS, origin }, body: JSON.stringify(INPUT),
    });
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(events).toEqual([
      { type: 'delta', text: 'flow: ' },
      { type: 'delta', text: '"Test"' },
      { type: 'done', text: 'flow: "Test"' },
    ]);
  });

  it.each([
    { ...INPUT, prompt: '' },
    { ...INPUT, model: 42 },
    { ...INPUT, image: 'file:///etc/passwd' },
    { ...INPUT, image: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { ...INPUT, tools: ['shell'] },
    { ...INPUT, cliPath: '/bin/sh' },
    { ...INPUT, apiKey: 'do-not-accept-credentials' },
  ])('rejects invalid or privileged request fields', async (body) => {
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(runtime.generate).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON and form submissions', async () => {
    const malformed = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: HEADERS, body: '{bad',
    });
    expect(malformed.status).toBe(400);
    const form = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: { ...HEADERS, 'Content-Type': 'text/plain' }, body: JSON.stringify(INPUT),
    });
    expect(form.status).toBe(415);
    expect(runtime.generate).not.toHaveBeenCalled();
  });

  it('returns auth failures as explicit errors, not a successful stream', async () => {
    vi.mocked(runtime.generate).mockRejectedValue(new CopilotRequestError('not_authenticated', 'Run gh copilot login', 401));
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(INPUT),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'not_authenticated', message: 'Run gh copilot login' });
  });

  it('emits an error, never done, if the SDK fails after streaming', async () => {
    vi.mocked(runtime.generate).mockImplementation(async (_request, onDelta) => {
      onDelta('partial');
      throw new Error('Quota exceeded');
    });
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(INPUT),
    });
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(['delta', 'error']);
    expect(events[1].error.message).toContain('Quota exceeded');
  });

  it('aborts SDK work when the browser disconnects', async () => {
    const aborted = vi.fn();
    vi.mocked(runtime.generate).mockImplementation(async (_request, onDelta, signal) => {
      onDelta('partial');
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted();
          reject(signal.reason);
        }, { once: true });
      });
    });
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(INPUT), signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
  });
});
