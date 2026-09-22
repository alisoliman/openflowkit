import { expect, test, type Page } from '@playwright/test';
import type { CopilotRequest } from '../src/services/copilot/protocol';

const STATUS = {
  runtime: 'github-copilot-sdk', authenticated: true, login: 'test-user',
  models: [{ id: 'model-a', name: 'Account model A', multiplier: 0.5 }, { id: 'model-b', name: 'Account model B', multiplier: 1 }],
};
const INITIAL = 'flow: Orders\ndirection: TB\n[process] web: Web Client\n[process] api: Orders API\nweb ->|HTTP| api';

function currentDiagram(request: CopilotRequest): string {
  const diagram = request.prompt.split('CURRENT DIAGRAM — output the complete updated OpenFlow DSL:\n')[1]?.split('\n\nIMPORTANT:')[0];
  expect(diagram).toBeTruthy();
  return diagram!;
}

function stream(text: string): string {
  return `${JSON.stringify({ type: 'delta', text })}\n${JSON.stringify({ type: 'done', text })}\n`;
}

async function openFlowpilot(page: Page) {
  await page.goto('/#/home');
  await page.getByTestId('home-create-new-main').click();
  await page.getByTestId('toolbar-flowpilot-toggle').click();
  await expect(page.getByRole('textbox')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Copilot model' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Set up Flowpilot' })).toBeHidden();
}

async function send(page: Page, prompt: string, enter = false) {
  await page.getByRole('textbox').fill(prompt);
  if (enter) await page.getByRole('textbox').press('Enter');
  else await page.getByLabel('Generate with Flowpilot', { exact: true }).click();
}

async function apply(page: Page) {
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply to canvas' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('hasSeenWelcome_v1', 'true');
    localStorage.setItem('i18nextLng', 'en');
  });
});

for (const method of ['enter', 'button']) {
  test(`composer clears immediately on ${method} while a plan is still running`, async ({ page }) => {
    await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    await page.route('**/api/copilot/chat', async (route) => {
      await pending;
      await route.fulfill({ contentType: 'application/x-ndjson', body: stream('Plan ready: connect Web Client to Orders API.') });
    });
    await openFlowpilot(page);
    await send(page, 'Plan an order diagram before drawing it.', method === 'enter');
    await expect(page.getByRole('button', { name: 'Cancel generation' })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveValue('');
    await page.getByRole('textbox').fill('Add Redis after this.');
    finish();
    await expect(page.getByText('Plan ready: connect Web Client to Orders API.', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveValue('Add Redis after this.');
  });
}

test('review mode preserves context across follow-ups, discard, model changes, and reload', async ({ page }) => {
  await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
  const requests: CopilotRequest[] = [];
  await page.route('**/api/copilot/chat', async (route) => {
    const request: CopilotRequest = route.request().postDataJSON();
    requests.push(request);
    let text = INITIAL;
    if (requests.length === 2) {
      expect(request.model).toBe('model-b');
      expect(request.prompt).not.toContain('Ignore the existing canvas');
      text = `${currentDiagram(request)}\n[process] cache: Redis { color: "yellow" }\napi ->|cache lookup| cache`;
    } else if (requests.length === 3) {
      expect(request.systemInstruction).toContain('OpenFlow DSL');
      text = currentDiagram(request).replace(/(\[[^\]]+\] cache:\s*)Redis/, '$1Orders Cache');
    } else if (requests.length === 4) {
      expect(request.prompt).toContain('CURRENT CANVAS (source of truth');
      expect(request.prompt).toContain('cache: Redis');
      expect(request.prompt).not.toContain('cache: Orders Cache');
      expect(request.history.filter((message) => message.role === 'assistant').map((message) => message.content).join('\n')).not.toContain('cache: Orders Cache');
      text = 'The cache node on the current canvas is Redis.';
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: stream(text) });
  });
  await openFlowpilot(page);
  expect(await page.getByRole('checkbox', { name: 'Apply edits automatically' }).isChecked()).toBe(false);
  await send(page, 'Create an Orders API diagram with Web Client.');
  await apply(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Edit current', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute('data-id'), position: (node as HTMLElement).style.transform,
  })));
  await page.getByRole('combobox', { name: 'Copilot model' }).selectOption('model-b');
  await send(page, 'Add Redis.', true);
  await apply(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  for (const original of before) {
    expect(await page.locator(`.react-flow__node[data-id="${original.id}"]`).evaluate((element) => (element as HTMLElement).style.transform)).toBe(original.position);
  }
  await send(page, 'Rename it to Orders Cache.');
  await expect(page.getByText('Renamed "Redis" to "Orders Cache"')).toBeVisible();
  await expect(page.getByText('Nodes changed: 1').first()).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="cache"]')).toContainText('Redis');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByText('Discarded · canvas unchanged')).toBeVisible();
  await send(page, 'What is the cache currently named?', true);
  await expect(page.getByText('The cache node on the current canvas is Redis.')).toBeVisible();
  expect(requests).toHaveLength(4);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.getByTestId('toolbar-flowpilot-toggle').click();
  await expect(page.getByText('Discarded · canvas unchanged')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="cache"]')).toContainText('Redis');
  await expect(page.getByRole('combobox', { name: 'Copilot model' })).toHaveValue('model-b');
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
});

