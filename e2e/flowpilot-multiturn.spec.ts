import { expect, test, type Page, type Route } from '@playwright/test';

// Copilot chat runs as agent turns (flowpilot-agent.spec.ts); the API key providers keep the one-shot
// preview flow, exercised here through a mocked OpenAI endpoint.
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const AI_SETTINGS = { provider: 'openai', apiKey: 'test-key', model: 'gpt-5-mini', storageMode: 'local' };
const INITIAL = 'flow: Orders\ndirection: TB\n[process] web: Web Client\n[process] api: Orders API\nweb ->|HTTP| api';
const DSL = 'flow: "Draft"\ndirection: LR\n[process] client: Client\n[process] api: API\nclient -> api';

interface ChatRequest {
  model: string;
  systemInstruction: string;
  prompt: string;
  history: Array<{ role: string; content: string }>;
}

function readRequest(route: Route): ChatRequest {
  const { model, messages } = route.request().postDataJSON();
  const [system, ...history] = messages;
  const last = history.pop();
  return { model, systemInstruction: system.content, prompt: last.content, history };
}

function currentDiagram(request: ChatRequest): string {
  const diagram = request.prompt.split('CURRENT DIAGRAM — output the complete updated OpenFlow DSL:\n')[1]?.split('\n\nIMPORTANT:')[0];
  expect(diagram).toBeTruthy();
  return diagram!;
}

function stream(text: string) {
  return {
    contentType: 'text/event-stream',
    headers: { 'access-control-allow-origin': '*' },
    body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  };
}

async function openFlowpilot(page: Page) {
  await page.goto('/#/home');
  await page.getByTestId('home-create-new-main').click();
  await page.getByTestId('toolbar-flowpilot-toggle').click();
  await expect(page.getByRole('textbox')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Apply edits automatically' })).toBeEnabled();
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
  await page.addInitScript((settings) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('hasSeenWelcome_v1', 'true');
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('openflowkit-ai-settings', JSON.stringify(settings));
  }, AI_SETTINGS);
});

for (const method of ['enter', 'button']) {
  test(`composer clears immediately on ${method} while a plan is still running`, async ({ page }) => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    await page.route(OPENAI_CHAT_URL, async (route) => {
      await pending;
      await route.fulfill(stream('Plan ready: connect Web Client to Orders API.'));
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

test('review mode preserves context across follow-ups, discard, and reload', async ({ page }) => {
  const requests: ChatRequest[] = [];
  await page.route(OPENAI_CHAT_URL, async (route) => {
    const request = readRequest(route);
    requests.push(request);
    let text = INITIAL;
    if (requests.length === 2) {
      expect(request.model).toBe('gpt-5-mini');
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
    await route.fulfill(stream(text));
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
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
});

test('automatic mode applies each turn, provides one-step undo, and honors the configured model', async ({ page }, testInfo) => {
  const requests: ChatRequest[] = [];
  await page.route(OPENAI_CHAT_URL, async (route) => {
    const request = readRequest(route);
    requests.push(request);
    const text = requests.length === 1 ? INITIAL
      : currentDiagram(request).replace(/(\[[^\]]+\] api:\s*)Orders API/, '$1Billing API');
    await route.fulfill(stream(text));
  });
  await openFlowpilot(page);
  await page.getByRole('checkbox', { name: 'Apply edits automatically' }).check();
  await send(page, 'Create an order diagram.');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo AI edit' })).toBeEnabled();
  await send(page, 'Rename Orders API to Billing API.', true);
  await expect(page.locator('.react-flow__node[data-id="api"]')).toContainText('Billing API');
  await expect(page.getByRole('button', { name: 'Undo AI edit' })).toBeEnabled();
  expect(requests.map((request) => request.model)).toEqual(['gpt-5-mini', 'gpt-5-mini']);
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('flowpilot-controls-tablet.png') });
  await page.reload();
  await page.getByTestId('toolbar-flowpilot-toggle').click();
  await expect(page.getByRole('checkbox', { name: 'Apply edits automatically' })).toBeChecked();
  await expect(page.locator('.react-flow__node[data-id="api"]')).toContainText('Orders API');
});

test('a short confirmation executes a plan and a later confirmation applies its preview', async ({ page }) => {
  let requests = 0;
  await page.route(OPENAI_CHAT_URL, async (route) => {
    const request = readRequest(route);
    requests++;
    const text = requests === 1 ? 'Create an order diagram with Web Client connected to Orders API.' : INITIAL;
    if (requests === 2) {
      expect(request.systemInstruction).toContain('OpenFlow DSL');
      expect(request.prompt).toContain('Carry out this previously discussed plan');
    }
    await route.fulfill(stream(text));
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

test('preview approval keeps edit context, node ids, and node positions', async ({ page }) => {
  const requests: ChatRequest[] = [];
  let responseDsl = DSL;
  await page.route(OPENAI_CHAT_URL, async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer test-key');
    const request = readRequest(route);
    requests.push(request);
    expect(request.systemInstruction).toContain('OpenFlow');
    await route.fulfill(stream(responseDsl));
  });
  await openFlowpilot(page);
  await send(page, 'Create a simple flowchart with Client connected to API.');
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await apply(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(requests[0].model).toBe('gpt-5-mini');

  // Initial imports have a delayed measured-layout pass and an 800ms fit animation.
  await page.waitForTimeout(1000);
  const client = page.locator('.react-flow__node').filter({ hasText: 'Client' });
  const api = page.locator('.react-flow__node').filter({ hasText: 'API' });
  const clientId = await client.getAttribute('data-id');
  const apiId = await api.getAttribute('data-id');
  const position = await api.evaluate((element) => element.style.transform);
  responseDsl = `flow: "Updated"\ndirection: LR\n[process] ${clientId}: Client\n[process] ${apiId}: Gateway\n${clientId} -> ${apiId}`;
  await page.getByRole('button', { name: 'Edit current', exact: true }).click();
  await send(page, 'Change the API label to Gateway in the existing diagram.');
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible();
  expect(requests[1].prompt).toContain('CURRENT DIAGRAM');
  expect(requests[1].history.length).toBeGreaterThan(0);
  await apply(page);
  const gateway = page.locator('.react-flow__node').filter({ hasText: 'Gateway' });
  await expect(gateway).toBeVisible();
  expect(await gateway.getAttribute('data-id')).toBe(apiId);
  expect(await gateway.evaluate((element) => element.style.transform)).toBe(position);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});
