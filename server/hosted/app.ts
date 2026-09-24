import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline, type Duplex } from 'node:stream';
import { createGzip } from 'node:zlib';
import { z } from 'zod';
import { AGENT_API_PATH } from '../../src/services/copilot/agentProtocol';
import { COPILOT_CLIENT_HEADER, CopilotRequestError } from '../../src/services/copilot/protocol';
import { createCopilotAgentEndpoint, rejectUpgrade } from '../copilotAgentEndpoint';
import { createCopilotMiddleware, readJsonRequest, writeJson, type HostedCopilotBoundary } from '../copilotMiddleware';
import type { CopilotRuntime } from '../copilotRuntime';
import { AuthSessions } from './authSessions';
import type { HostedConfig } from './config';
import type { GitHubAuth } from './githubAuth';
import { acquireGeneration } from './leases';
import type { StateStore } from './stateStore';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf',
};

export function assertSameOrigin(request: IncomingMessage, config: HostedConfig): void {
  if (
    request.headers.host !== new URL(config.origin).host
    || request.headers[COPILOT_CLIENT_HEADER] !== '1'
    || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
    || (request.headers.origin && request.headers.origin !== config.origin)
    || (request.method !== 'GET' && request.headers.origin !== config.origin)
  ) {
    throw new CopilotRequestError('invalid_request', 'Copilot requests must come from this app.', 403);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character));
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

async function authOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof CopilotRequestError) throw error;
    throw new CopilotRequestError('runtime_unavailable', 'The hosted sign-in service is unavailable. Please retry shortly.');
  }
}

export interface HostedApp {
  request: RequestListener;
  /** Only the agent socket upgrades; it bypasses the request listener, so it repeats the hosted checks. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Interrupts agent turns and closes their sockets. */
  close(): Promise<void>;
}