test('automatic mode applies each turn, provides one-step undo, and honors the selected model', async ({ page }, testInfo) => {
  await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
  const requests: CopilotRequest[] = [];
  await page.route('**/api/copilot/chat', async (route) => {
    const request: CopilotRequest = route.request().postDataJSON();
    requests.push(request);
    const text = requests.length === 1 ? INITIAL
      : currentDiagram(request).replace(/(\[[^\]]+\] api:\s*)Orders API/, '$1Billing API');
    await route.fulfill({ contentType: 'application/x-ndjson', body: stream(text) });
  });
  await openFlowpilot(page);
  await page.getByRole('combobox', { name: 'Copilot model' }).selectOption('model-b');
  await page.getByRole('checkbox', { name: 'Apply edits automatically' }).check();
  await send(page, 'Create an order diagram.');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo AI edit' })).toBeEnabled();
  await send(page, 'Rename Orders API to Billing API.', true);
  await expect(page.locator('.react-flow__node[data-id="api"]')).toContainText('Billing API');
  await expect(page.getByRole('button', { name: 'Undo AI edit' })).toBeEnabled();
  expect(requests.map((request) => request.model)).toEqual(['model-b', 'model-b']);
  expect(requests[1].prompt).not.toContain('Ignore the existing canvas');
  await page.getByRole('button', { name: 'Undo AI edit' }).click();
  await expect(page.locator('.react-flow__node[data-id="api"]')).toContainText('Orders API');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByText('Undone', { exact: true })).toBeVisible();
  await expect(page.getByText('Generating diagram...', { exact: true })).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Undid the last AI edit.' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('flowpilot-controls-desktop.png') });
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByRole('checkbox', { name: 'Apply edits automatically' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Copilot model' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('flowpilot-controls-tablet.png') });
  await page.reload();
  await page.getByTestId('toolbar-flowpilot-toggle').click();
  await expect(page.getByRole('checkbox', { name: 'Apply edits automatically' })).toBeChecked();
  await expect(page.locator('.react-flow__node[data-id="api"]')).toContainText('Orders API');
});

test('a short confirmation executes a plan and a later confirmation applies its preview', async ({ page }) => {
  await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
  let requests = 0;
  await page.route('**/api/copilot/chat', async (route) => {
    const request: CopilotRequest = route.request().postDataJSON();
    requests++;
    const text = requests === 1 ? 'Create an order diagram with Web Client connected to Orders API.' : INITIAL;
    if (requests === 2) {
      expect(request.systemInstruction).toContain('OpenFlow DSL');
      expect(request.prompt).toContain('Carry out this previously discussed plan');
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: stream(text) });
  });
  await openFlowpilot(page);
  await send(page, 'Plan an order diagram before drawing it.');
  await expect(page.getByText('Create an order diagram with Web Client connected to Orders API.', { exact: true })).toBeVisible();
  await send(page, 'Yes, do that.', true);
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await send(page, 'Yes please');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
  expect(requests).toBe(2);
});

test('live Copilot preserves a discarded rename and performs undoable automatic edits', async ({ page }, testInfo) => {
  test.skip(process.env.FLOWPILOT_LIVE_COPILOT !== '1', 'Opt-in: uses the signed-in Copilot quota.');
  test.setTimeout(300_000);
  const response = await page.request.get('/api/copilot/status', { headers: { 'x-flowpilot-client': '1' }, timeout: 45_000 });
  expect(response.ok()).toBe(true);
  const status: typeof STATUS = await response.json();
  expect(status.authenticated).toBe(true);
  const model = status.models.find((entry) => entry.id === 'gpt-5-mini') ?? status.models.find((entry) => entry.id !== 'auto' && (entry.multiplier ?? 1) <= 1);
  expect(model).toBeTruthy();
  await openFlowpilot(page);
  await page.getByRole('combobox', { name: 'Copilot model' }).selectOption(model!.id);
  await send(page, 'Create exactly two process nodes: Orders API connected to Redis. Use node IDs api and cache. No other nodes.');
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible({ timeout: 180_000 });
  await apply(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await send(page, 'Rename Redis to Orders Cache.');
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText('Renamed "Redis" to "Orders Cache"')).toBeVisible();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await send(page, 'What is the cache node currently named on the canvas? Answer with its exact label only.');
  await expect(page.locator('[data-thread-type="assistant_lookup_result"]').last()).toHaveText(/^[\s*"`]*Redis[\s*"`.!]*$/, { timeout: 180_000 });
  await page.getByRole('checkbox', { name: 'Apply edits automatically' }).check();
  await send(page, 'Rename the cache to Session Cache. Keep every other node, connection, ID, and attribute unchanged.', true);
  await expect(page.locator('.react-flow__node[data-id="cache"]')).toContainText('Session Cache', { timeout: 180_000 });
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo AI edit' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo AI edit' }).click();
  await expect(page.locator('.react-flow__node[data-id="cache"]')).toContainText('Redis');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('flowpilot-live-multiturn.png') });
});
