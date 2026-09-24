import { STATUS_CODES, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AGENT_API_PATH,
  AGENT_CLIENT_MESSAGE_MAX_BYTES,
  AGENT_INVALID_START_MESSAGE,
  AGENT_PROTOCOL_VERSION,
  AGENT_SUBPROTOCOL,
  parseAgentClientMessage,
  type AgentServerMessage,
} from '../src/services/copilot/agentProtocol';
import { COPILOT_HOSTED_LOGIN_MESSAGE, CopilotRequestError } from '../src/services/copilot/protocol';
import type { AgentStart, AgentTurn, CopilotAgentRuntime } from './copilotAgentRuntime';
import { hostedCopilotError, toRequestError, waitWithSignal } from './copilotHost';
import { localOrigin, type HostedCopilotBoundary } from './copilotMiddleware';
import type { CopilotRuntime } from './copilotRuntime';
import type { HostedIdentity } from './hosted/authSessions';
import type { Lease } from './hosted/leases';

// One turn per connection. Browsers send `start` right after connecting and answer every `ping`.
const START_TIMEOUT_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 60_000;
const AUTH_CHECK_INTERVAL_MS = 5_000;
// Renewed well inside the 300 s lease, which still frees the account if the process dies.
const LEASE_RENEWAL_MS = 60_000;
// A browser answers a close at once, but a hosted socket stops reading when its turn ends and never sees the answer.
const CLOSE_GRACE_MS = 2_000;

