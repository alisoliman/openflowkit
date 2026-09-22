// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disconnectHostedCopilot, getCopilotStatus, requestCopilot, startHostedCopilotConnection } from './client';
import {
  COPILOT_LOGIN_MESSAGE, COPILOT_SETUP_MESSAGE, COPILOT_MAX_BODY_BYTES,
  COPILOT_MAX_HISTORY_MESSAGES, copilotRequestSchema, type CopilotRequest,
} from './protocol';

const INPUT: CopilotRequest = {
  prompt: 'Draw a client and an API',
  systemInstruction: 'Return OpenFlow DSL only.',
  history: [],
  model: 'auto',
};

function streamResponse(text: string, splitEveryByte = false): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      if (splitEveryByte) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      } else {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Copilot browser transport', () => {
  it('starts browser OAuth with same-origin cookies without exposing tokens', async () => {
    vi.stubGlobal('window', { location: { pathname: '/editor', search: '?id=one', hash: '#two' } });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ url: 'https://github.com/login/oauth/authorize?client_id=test' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await startHostedCopilotConnection()).toBe('https://github.com/login/oauth/authorize?client_id=test');
    expect(fetchMock).toHaveBeenCalledWith('/api/copilot/auth/start', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ returnTo: '/editor?id=one#two' }),
    }));
  });

  it('rejects unexpected authorization destinations', async () => {
    vi.stubGlobal('window', { location: { pathname: '/', search: '', hash: '' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ url: 'https://evil.example/authorize' })));
    await expect(startHostedCopilotConnection()).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('notifies all connection controls only after confirmed logout', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ disconnected: true })));
    await disconnectHostedCopilot();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'copilot-connection-changed' }));
  });

  it.each([201, 450])('sends a bounded suffix of a %s-message conversation without changing local history', async (count) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const history: CopilotRequest['history'] = Array.from({ length: count }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant', content: `Message ${index}`,
    }));
    const input = { ...INPUT, history };
    const fetchMock = vi.fn().mockResolvedValue(streamResponse('{"type":"done","text":"answer"}\n'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await requestCopilot(input)).toBe('answer');
    const sent = copilotRequestSchema.parse(JSON.parse(fetchMock.mock.calls[0][1].body));

    expect(sent.history).toHaveLength(COPILOT_MAX_HISTORY_MESSAGES);
    expect(sent.history[0].content).toContain('older conversation messages were omitted');
    expect(sent.history.slice(1)).toEqual(history.slice(-(COPILOT_MAX_HISTORY_MESSAGES - 1)));
    expect(sent.prompt).toBe(INPUT.prompt);
    expect(input.history).toHaveLength(count);
    expect(input.history[0].content).toBe('Message 0');
  });

  it('also bounds UTF-8 request bytes while preserving the current prompt and newest messages', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const history: CopilotRequest['history'] = Array.from({ length: 6 }, (_, index) => ({
      role: 'user', content: `${index}: ${'図'.repeat(600_000)}`,
    }));
    const fetchMock = vi.fn().mockResolvedValue(streamResponse('{"type":"done","text":"answer"}\n'));
    vi.stubGlobal('fetch', fetchMock);
    await requestCopilot({ ...INPUT, history });
    const body: string = fetchMock.mock.calls[0][1].body;
    const sent = copilotRequestSchema.parse(JSON.parse(body));
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(COPILOT_MAX_BODY_BYTES);
    expect(sent.history.length).toBeLessThan(history.length);
    expect(sent.history.at(-1)).toEqual(history.at(-1));
    expect(sent.prompt).toBe(INPUT.prompt);
    expect(history).toHaveLength(6);
  });

  it('rejects an oversized current request rather than silently truncating the prompt', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestCopilot({ ...INPUT, prompt: 'x'.repeat(COPILOT_MAX_BODY_BYTES) }))
      .rejects.toMatchObject({ code: 'invalid_request', status: 413 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('decodes fragmented UTF-8, streams deltas, and requires a terminal result', async () => {
    const text = 'flow: "日本語"\n[process] api: API';
    const response = streamResponse([
      JSON.stringify({ type: 'delta', text: 'flow: "日本語"\n' }),
      JSON.stringify({ type: 'delta', text: '[process] api: API' }),
      JSON.stringify({ type: 'done', text }),
    ].join('\r\n'), true);
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const onChunk = vi.fn();

    expect(await requestCopilot(INPUT, onChunk)).toBe(text);
    expect(onChunk.mock.calls.map(([chunk]) => chunk).join('')).toBe(text);
    expect(fetchMock).toHaveBeenCalledWith('/api/copilot/chat', expect.objectContaining({
      credentials: 'same-origin',
      headers: { 'x-flowpilot-client': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(INPUT),
    }));
  });

  it('supports a final response without delta events or a trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('{"type":"done","text":"answer"}')));
    const onChunk = vi.fn();
    expect(await requestCopilot(INPUT, onChunk)).toBe('answer');
    expect(onChunk).toHaveBeenCalledExactlyOnceWith('answer');
  });

  it.each([
    ['{"type":"delta","text":"partial"}\n', 'disconnected'],
    ['not JSON\n', 'not valid JSON'],
    ['{"type":"unknown"}\n', 'malformed'],
    ['{"type":"done","text":"   "}\n', 'empty'],
  ])('rejects incomplete or invalid streams: %s', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(body)));
    await expect(requestCopilot(INPUT)).rejects.toMatchObject({ code: 'bad_response', message: expect.stringContaining(message) });
  });

  it('propagates quota failures even after partial output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
      '{"type":"delta","text":"partial"}',
      '{"type":"error","error":{"code":"request_failed","message":"Copilot quota exhausted"}}',
    ].join('\n'))));
    await expect(requestCopilot(INPUT)).rejects.toMatchObject({ code: 'request_failed', message: 'Copilot quota exhausted' });
  });

  it('surfaces CLI sign-in instructions on an authentication failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
      { code: 'not_authenticated', message: COPILOT_LOGIN_MESSAGE }, { status: 401 },
    )));
    await expect(requestCopilot(INPUT)).rejects.toMatchObject({ code: 'not_authenticated', status: 401, message: COPILOT_LOGIN_MESSAGE });
  });

  it('explains why a static hosted app cannot use local CLI credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>SPA fallback</html>', {
      headers: { 'Content-Type': 'text/html' },
    })));
    await expect(getCopilotStatus()).rejects.toMatchObject({ code: 'runtime_unavailable', message: COPILOT_SETUP_MESSAGE });
  });

  it('reports an unreachable local runtime rather than asking for an API key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getCopilotStatus()).rejects.toMatchObject({ code: 'runtime_unavailable', message: COPILOT_SETUP_MESSAGE });
  });

  it('validates account/model discovery responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      runtime: 'github-copilot-sdk',
      authenticated: true,
      login: 'test-user',
      models: [{ id: 'model-1', name: 'Model one', vision: true, multiplier: 1 }],
      ignored: 'not part of the public contract',
    })));
    expect(await getCopilotStatus()).toEqual({
      runtime: 'github-copilot-sdk',
      authenticated: true,
      login: 'test-user',
      models: [{ id: 'model-1', name: 'Model one', vision: true, multiplier: 1 }],
    });
  });

  it('accepts SDK routing models whose vision capability is not specified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      runtime: 'github-copilot-sdk', authenticated: true,
      models: [{ id: 'auto', name: 'Auto' }],
    })));
    expect((await getCopilotStatus()).models).toEqual([{ id: 'auto', name: 'Auto' }]);
  });

  it('never converts cancellation after a delta into a successful partial result', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"type":"delta","text":"partial"}\n'));
      },
      cancel,
    }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(requestCopilot(INPUT, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
