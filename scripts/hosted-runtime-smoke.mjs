import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

if (process.env.HOSTED_EXPECTED_REVISION) {
  assert.equal(process.env.APP_REVISION, process.env.HOSTED_EXPECTED_REVISION, 'The container image does not match the expected revision.');
}

const reservation = createServer();
await new Promise((resolveListen, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', resolveListen);
});
const address = reservation.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolveClose, reject) => reservation.close((error) => error ? reject(error) : resolveClose()));

const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [resolve('dist-server/entry.js')], {
  env: {
    ...process.env,
    HOSTED_DEVELOPMENT: 'true',
    PUBLIC_ORIGIN: origin,
    PORT: String(port),
    APP_REVISION: 'local-runtime-proof',
    HOSTED_GITHUB_CLIENT_ID: 'development-proof-placeholder',
    HOSTED_GITHUB_CLIENT_SECRET: 'development-proof-placeholder',
    HOSTED_SESSION_KEY: randomBytes(32).toString('base64'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8000); });
child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8000); });
child.once('error', (error) => { output += `\n${error.message}`; });
const exited = new Promise((resolveExit) => child.once('close', (code) => resolveExit(code)));

try {
  let ready = false;
  let lastFailure = '';
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    try {
      const response = await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ready', revision: 'local-runtime-proof' });
      ready = true;
      break;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'Readiness failed';
      await delay(200);
    }
  }
  assert(ready, `Hosted runtime did not become ready: ${lastFailure}\n${output}`);
  const page = await fetch(origin);
  const html = await page.text();
  assert(html.includes('name="flowpilot-runtime" content="hosted"'));
  assert(!html.includes('development-proof-placeholder'));
  const asset = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  assert(asset, 'Missing production entry script');
  const javascript = await fetch(new URL(asset, origin), { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(javascript.status, 200);
  assert.equal(javascript.headers.get('content-encoding'), 'gzip');
  await javascript.arrayBuffer();

  const headers = { 'x-flowpilot-client': '1', Origin: origin, 'Content-Type': 'application/json' };
  const status = await fetch(`${origin}/api/copilot/status`, { headers });
  assert.deepEqual(await status.json(), {
    runtime: 'github-copilot-sdk', mode: 'hosted', signedIn: false, authenticated: false, models: [],
  });
  const chat = await fetch(`${origin}/api/copilot/chat`, { method: 'POST', headers, body: '{}' });
  assert.equal(chat.status, 401);
  const agent = new WebSocket(`${origin.replace('http', 'ws')}/api/copilot/agent`, 'flowpilot-agent.v1', { origin });
  const upgrade = await new Promise((resolveUpgrade) => {
    agent.once('open', () => { agent.terminate(); resolveUpgrade('Connected'); });
    agent.once('error', (error) => resolveUpgrade(error.message));
  });
  assert.equal(upgrade, 'Unexpected server response: 401', 'An anonymous agent socket was not rejected before upgrading.');
  const authorization = await fetch(`${origin}/api/copilot/auth/start`, {
    method: 'POST', headers, body: JSON.stringify({ returnTo: '/#/home' }),
  });
  assert.equal(authorization.status, 200);
  const authorizeUrl = new URL((await authorization.json()).url);
  assert.equal(authorizeUrl.origin, 'https://github.com');
  assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
  console.log('Built server, bundled stdio runtime, anonymous editor, gzip assets, agent socket rejection, and OAuth initiation are responsive. No live authorization or model request was made.');
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  const result = await Promise.race([exited, delay(20_000, 'timeout', { ref: false })]);
  if (result === 'timeout') {
    child.kill('SIGKILL');
    await exited;
    throw new Error('Hosted server did not shut down gracefully.');
  }
  assert.equal(result, 0, `Hosted server exited unsuccessfully.\n${output}`);
}
