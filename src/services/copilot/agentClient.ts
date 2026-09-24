import { createLogger } from '@/lib/logger';
import type { AgentToolResult } from '@/services/flowpilot/agent/executor';
import {
  AGENT_API_PATH,
  AGENT_INVALID_START_MESSAGE,
  AGENT_PROTOCOL_VERSION,
  AGENT_SUBPROTOCOL,
  parseAgentClientMessage,
  parseAgentServerMessage,
  type AgentClientMessage,
  type AgentServerMessage,
} from './agentProtocol';
import { getCopilotStatus, serializeCopilotRequest } from './client';
import {
  COPILOT_HOSTED_LOGIN_MESSAGE,
  COPILOT_LOGIN_MESSAGE,
  CopilotRequestError,
} from './protocol';

// The server answers a cancel once the turn's session is cleaned up, which takes up to 15 seconds.
// This only covers a connection that silently died.
const CANCEL_TIMEOUT_MS = 30_000;
// The server pings every 25 seconds, so this much silence means the connection died without closing.
const SILENCE_TIMEOUT_MS = 75_000;

const logger = createLogger({ scope: 'CopilotAgentClient' });

// The browser build does not use strictNullChecks, so zod types every field as optional there.
export type AgentTurnStart = Omit<Extract<AgentClientMessage, { type?: 'start' }>, 'v' | 'type'>;
export type AgentTurnEvent = Exclude<AgentServerMessage, { type?: 'accepted' | 'done' | 'error' | 'ping' }>;
type Outgoing<M = AgentClientMessage> = M extends AgentClientMessage ? Omit<M, 'v'> : never;

/** How a turn ended. `interrupted` covers socket loss and server shutdown; the work so far stays on the canvas. */
export type AgentTurnEnd =
  | { type: 'done'; reply: string }
  | { type: 'error'; code: CopilotRequestError['code']; message: string }
  | { type: 'interrupted' };

export interface AgentTurnHandlers {
  onEvent: (event: AgentTurnEvent) => void;
  /** Called once, unless the turn was closed from this side. */
  onEnd: (end: AgentTurnEnd) => void;
}

export interface AgentTurnConnection {
  sendToolResult: (callId: string, result: AgentToolResult) => void;
  answer: (questionId: string, answer: string, wasFreeform: boolean) => void;
  /** Asks the server to stop; the turn then ends with `done` and the reply so far. */
  cancel: () => void;
  /** Drops the socket without waiting for the end. The server abandons the turn. */
  close: () => void;
}

// Browsers cannot read why a handshake failed, so the status endpoint tells sign-in problems from dropped sockets.
async function explainFailedHandshake(): Promise<AgentTurnEnd> {
  try {
    const status = await getCopilotStatus(AbortSignal.timeout(30_000));
    if (status.authenticated) return { type: 'interrupted' };
    window.dispatchEvent(new Event('copilot-connection-changed'));
    return {
      type: 'error',
      code: 'not_authenticated',
      message: status.issue ?? (status.mode === 'hosted' ? COPILOT_HOSTED_LOGIN_MESSAGE : COPILOT_LOGIN_MESSAGE),
    };
  } catch (error) {
    return error instanceof CopilotRequestError
      ? { type: 'error', code: error.code, message: error.message }
      : { type: 'interrupted' };
  }
}

/** Opens one socket for one Flowpilot turn. Throws a CopilotRequestError when the start message is too large or invalid. */
export function startAgentTurn(start: AgentTurnStart, handlers: AgentTurnHandlers): AgentTurnConnection {
  const startFrame = serializeCopilotRequest({ v: AGENT_PROTOCOL_VERSION, type: 'start', ...start });
  // The server closes the socket on a start it cannot read, which would look like a dropped connection.
  if (!parseAgentClientMessage(startFrame)) {
    throw new CopilotRequestError('invalid_request', AGENT_INVALID_START_MESSAGE, 400);
  }
  const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}${AGENT_API_PATH}`, AGENT_SUBPROTOCOL);
  let opened = false;
  let ended = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;

  function listen(): void {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => end({ type: 'interrupted' }), SILENCE_TIMEOUT_MS);
  }

  function send(message: Outgoing): void {
    if (!ended && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ v: AGENT_PROTOCOL_VERSION, ...message }));
    }
  }

  function end(result: AgentTurnEnd): void {
    if (ended) return;
    ended = true;
    clearTimeout(cancelTimer);
    clearTimeout(silenceTimer);
    socket.close();
    handlers.onEnd(result);
  }

  socket.addEventListener('open', () => {
    opened = true;
    socket.send(startFrame);
    listen();
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    if (ended) return;
    listen();
    const message = typeof event.data === 'string' ? parseAgentServerMessage(event.data) : null;
    if (!message) {
      logger.warn('Ending the Flowpilot turn after an unreadable server message.');
      end({
        type: 'error',
        code: 'bad_response',
        message: 'Flowpilot sent a message this page could not read. Reload the page and try again.',
      });
      return;
    }
    switch (message.type) {
      case 'ping':
        send({ type: 'pong' });
        return;
      case 'accepted':
        return;
      case 'done':
        end({ type: 'done', reply: message.reply });
        return;
      case 'error':
        end(message.code === 'interrupted' ? { type: 'interrupted' } : { type: 'error', code: message.code, message: message.message });
        return;
      default:
        handlers.onEvent(message);
    }
  });

  socket.addEventListener('close', () => {
    if (ended) return;
    if (opened) {
      end({ type: 'interrupted' });
      return;
    }
    void explainFailedHandshake().then(end);
  });

  return {
    sendToolResult: (callId, result) => send({ type: 'tool_result', callId, ...result }),
    answer: (questionId, answer, wasFreeform) => send({ type: 'answer', questionId, answer, wasFreeform }),
    cancel: () => {
      if (ended) return;
      if (!opened) {
        end({ type: 'done', reply: '' });
        return;
      }
      send({ type: 'cancel' });
      cancelTimer ??= setTimeout(() => end({ type: 'interrupted' }), CANCEL_TIMEOUT_MS);
    },
    close: () => {
      if (ended) return;
      ended = true;
      clearTimeout(cancelTimer);
      clearTimeout(silenceTimer);
      socket.close();
    },
  };
}