/** Answers an upgrade with a plain HTTP error. Browsers only see a failed connection. */
export function rejectUpgrade(socket: Duplex, status: number): void {
  // Node removes its own error handling from upgraded sockets.
  socket.on('error', () => socket.destroy());
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function offersSubprotocol(request: IncomingMessage): boolean {
  return (request.headers['sec-websocket-protocol'] ?? '').split(',').some((protocol) => protocol.trim() === AGENT_SUBPROTOCOL);
}

function isLocalUpgrade(request: IncomingMessage): boolean {
  const origin = localOrigin(request);
  return Boolean(origin) && request.headers.origin === origin;
}

export interface CopilotAgentEndpoint {
  /** Takes over agent upgrades and leaves every other upgrade, such as Vite HMR, untouched. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Rejects new connections and ends every open one with `interrupted`. Never rejects. */
  close(): Promise<void>;
}

export function createCopilotAgentEndpoint(runtime: CopilotRuntime, hosted?: HostedCopilotBoundary): CopilotAgentEndpoint {
  const server = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: AGENT_CLIENT_MESSAGE_MAX_BYTES.start,
    handleProtocols: () => AGENT_SUBPROTOCOL,
  });
  const connections = new Set<{ interrupt(): void; running?: Promise<void> }>();
  let closing = false;

  function connectionError(error: unknown): CopilotRequestError {
    return hosted ? hostedCopilotError(error) : toRequestError(error);
  }

  function connect(ws: WebSocket, agent: CopilotAgentRuntime, identity?: HostedIdentity): void {
    const controller = new AbortController();
    const connection: { interrupt(): void; running?: Promise<void> } = {
      interrupt: () => abort(new CopilotRequestError('interrupted', 'Flowpilot was interrupted. Changes made so far stay on the canvas.')),
    };
    connections.add(connection);
    let turn: AgentTurn | undefined;
    let starting = false;
    let cancelled = false;
    let checking = false;
    let final: AgentServerMessage | undefined;
    let closeGrace: ReturnType<typeof setTimeout> | undefined;
    let begin!: (start: AgentStart) => void;
    const started = new Promise<AgentStart>((resolve) => { begin = resolve; });

    const write = (message: AgentServerMessage) => ws.send(JSON.stringify(message));
    // done and error wait until the turn's session and lease are freed, so the browser can start its next turn at once.
    const send = (message: AgentServerMessage) => {
      if (message.type === 'done' || message.type === 'error') final ??= message;
      else write(message);
    };
    const finish = () => {
      ws.close(closing ? 1001 : 1000);
      closeGrace = setTimeout(() => ws.terminate(), CLOSE_GRACE_MS);
    };

    function log(failure: CopilotRequestError): void {
      if (closing) return;
      if (hosted) console.error('[Flowpilot hosted] Copilot agent connection failed:', failure.code);
      else console.error('[Flowpilot] Copilot agent connection failed:', failure.message);
    }

    function report(error: unknown): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      const failure = connectionError(error);
      log(failure);
      send({ v: AGENT_PROTOCOL_VERSION, type: 'error', code: failure.code, message: failure.message });
    }

    function abort(error: unknown): void {
      if (controller.signal.aborted) return;
      controller.abort(error);
      // A running turn sends the error itself; otherwise run() reports it.
      if (turn) log(connectionError(error));
    }

    function protocolError(): void {
      // The socket closes at once, so an explanation such as an unreadable start goes out first.
      if (final) write(final);
      controller.abort();
      ws.close(1008, 'Invalid Flowpilot message.');
    }

    const startDeadline = setTimeout(protocolError, START_TIMEOUT_MS);
    const heartbeat = setInterval(() => send({ v: AGENT_PROTOCOL_VERSION, type: 'ping' }), PING_INTERVAL_MS);
    const silence = setTimeout(() => ws.terminate(), PONG_TIMEOUT_MS);
    const authMonitor = hosted && identity ? setInterval(() => {
      if (checking) return;
      checking = true;
      // A sign-in the store could not check ends the turn like a lost lease, so the browser can continue it.
      void hosted.isActive(identity).then((active) => {
        if (!active) abort(new CopilotRequestError('not_authenticated', 'Your GitHub connection ended. Connect again to continue.', 401));
      }, () => {
        console.error('[Flowpilot hosted] Sign-in check failed.');
        connection.interrupt();
      }).finally(() => { checking = false; });
    }, AUTH_CHECK_INTERVAL_MS) : undefined;

    async function run(): Promise<void> {
      let lease: Lease | undefined;
      let renewal: ReturnType<typeof setInterval> | undefined;
      let renewing: Promise<void> | undefined;
      try {
        if (hosted && identity) {
          // Nothing is read until the account holds its generation lease, so each user has at most one start frame parsed.
          ws.pause();
          lease = await hosted.acquire(identity);
          controller.signal.throwIfAborted();
          ws.resume();
          const active = lease;
          renewal = setInterval(() => {
            // A slot the store could not renew ends the turn like one taken over, so the browser can continue it.
            renewing = active.renew().catch(() => {
              console.error('[Flowpilot hosted] Generation lease renewal failed.');
              return false;
            }).then((renewed) => {
              if (!renewed) abort(new CopilotRequestError('interrupted', 'Flowpilot lost its generation slot. Changes made so far stay on the canvas.'));
            });
          }, LEASE_RENEWAL_MS);
        }
        const start = await waitWithSignal(started, controller.signal);
        if (cancelled) {
          send({ v: AGENT_PROTOCOL_VERSION, type: 'done', reply: '' });
          return;
        }
        turn = agent.startTurn(start, { send }, controller.signal, identity);
        await turn.finished;
      } catch (error) {
        report(controller.signal.aborted ? controller.signal.reason : error);
      } finally {
        // Nothing more is parsed, and a hosted socket stops reading before its lease goes, so an account has one reader.
        // Pongs go unread from here, so the silence timer stops; closeGrace bounds the rest.
        clearInterval(heartbeat);
        clearTimeout(silence);
        controller.abort();
        if (hosted) ws.pause();
        clearInterval(renewal);
        await renewing;
        try {
          await lease?.release();
        } catch {
          if (hosted) console.error('[Flowpilot hosted] Generation lease release failed.');
        }
        if (final) write(final);
        finish();
        connections.delete(connection);
      }
    }

    ws.on('message', (data, isBinary) => {
      if (controller.signal.aborted) return;
      const message = isBinary ? null : parseAgentClientMessage(data.toString());
      if (!message) {
        // Before a turn starts, the browser can still show why instead of a dropped connection.
        if (!starting) report(new CopilotRequestError('invalid_request', AGENT_INVALID_START_MESSAGE, 400));
        protocolError();
        return;
      }
      silence.refresh();
      if (message.type === 'pong') return;
      if (message.type === 'start' && !starting) {
        starting = true;
        clearTimeout(startDeadline);
        begin(message);
      } else if (turn && message.type !== 'start') {
        turn.receive(message);
      } else if (starting && message.type === 'cancel') {
        // Stop pressed before the turn started.
        cancelled = true;
      } else {
        protocolError();
      }
    });
    ws.on('error', (error) => {
      if (hosted) console.error('[Flowpilot hosted] Copilot agent socket failed.');
      else console.error('[Flowpilot] Copilot agent socket failed.', error);
    });
    ws.on('close', () => {
      clearTimeout(startDeadline);
      clearInterval(heartbeat);
      clearTimeout(silence);
      clearInterval(authMonitor);
      clearTimeout(closeGrace);
      controller.abort();
    });
    connection.running = run();
  }

  return {
    upgrade(request, socket, head) {
      if (request.url?.split('?')[0] !== AGENT_API_PATH) return;
      const agent = runtime.agent;
      if (closing || !agent) {
        rejectUpgrade(socket, 503);
        return;
      }
      // Browsers cannot set headers on a WebSocket, so the subprotocol stands in for x-flowpilot-client.
      if (!offersSubprotocol(request) || (!hosted && !isLocalUpgrade(request))) {
        rejectUpgrade(socket, 403);
        return;
      }
      const onError = () => socket.destroy();
      socket.on('error', onError);
      void (async () => {
        const identity = hosted ? await hosted.authorize(request) : undefined;
        if (hosted && !identity) throw new CopilotRequestError('not_authenticated', COPILOT_HOSTED_LOGIN_MESSAGE, 401);
        if (closing) throw new CopilotRequestError('runtime_unavailable', 'The Copilot runtime is shutting down.');
        socket.off('error', onError);
        server.handleUpgrade(request, socket, head, (ws) => connect(ws, agent, identity));
      })().catch((error: unknown) => {
        const failure = connectionError(error);
        if (hosted) console.error('[Flowpilot hosted] Copilot agent connection rejected:', failure.code);
        else console.error('[Flowpilot] Copilot agent connection rejected:', failure.message);
        rejectUpgrade(socket, failure.status);
      });
    },

    async close() {
      closing = true;
      const running = [...connections].map((connection) => {
        connection.interrupt();
        return connection.running;
      });
      await Promise.all(running);
    },
  };
}