export async function createHostedApp(options: {
  config: HostedConfig;
  store: StateStore;
  github: GitHubAuth;
  runtime: CopilotRuntime;
  distDirectory: string;
  revision?: string;
}): Promise<HostedApp> {
  const { config, store, github, runtime } = options;
  const sessions = new AuthSessions(config, store, github);
  const root = await realpath(options.distDirectory);
  const headerConfig = z.object({ globalHeaders: z.record(z.string()) }).parse(
    JSON.parse(await readFile(resolve(root, 'staticwebapp.config.json'), 'utf8')),
  );
  const index = (await readFile(resolve(root, 'index.html'), 'utf8'))
    .replace('<head>', '<head><base href="/"><meta name="flowpilot-runtime" content="hosted">');
  const boundary: HostedCopilotBoundary = {
    authorize: (request, response) => authOperation(() => sessions.authenticate(request, response)),
    acquire: async (identity) => {
      const lease = await authOperation(() => acquireGeneration(store, identity.userId));
      return { renew: () => authOperation(lease.renew), release: () => authOperation(lease.release) };
    },
    isActive: (identity) => authOperation(async () => {
      const record = await store.get('auth', identity.sessionKey);
      return Boolean(record && record.expiresAt > Date.now());
    }),
  };
  const copilot = createCopilotMiddleware(runtime, boundary);
  const agent = createCopilotAgentEndpoint(runtime, boundary);
  let authWindow = 0;
  let authStarts = 0;

  async function serveFile(pathname: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); }
    catch { throw new CopilotRequestError('invalid_request', 'The requested path is invalid.', 400); }
    const candidate = resolve(root, `.${decoded}`);
    if (decoded.includes('\0') || decoded.includes('\\') || (candidate !== root && !candidate.startsWith(`${root}${sep}`))) {
      throw new CopilotRequestError('invalid_request', 'The requested path is invalid.', 400);
    }
    let file: string | undefined;
    try {
      const canonical = await realpath(candidate);
      if (canonical.startsWith(`${root}${sep}`) && (await stat(canonical)).isFile()) file = canonical;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    if (file === resolve(root, 'index.html') || (!file && !extname(decoded) && !decoded.startsWith('/assets/'))) {
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'], 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : index);
    } else if (file) {
      const metadata = await stat(file);
      const acceptsGzip = (request.headers['accept-encoding'] ?? '').split(',').some((part) => {
        const [encoding, ...parameters] = part.trim().split(';').map((value) => value.trim().toLowerCase());
        const quality = parameters.find((parameter) => parameter.startsWith('q='))?.slice(2);
        return encoding === 'gzip' && (quality === undefined || Number(quality) > 0);
      });
      const gzip = acceptsGzip
        && /\.(?:js|mjs|css|json|svg|xml|txt)$/.test(file);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : { 'Content-Length': metadata.size, Vary: 'Accept-Encoding' }),
        'Cache-Control': decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file);
      const onError = (error: NodeJS.ErrnoException | null) => {
        if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
          console.error('[Flowpilot hosted] Static asset delivery failed.');
        }
      };
      if (gzip) pipeline(stream, createGzip({ level: 1 }), response, onError);
      else pipeline(stream, response, onError);
    } else {
      writeJson(response, 404, { code: 'invalid_request', message: 'Not found.' });
    }
  }

  const listener: RequestListener = (request, response) => {
    for (const [name, value] of Object.entries(headerConfig.globalHeaders)) response.setHeader(name, value);
    if (!config.development) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('Cache-Control', 'no-store');
    let callback = false;

    async function handle(): Promise<void> {
      if (!request.url || request.url.length > 4096) throw new CopilotRequestError('invalid_request', 'The request URL is invalid.', 414);
      const url = new URL(request.url, config.origin);
      if (url.origin !== config.origin) throw new CopilotRequestError('invalid_request', 'The request URL is invalid.', 400);
      if (url.pathname === '/healthz' || url.pathname === '/readyz') {
        if (request.method !== 'GET') throw new CopilotRequestError('invalid_request', 'Method not allowed.', 405);
        await runtime.ready?.();
        if (url.pathname === '/readyz') await store.get('health', 'probe');
        writeJson(response, 200, { status: 'ready', revision: options.revision ?? 'development' });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        response.setHeader('Referrer-Policy', 'no-referrer');
        if (request.headers.host !== new URL(config.origin).host) {
          throw new CopilotRequestError('invalid_request', 'The request hostname is invalid.', 403);
        }
        callback = url.pathname === '/api/copilot/auth/callback' && request.method === 'GET';
        if (callback) {
          const returnTo = await sessions.complete(url, request, response);
          response.writeHead(303, { Location: `${config.origin}${returnTo}` });
          response.end();
          return;
        }
        assertSameOrigin(request, config);
        if (url.pathname === '/api/copilot/auth/start' && request.method === 'POST') {
          const window = Math.floor(Date.now() / 60_000);
          if (window !== authWindow) { authWindow = window; authStarts = 0; }
          if (++authStarts > 120) throw new CopilotRequestError('busy', 'GitHub sign-in is busy. Please retry in a minute.', 429);
          const input = z.object({ returnTo: z.string().max(2048) }).strict().safeParse(await readJsonRequest(request, 4096));
          if (!input.success) throw new CopilotRequestError('invalid_request', 'The sign-in request is invalid.', 400);
          writeJson(response, 200, { url: await sessions.start(input.data.returnTo, response) });
          return;
        }
        if (url.pathname === '/api/copilot/auth/logout' && request.method === 'POST') {
          const key = await sessions.disconnect(request, response);
          if (key) runtime.cancelConnection?.(key);
          writeJson(response, 200, { disconnected: true });
          return;
        }
        copilot(request, response, () => writeJson(response, 404, { code: 'invalid_request', message: 'Unknown API endpoint.' }));
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new CopilotRequestError('invalid_request', 'Method not allowed.', 405);
      }
      await serveFile(url.pathname, request, response);
    }

    void handle().catch((error: unknown) => {
      if (response.destroyed) return;
      const failure = error instanceof CopilotRequestError
        ? error
        : new CopilotRequestError('runtime_unavailable', 'The hosted service is unavailable. Please retry shortly.');
      console.error('[Flowpilot hosted] HTTP request failed:', failure.code);
      if (response.headersSent) { response.destroy(); return; }
      if (callback) {
        response.writeHead(failure.status, { 'Content-Type': CONTENT_TYPES['.html'] });
        response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GitHub connection | OpenFlowKit</title></head><body><main><h1>GitHub connection wasn't completed</h1><p>${escapeHtml(failure.message)}</p><p><a href="${escapeHtml(config.origin)}">Return to OpenFlowKit</a></p></main></body></html>`);
      } else {
        writeJson(response, failure.status, { code: failure.code, message: failure.message });
      }
    });
  };

  return {
    request: listener,
    upgrade(request, socket, head) {
      if (request.url?.split('?')[0] !== AGENT_API_PATH) {
        rejectUpgrade(socket, 404);
      } else if (
        request.headers.host !== new URL(config.origin).host
        || request.headers.origin !== config.origin
        || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
      ) {
        console.error('[Flowpilot hosted] Copilot agent connection rejected:', 'invalid_request');
        rejectUpgrade(socket, 403);
      } else {
        agent.upgrade(request, socket, head);
      }
    },
    close: () => agent.close(),
  };
}
