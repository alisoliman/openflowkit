import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test';

const STATUS = {
  runtime: 'github-copilot-sdk', authenticated: true, login: 'test-user',
  models: [{ id: 'model-a', name: 'Account model A', multiplier: 0.5 }, { id: 'model-b', name: 'Account model B', multiplier: 1 }],
};
const ORDERS_OPS = [
  { op: 'add_node', id: 'web', type: 'process', label: 'Web Client' },
  { op: 'add_node', id: 'api', type: 'process', label: 'Orders API' },
  { op: 'add_edge', source: 'web', target: 'api', label: 'HTTP' },
];

type Frame = Record<string, unknown> & { type: string };

/** One mocked agent socket, playing the server side of a Flowpilot turn. */
class AgentTurn {
  private frames: Frame[] = [];
  private waiters: Array<() => void> = [];
  private calls = 0;

  constructor(private readonly ws: WebSocketRoute) {
    ws.onMessage((message) => {
      this.frames.push(JSON.parse(String(message)));
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  send(type: string, fields: Record<string, unknown> = {}): void {
    this.ws.send(JSON.stringify({ v: 1, type, ...fields }));
  }

  async receive(type: string): Promise<Frame> {
    for (;;) {
      const index = this.frames.findIndex((frame) => frame.type === type);
      if (index >= 0) return this.frames.splice(index, 1)[0];
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  async accept(): Promise<Frame> {
    const start = await this.receive('start');
    this.send('accepted', { turnId: start.turnId });
    return start;
  }

  /** Runs a tool in the browser the way the server relays it, and returns the tool result. */
  async tool(name: string, args: unknown): Promise<Frame> {
    const callId = `call-${++this.calls}`;
    this.send('step', { callId, name, status: 'started' });
    this.send('tool_call', { callId, name, args });
    const result = await this.receive('tool_result');
    expect(result.callId).toBe(callId);
    this.send('step', { callId, name, status: result.ok ? 'succeeded' : 'failed' });
    return result;
  }

  finish(reply: string): void {
    if (reply) this.send('reply_delta', { text: reply });
    this.send('done', { reply });
  }
}

async function mockAgent(page: Page): Promise<() => Promise<AgentTurn>> {
  const opened: AgentTurn[] = [];
  let wake: (() => void) | undefined;
  await page.routeWebSocket('**/api/copilot/agent', (ws) => {
    opened.push(new AgentTurn(ws));
    wake?.();
  });
  return async () => {
    while (opened.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
    return opened.shift()!;
  };
}

async function openFlowpilot(page: Page) {
  await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
  await page.goto('/#/home');
  await page.getByTestId('home-create-new-main').click();
  await page.getByTestId('toolbar-flowpilot-toggle').click();
  await expect(page.getByRole('combobox', { name: 'Copilot model' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Set up Flowpilot' })).toBeHidden();
}

async function send(page: Page, prompt: string) {
  await page.getByRole('textbox').fill(prompt);
  await page.getByRole('textbox').press('Enter');
}

function nodes(page: Page): Locator {
  return page.locator('.react-flow__node');
}

function transformOf(node: Locator): Promise<string> {
  return node.evaluate((element) => (element as HTMLElement).style.transform);
}

// Mouse events, because Playwright's actionability checks would refuse the inert canvas.
async function dragBy(page: Page, node: Locator, dx: number, dy: number) {
  const box = await node.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('hasSeenWelcome_v1', 'true');
    localStorage.setItem('i18nextLng', 'en');
  });
});

test('a turn draws nodes live, locks the canvas, and undoes as a whole', async ({ page }) => {
  const nextTurn = await mockAgent(page);
  await openFlowpilot(page);
  await page.getByRole('combobox', { name: 'Copilot model' }).selectOption('model-b');
  await send(page, 'Draw an orders flow.');

  const turn = await nextTurn();
  const start = await turn.accept();
  expect(start).toMatchObject({
    prompt: 'Draw an orders flow.', model: 'model-b', history: [],
    canvas: { nodeCount: 0, edgeCount: 0, selectedIds: [] },
  });
  await expect(page.getByRole('textbox')).toHaveValue('');
  await expect(page.getByText('Working on it…')).toBeVisible();

  const edit = await turn.tool('edit_canvas', { ops: ORDERS_OPS });
  expect(edit).toMatchObject({ ok: true, result: { idMap: {} } });
  expect(await turn.tool('layout', { scope: 'all' })).toMatchObject({ ok: true });
  // The nodes are on the canvas while the turn is still running.
  await expect(nodes(page)).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('[data-agent-status="running"]')).toBeVisible();
  await expect(page.getByText('Edited the canvas')).toBeVisible();

  const lock = page.getByRole('status').filter({ hasText: 'Copilot is editing this page. Canvas editing is paused until it finishes.' });
  await expect(lock).toBeVisible();
  const web = nodes(page).filter({ hasText: 'Web Client' });
  await page.waitForTimeout(800);
  const position = await transformOf(web);
  await dragBy(page, web, 160, 80);
  expect(await transformOf(web)).toBe(position);
  await expect(nodes(page)).toHaveCount(2);

  turn.finish('Drew the orders flow.');
  await expect(page.locator('[data-agent-status="done"]')).toBeVisible();
  await expect(page.getByText('Drew the orders flow.', { exact: true })).toBeVisible();
  await expect(page.getByText('Steps: 2')).toBeVisible();
  await expect(lock).toBeHidden();

  await page.getByRole('button', { name: "Undo Copilot's changes" }).click();
  await expect(nodes(page)).toHaveCount(0);
  await expect(page.getByText("Copilot's changes were undone.")).toBeVisible();
  await expect(page.getByRole('button', { name: "Undo Copilot's changes" })).toHaveCount(0);
});

test('a turn ignores delete and undo for a node selected before it started', async ({ page }) => {
  const nextTurn = await mockAgent(page);
  await openFlowpilot(page);
  await send(page, 'Draw an orders flow.');
  const first = await nextTurn();
  await first.accept();
  expect(await first.tool('edit_canvas', { ops: ORDERS_OPS })).toMatchObject({ ok: true });
  first.finish('Drew the orders flow.');
  await expect(page.locator('[data-agent-status="done"]')).toBeVisible();

  const web = nodes(page).filter({ hasText: 'Web Client' });
  await web.click();
  await expect(web).toHaveClass(/\bselected\b/);
  await send(page, 'Add a database.');
  const second = await nextTurn();
  expect(await second.accept()).toMatchObject({ canvas: { nodeCount: 2, selectedIds: [expect.any(String)] } });
  const lock = page.getByRole('status').filter({ hasText: 'Copilot is editing this page.' });
  await expect(lock).toBeVisible();
  // Shortcuts are ignored while typing, so the keys go to the page instead of the prompt box.
  await page.getByRole('textbox').blur();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(nodes(page)).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  second.finish('Nothing to add yet.');
  await expect(lock).toBeHidden();
  // Once the turn ends, the same key deletes the selected node.
  await page.getByRole('textbox').blur();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(1);
});

test('a turn styles edges and nodes, and looks at the canvas as the user sees it', async ({ page }) => {
  const nextTurn = await mockAgent(page);
  await openFlowpilot(page);
  await send(page, 'Draw an orders flow and make it read well.');
  const turn = await nextTurn();
  await turn.accept();
  expect(await turn.tool('edit_canvas', { ops: ORDERS_OPS })).toMatchObject({ ok: true });

  const canvas = await turn.tool('get_canvas', { detail: 'full' });
  const [http] = (canvas.result as { edges: Array<{ id: string; style: Record<string, unknown> }> }).edges;
  expect(http.style).toMatchObject({ arrowheads: 'end', dashPattern: 'solid' });
  expect((canvas.result as { style: Record<string, unknown> }).style).toMatchObject({ appearance: 'light' });

  const styled = await turn.tool('edit_canvas', {
    ops: [
      { op: 'update_edge', id: http.id, data: { color: 'red', arrowheads: 'both', arrowStyle: 'open', path: 'straight', dashPattern: 'dashed', width: 3 } },
      { op: 'update_node', id: 'api', data: { color: '#4f46e5', colorMode: 'filled', fontWeight: 'bold' } },
    ],
  });
  expect(styled).toMatchObject({ ok: true });
  const path = page.locator('.react-flow__edge path.react-flow__edge-path').first();
  await expect(path).toHaveAttribute('marker-start', /url\(/);
  await expect(path).toHaveAttribute('marker-end', /url\(/);
  await expect(path).toHaveCSS('stroke-dasharray', '8px, 4px');
  await expect(path).toHaveCSS('stroke', 'rgb(248, 113, 113)');
  // A straight line has no curve segments.
  expect(await path.getAttribute('d')).not.toContain('C');

  const capture = await turn.tool('capture_canvas', {});
  expect(capture).toMatchObject({
    ok: true,
    result: { area: { position: expect.any(Object), size: expect.any(Object) }, image: { width: expect.any(Number) } },
    images: [{ mimeType: 'image/jpeg', data: expect.stringMatching(/^[A-Za-z0-9+/]{1000,}={0,2}$/) }],
  });
  expect(await turn.tool('focus_canvas', { nodeIds: ['api'], select: true })).toMatchObject({ ok: true });
  await expect(nodes(page).filter({ hasText: 'Orders API' })).toHaveClass(/\bselected\b/);
  await expect(page.getByText('Looked at the canvas')).toBeVisible();

  turn.finish('Styled the flow.');
  await expect(page.locator('[data-agent-status="done"]')).toBeVisible();
});

test('Stop ends the turn, rejects later tool calls, and keeps the work so far', async ({ page }) => {
  const nextTurn = await mockAgent(page);
  await openFlowpilot(page);
  await send(page, 'Draw an orders flow.');
  const turn = await nextTurn();
  expect(await turn.accept()).toMatchObject({ model: 'auto' });
  expect(await turn.tool('edit_canvas', { ops: ORDERS_OPS })).toMatchObject({ ok: true });
  expect(await turn.tool('layout', { scope: 'all' })).toMatchObject({ ok: true });
  await expect(nodes(page)).toHaveCount(2);

  await page.getByRole('status').getByRole('button', { name: 'Stop' }).click();
  await turn.receive('cancel');
  // A tool call already in flight when the user stopped must not touch the canvas.
  const late = await turn.tool('edit_canvas', { ops: [{ op: 'add_node', id: 'db', type: 'process', label: 'Orders DB' }] });
  expect(late).toMatchObject({ ok: false, resultType: 'rejected', error: 'The user stopped this turn.' });
  turn.finish('');

  await expect(page.locator('[data-agent-status="stopped"]')).toBeVisible();
  await expect(page.getByText('Stopped. Changes so far stay on the canvas.')).toBeVisible();
  await expect(nodes(page)).toHaveCount(2);
  await expect(page.getByText('Copilot is editing this page.', { exact: false })).toBeHidden();
  await expect(page.getByRole('button', { name: "Undo Copilot's changes" })).toBeEnabled();

  // With the lock released the same drag moves the node.
  const web = nodes(page).filter({ hasText: 'Web Client' });
  await page.waitForTimeout(800);
  const position = await transformOf(web);
  await dragBy(page, web, 160, 80);
  await expect.poll(() => transformOf(web)).not.toBe(position);
});

test('questions pause the turn until the user answers', async ({ page }) => {
  const nextTurn = await mockAgent(page);
  await openFlowpilot(page);
  await send(page, 'Design a web app on a cloud of your choice.');
  const turn = await nextTurn();
  await turn.accept();

  turn.send('step', { callId: 'ask-1', name: 'ask_user', status: 'started' });
  turn.send('question', { questionId: 'q1', question: 'Which cloud should I use?', choices: ['Azure', 'AWS'], allowFreeform: false });
  const first = page.locator('[data-question-status]').filter({ hasText: 'Which cloud should I use?' });
  await expect(first).toHaveAttribute('data-question-status', 'waiting');
  await expect(page.locator('[data-agent-status="waiting"]')).toBeVisible();
  await expect(page.getByText('Copilot is editing this page.', { exact: false })).toBeVisible();
  await first.getByRole('button', { name: 'Azure' }).click();
  expect(await turn.receive('answer')).toMatchObject({ questionId: 'q1', answer: 'Azure', wasFreeform: false });
  await expect(first).toContainText('Your answer: Azure');
  await expect(page.locator('[data-agent-status="running"]')).toBeVisible();
  turn.send('step', { callId: 'ask-1', name: 'ask_user', status: 'succeeded' });

  turn.send('question', { questionId: 'q2', question: 'What should the app be called?', allowFreeform: true });
  const second = page.locator('[data-question-status]').filter({ hasText: 'What should the app be called?' });
  await second.getByLabel('Type your answer').fill('Contoso Shop');
  await second.getByRole('button', { name: 'Send' }).click();
  expect(await turn.receive('answer')).toMatchObject({ questionId: 'q2', answer: 'Contoso Shop', wasFreeform: true });

  expect(await turn.tool('edit_canvas', {
    ops: [{ op: 'add_node', id: 'shop', type: 'process', label: 'Contoso Shop' }],
  })).toMatchObject({ ok: true });
  turn.finish('Drew Contoso Shop on Azure.');
  await expect(page.locator('[data-agent-status="done"]')).toBeVisible();
  await expect(nodes(page).filter({ hasText: 'Contoso Shop' })).toBeVisible();
  await expect(second).toContainText('Your answer: Contoso Shop');
});

test('declining a large removal keeps the nodes and tells the agent', async ({ page }) => {
  const nextTurn = await mockAgent(page);
  await openFlowpilot(page);
  await send(page, 'Draw an orders flow with storage.');
  const first = await nextTurn();
  await first.accept();
  expect(await first.tool('edit_canvas', {
    ops: [
      ...ORDERS_OPS,
      { op: 'add_node', id: 'db', type: 'process', label: 'Orders DB' },
      { op: 'add_node', id: 'queue', type: 'process', label: 'Order Queue' },
    ],
  })).toMatchObject({ ok: true });
  first.finish('Drew the orders flow.');
  await expect(page.locator('[data-agent-status="done"]')).toBeVisible();
  await expect(nodes(page)).toHaveCount(4);

  await send(page, 'Start over with just the API.');
  const second = await nextTurn();
  const start = await second.accept();
  expect(start).toMatchObject({ prompt: 'Start over with just the API.', canvas: { nodeCount: 4, edgeCount: 1 } });
  expect(JSON.stringify(start.history)).toContain('Drew the orders flow.\\n[Canvas changes this turn:');

  const removal = second.tool('edit_canvas', {
    ops: ['web', 'db', 'queue'].map((id) => ({ op: 'remove_node', id })),
  });
  const card = page.locator('[data-question-status]').filter({ hasText: 'Copilot wants to remove these nodes from before this turn:' });
  await expect(card).toContainText('Web Client, Orders DB, Order Queue');
  await expect(nodes(page)).toHaveCount(4);
  await card.getByRole('button', { name: 'Keep' }).click();
  const result = await removal;
  // A plain failure, so the agent carries on without the removal.
  expect(result).toMatchObject({ ok: false });
  expect(result).not.toHaveProperty('resultType');
  expect(result.error).toContain('User declined removing');
  expect(result.error).toContain('Nothing was changed.');
  await expect(card).toContainText('Kept these nodes');
  second.finish('Kept your diagram as it is.');
  await expect(page.locator('[data-agent-status="done"]').last()).toBeVisible();
  await expect(nodes(page)).toHaveCount(4);
});

test('live Copilot draws a diagram, edits it in a later turn, and undoes that turn', async ({ page }, testInfo) => {
  test.skip(process.env.FLOWPILOT_LIVE_COPILOT !== '1', 'Opt-in: uses the signed-in Copilot quota.');
  test.setTimeout(420_000);
  const response = await page.request.get('/api/copilot/status', { headers: { 'x-flowpilot-client': '1' }, timeout: 45_000 });
  expect(response.ok()).toBe(true);
  const status: typeof STATUS = await response.json();
  expect(status.authenticated).toBe(true);
  const model = status.models.find((entry) => entry.id === 'gpt-5-mini') ?? status.models.find((entry) => entry.id !== 'auto' && (entry.multiplier ?? 1) <= 1);
  expect(model).toBeTruthy();
  await page.goto('/#/home');
  await page.getByTestId('home-create-new-main').click();
  await page.getByTestId('toolbar-flowpilot-toggle').click();
  await page.getByRole('combobox', { name: 'Copilot model' }).selectOption(model!.id);
  await send(page, 'Create exactly two process nodes: Orders API connected to Redis. No other nodes. Do not ask questions.');
  await expect(page.locator('[data-agent-status]').last()).toHaveAttribute('data-agent-status', 'done', { timeout: 180_000 });
  await expect(nodes(page)).toHaveCount(2);
  await send(page, 'Rename Redis to Orders Cache. Keep everything else unchanged.');
  await expect(nodes(page).filter({ hasText: 'Orders Cache' })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('[data-agent-status]').last()).toHaveAttribute('data-agent-status', 'done', { timeout: 180_000 });
  await page.getByRole('button', { name: "Undo Copilot's changes" }).click();
  await expect(nodes(page).filter({ hasText: 'Redis' })).toBeVisible();
  await expect(nodes(page)).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('flowpilot-live-agent.png') });
});
