// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
let directory: string;
let log: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openflowkit-release-test-'));
  log = join(directory, 'calls.jsonl');
  await writeFile(join(directory, 'az'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.CLI_LOG, JSON.stringify({ tool: 'az', args }) + '\\n');
if (args[0] === 'containerapp' && args[1] === 'show') {
  const traffic = process.env.TEST_TRAFFIC_SPLIT ? [{ revisionName: 'release--old', weight: 50 }, { revisionName: 'release--other', weight: 50 }] : [{ latestRevision: true, weight: 100 }];
  console.log(JSON.stringify({ properties: { latestReadyRevisionName: 'release--old', configuration: { ingress: { fqdn: 'primary.example.azurecontainerapps.io', traffic } } } }));
} else if (args[1] === 'revision' && args[2] === 'show' && args.includes('--query')) {
  console.log('candidate.example.azurecontainerapps.io');
}
`, { mode: 0o755 });
  await writeFile(join(directory, 'curl'), `#!/bin/sh
printf '{"tool":"curl"}\\n' >> "$CLI_LOG"
case "$*" in
  *candidate.example.azurecontainerapps.io/readyz*) [ -n "$TEST_FAIL_CANDIDATE" ] && exit 22 ;;
  *primary.example.azurecontainerapps.io/readyz*) [ -n "$TEST_FAIL_PRIMARY" ] && exit 22 ;;
esac
case "$*" in
  */readyz*) printf '{"status":"ready","revision":"%s"}' "$GITHUB_SHA" ;;
  *) printf '<meta name="flowpilot-runtime" content="hosted">' ;;
esac
`, { mode: 0o755 });
  await writeFile(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
});

afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function run(extra: NodeJS.ProcessEnv = {}) {
  return execute('bash', [resolve('scripts/deploy-hosted.sh')], {
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CLI_LOG: log,
      HOSTED_RESOURCE_GROUP: 'test-group',
      HOSTED_CONTAINER_APP: 'release',
      HOSTED_IMAGE: 'test.azurecr.io/openflowkit@sha256:test',
      GITHUB_SHA: '123456789abc123456789abc123456789abc12345678',
      GITHUB_RUN_ID: '100',
      GITHUB_RUN_ATTEMPT: '1',
      ...extra,
    },
  });
}

async function calls(): Promise<Array<{ tool: string; args?: string[] }>> {
  return (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

describe('health-gated hosted release', () => {
  it('pins old traffic, checks the candidate, promotes it, then deactivates the old revision', async () => {
    await run();
    const events = await calls();
    const routing = events.filter((event) => event.args?.includes('--revision-weight'));
    expect(routing.map((event) => event.args?.at(-3))).toEqual([
      'release--old=100', 'release--r-123456789abc-100-1=100',
    ]);
    const update = events.findIndex((event) => event.args?.[1] === 'update');
    const probe = events.findIndex((event) => event.tool === 'curl');
    const promotion = events.findIndex((event) => event.args?.includes('release--r-123456789abc-100-1=100'));
    expect(update).toBeLessThan(probe);
    expect(probe).toBeLessThan(promotion);
    expect(events.at(-1)?.args).toContain('release--old');
    expect(events.at(-1)?.args).toContain('deactivate');
  });

  it.each(['TEST_FAIL_CANDIDATE', 'TEST_FAIL_PRIMARY'])('restores production and stops the failed candidate: %s', async (failure) => {
    await expect(run({ [failure]: '1' })).rejects.toMatchObject({ code: 1 });
    const events = await calls();
    const routing = events.filter((event) => event.args?.includes('--revision-weight'));
    expect(routing.at(-1)?.args).toContain('release--old=100');
    expect(events.at(-1)?.args).toContain('release--r-123456789abc-100-1');
    expect(events.at(-1)?.args).toContain('deactivate');
    expect(events.filter((event) => event.args?.includes('deactivate')).every((event) => !event.args?.includes('release--old'))).toBe(true);
  });

  it('does not mutate a pre-existing custom traffic split', async () => {
    await expect(run({ TEST_TRAFFIC_SPLIT: '1' })).rejects.toBeTruthy();
    const events = await calls();
    expect(events).toHaveLength(1);
    expect(events[0].args?.slice(0, 2)).toEqual(['containerapp', 'show']);
  });
});
