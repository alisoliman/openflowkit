import { createLogger } from '@/lib/logger';
import {
  COPILOT_API_PATH,
  COPILOT_CLIENT_HEADER,
  COPILOT_MAX_BODY_BYTES,
  COPILOT_MAX_HISTORY_MESSAGES,
  COPILOT_MAX_RESPONSE_CHARS,
  COPILOT_SETUP_MESSAGE,
  CopilotRequestError,
  copilotErrorSchema,
  copilotStatusSchema,
  copilotStreamEventSchema,
  type CopilotRequest,
  type CopilotStatus,
} from './protocol';

const logger = createLogger({ scope: 'CopilotClient' });

export type CopilotConnectionState =
  | { state: 'checking' }
  | { state: 'ready'; status: CopilotStatus }
  | { state: 'unavailable'; message: string };

function serializeCopilotRequest(input: CopilotRequest): string {
  const history = input.history.slice(-COPILOT_MAX_HISTORY_MESSAGES);
  let omitted = input.history.length - history.length;
  const notice: CopilotRequest['history'][number] = {
    role: 'user',
    content: '[Flowpilot context note: older conversation messages were omitted to fit the request limits. Use the current request and CURRENT CANVAS as the source of truth.]',
  };
  const encode = new TextEncoder();
  const serialize = () => JSON.stringify({
    ...input,
    history: omitted > 0 ? [notice, ...history] : history,
  });
  if (omitted > 0 && history.length === COPILOT_MAX_HISTORY_MESSAGES) {
    history.shift();
    omitted++;
  }
  let body = serialize();
  while (encode.encode(body).byteLength > COPILOT_MAX_BODY_BYTES && history.length > 0) {
    history.shift();
    omitted++;
    body = serialize();
  }
  if (encode.encode(body).byteLength > COPILOT_MAX_BODY_BYTES) {
    throw new CopilotRequestError('invalid_request', 'The current request is too large. Use a smaller image or shorter prompt.', 413);
  }
  if (omitted > 0) {
    logger.info('Older Copilot history was omitted to fit the request limits.', { omittedMessages: omitted });
  }
  return body;
}

async function request(path: string, options: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${COPILOT_API_PATH}/${path}`, {
      ...options,
      credentials: 'omit',
      headers: {
        [COPILOT_CLIENT_HEADER]: '1',
        ...options.headers,
      },
    });
  } catch {
    if (options.signal?.aborted) throw options.signal.reason;
    throw new CopilotRequestError('runtime_unavailable', COPILOT_SETUP_MESSAGE);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    if (contentType.includes('application/json')) {
      const error = copilotErrorSchema.safeParse(await response.json());
      if (error.success) {
        throw new CopilotRequestError(error.data.code, error.data.message, response.status);
      }
    }
    throw new CopilotRequestError('runtime_unavailable', COPILOT_SETUP_MESSAGE, response.status);
  }
  if (!contentType.includes(path === 'status' ? 'application/json' : 'application/x-ndjson')) {
    throw new CopilotRequestError('runtime_unavailable', COPILOT_SETUP_MESSAGE);
  }
  return response;
}

export async function getCopilotStatus(signal?: AbortSignal): Promise<CopilotStatus> {
  const response = await request('status', { signal });
  const status = copilotStatusSchema.safeParse(await response.json());
  if (!status.success) {
    throw new CopilotRequestError('bad_response', 'The local Copilot runtime returned an invalid status. Restart the local app.', 502);
  }
  return status.data;
}

export async function requestCopilot(
  input: CopilotRequest,
  onChunk?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const response = await request('chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: serializeCopilotRequest(input),
    signal,
  });
  if (!response.body) {
    throw new CopilotRequestError('bad_response', 'The Copilot response stream is missing.', 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamedLength = 0;
  let ended = false;

  function parseLine(line: string): string | undefined {
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      throw new CopilotRequestError('bad_response', 'The Copilot response stream was not valid JSON.', 502);
    }
    const event = copilotStreamEventSchema.safeParse(data);
    if (!event.success) {
      throw new CopilotRequestError('bad_response', 'The Copilot response stream was malformed.', 502);
    }
    if (event.data.type === 'error') {
      throw new CopilotRequestError(event.data.error.code, event.data.error.message);
    }
    if (event.data.type === 'done') {
      if (!event.data.text.trim() || event.data.text.length > COPILOT_MAX_RESPONSE_CHARS) {
        throw new CopilotRequestError('bad_response', 'Copilot returned an empty or oversized response.', 502);
      }
      if (streamedLength === 0) onChunk?.(event.data.text);
      return event.data.text;
    }
    streamedLength += event.data.text.length;
    if (streamedLength > COPILOT_MAX_RESPONSE_CHARS) {
      throw new CopilotRequestError('bad_response', 'The Copilot response was too large. Try a smaller diagram.', 502);
    }
    onChunk?.(event.data.text);
    return undefined;
  }

  try {
    while (!ended) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      ended = done;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : (lines.pop() ?? '');
      if (buffer.length > COPILOT_MAX_RESPONSE_CHARS * 2) {
        throw new CopilotRequestError('bad_response', 'The Copilot response stream was too large.', 502);
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        const text = parseLine(line);
        if (text !== undefined) return text;
      }
    }
    throw new CopilotRequestError('bad_response', 'Copilot disconnected before completing the response. No changes were applied; try again.', 502);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof CopilotRequestError) throw error;
    throw new CopilotRequestError('bad_response', 'Copilot disconnected before completing the response. No changes were applied; try again.', 502);
  } finally {
    await reader.cancel().catch((error: unknown) => {
      if (!signal?.aborted) logger.warn('Could not close the Copilot response stream.', { error });
    });
    reader.releaseLock();
  }
}
