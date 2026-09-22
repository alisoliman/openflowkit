import { expect, test, type Page } from '@playwright/test';

const STATUS = {
  runtime: 'github-copilot-sdk',
  authenticated: true,
  login: 'diagram-user',
  models: [{ id: 'account-model', name: 'Account model', vision: true, multiplier: 1 }],
};
const DSL = 'flow: "Copilot draft"\ndirection: LR\n[process] client: Client\n[process] api: API\nclient -> api';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('hasSeenWelcome_v1', 'true');
    localStorage.setItem('i18nextLng', 'en');
  });
});

async function openFlowpilot(page: Page) {
  await page.goto('/#/home');
  await page.getByTestId('home-create-new-main').click();
  await expect(page.getByTestId('flow-page-tab').first()).toBeVisible();
  const prompt = page.getByPlaceholder('Describe the diagram you want to create from scratch...');
  if (!await prompt.isVisible()) await page.getByTestId('toolbar-flowpilot-toggle').click();
  await expect(prompt).toBeVisible();
  return prompt;
}

test('Copilot generation keeps preview approval, edit context, and node positions', async ({ page }) => {
  await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
  const requests: Array<{ prompt: string; model: string; history: unknown[] }> = [];
  let responseDsl = DSL;
  await page.route('**/api/copilot/chat', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    expect(body).not.toHaveProperty('apiKey');
    expect(body.systemInstruction).toContain('OpenFlow');
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'delta', text: responseDsl })}\n${JSON.stringify({ type: 'done', text: responseDsl })}\n`,
    });
  });
  const prompt = await openFlowpilot(page);
  await expect(page.getByRole('button', { name: 'Set up Flowpilot' })).toBeHidden();
  await prompt.fill('Create a simple flowchart with Client connected to API.');
  await page.getByLabel('Generate with Flowpilot', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply to canvas' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(requests[0].model).toBe('auto');

  // Initial imports have a delayed measured-layout pass and an 800ms fit animation.
  await page.waitForTimeout(1000);
  const client = page.locator('.react-flow__node').filter({ hasText: 'Client' });
  const api = page.locator('.react-flow__node').filter({ hasText: 'API' });
  const clientId = await client.getAttribute('data-id');
  const apiId = await api.getAttribute('data-id');
  const position = await api.evaluate((element) => element.style.transform);
  responseDsl = `flow: "Updated"\ndirection: LR\n[process] ${clientId}: Client\n[process] ${apiId}: Gateway\n${clientId} -> ${apiId}`;
  await page.getByRole('button', { name: 'Edit current', exact: true }).click();
  await page.getByRole('textbox').fill('Change the API label to Gateway in the existing diagram.');
  await page.getByLabel('Generate with Flowpilot', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible();
  expect(requests[1].prompt).toContain('CURRENT DIAGRAM');
  expect(requests[1].history.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Apply to canvas' }).click();
  const gateway = page.locator('.react-flow__node').filter({ hasText: 'Gateway' });
  await expect(gateway).toBeVisible();
  expect(await gateway.getAttribute('data-id')).toBe(apiId);
  expect(await gateway.evaluate((element) => element.style.transform)).toBe(position);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('Copilot repairs the reported OAuth connector error before offering a preview', async ({ page }) => {
  await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
  const diagram = [
    'flow: Authentication',
    'direction: TB',
    '[system] provider: OAuth Provider',
    '[system] auth_svc: Authentication Service',
    'provider .. auth_svc',
  ].join('\n');
  let requests = 0;
  await page.route('**/api/copilot/chat', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.systemInstruction).toContain('| `..>` | Async, error, optional |');
    requests++;
    if (requests === 2) {
      expect(body.prompt).toContain('PREVIOUS ATTEMPT FAILED TO PARSE');
      expect(body.prompt).toContain('source ..> target');
      expect(body.prompt).toContain(diagram);
    }
    const text = requests === 1 ? diagram : diagram.replace('provider .. auth_svc', 'provider ..>|callback| auth_svc');
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'delta', text })}\n${JSON.stringify({ type: 'done', text })}\n`,
    });
  });
  const prompt = await openFlowpilot(page);
  await expect(page.getByRole('button', { name: 'Set up Flowpilot' })).toBeHidden();
  await prompt.fill('Generate a user authentication flow showing login, registration, password reset, OAuth, and session management');
  await page.getByLabel('Generate with Flowpilot', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible();
  await expect(page.getByText('Last request failed', { exact: true })).toBeHidden();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  expect(requests).toBe(2);
  await page.getByRole('button', { name: 'Apply to canvas' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Authentication Service' })).toBeVisible();
});

test('Copilot setup has no key field and recovers after CLI login on desktop and mobile', async ({ page }, testInfo) => {
  let authenticated = false;
  await page.route('**/api/copilot/status', (route) => route.fulfill({
    json: { ...STATUS, authenticated, models: authenticated ? STATUS.models : [] },
  }));
  await openFlowpilot(page);
  await page.getByRole('button', { name: 'Set up Flowpilot' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('gh copilot login', { exact: true })).toBeVisible();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  const logo = dialog.getByRole('button', { name: 'Select GitHub Copilot as AI provider' }).locator('[aria-hidden="true"]');
  expect(await logo.evaluate((element) => getComputedStyle(element).maskImage)).not.toBe('none');
  await expect(dialog.getByRole('status')).toContainText('Copilot is not connected');
  authenticated = true;
  await dialog.getByRole('button', { name: 'Check connection' }).click();
  await expect(dialog.getByRole('status')).toContainText('Connected as diagram-user');
  await dialog.getByRole('combobox', { name: 'Model' }).selectOption('account-model');
  await expect(dialog.getByRole('combobox', { name: 'Model' })).toHaveValue('account-model');
  await page.screenshot({ path: testInfo.outputPath('copilot-settings-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByText('gh copilot login', { exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('copilot-settings-mobile.png') });
});

test('truncated Copilot output cannot be applied to the canvas', async ({ page }) => {
  await page.route('**/api/copilot/status', (route) => route.fulfill({ json: STATUS }));
  let requests = 0;
  await page.route('**/api/copilot/chat', async (route) => {
    requests++;
    await route.fulfill({
      contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'delta', text: DSL })}\n`,
    });
  });
  const prompt = await openFlowpilot(page);
  await expect(page.getByRole('button', { name: 'Set up Flowpilot' })).toBeHidden();
  await prompt.fill('Create a client and API diagram.');
  await page.getByLabel('Generate with Flowpilot', { exact: true }).click();
  await expect(page.getByText('Copilot disconnected before completing the response. No changes were applied; try again.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  expect(requests).toBe(1);
});

test('hosted GitHub connection is actionable and responsive without local CLI instructions', async ({ page }, testInfo) => {
  let signedIn = false;
  await page.route('**/api/copilot/status', (route) => route.fulfill({
    json: { ...STATUS, mode: 'hosted', signedIn, authenticated: signedIn, models: signedIn ? STATUS.models : [] },
  }));
  await page.route('**/api/copilot/auth/start', (route) => route.fulfill({
    status: 503, json: { code: 'runtime_unavailable', message: 'GitHub sign-in is temporarily unavailable. Please retry.' },
  }));
  await page.route('**/api/copilot/auth/logout', (route) => {
    signedIn = false;
    return route.fulfill({ json: { disconnected: true } });
  });
  await openFlowpilot(page);
  await expect(page.getByRole('button', { name: 'Connect GitHub', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set up Flowpilot' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('gh copilot login', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('GitHub sign-in is temporarily unavailable');
  await expect(dialog.getByRole('button', { name: 'Connect GitHub', exact: true })).toBeEnabled();
  signedIn = true;
  await dialog.getByRole('button', { name: 'Check connection' }).click();
  await expect(dialog.getByRole('status')).toContainText('GitHub connected as diagram-user');
  await expect(dialog.getByRole('combobox', { name: 'Model' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('hosted-copilot-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Disconnect GitHub' })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('hosted-copilot-mobile.png') });
  await dialog.getByRole('button', { name: 'Disconnect GitHub' }).click();
  await expect(dialog.getByRole('button', { name: 'Connect GitHub', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Model' })).toBeDisabled();
});

test('live SDK generates a diagram using the signed-in Copilot account', async ({ page }, testInfo) => {
  test.skip(process.env.FLOWPILOT_LIVE_COPILOT !== '1', 'Opt-in: consumes the signed-in account Copilot quota.');
  test.setTimeout(210_000);
  page.setDefaultTimeout(15_000);
  const status = await page.request.get('/api/copilot/status', { headers: { 'x-flowpilot-client': '1' }, timeout: 45_000 });
  expect(status.ok()).toBe(true);
  expect(await status.json()).toMatchObject({ runtime: 'github-copilot-sdk', authenticated: true });
  const prompt = await openFlowpilot(page);
  await expect(page.getByRole('button', { name: 'Set up Flowpilot' })).toBeHidden({ timeout: 45_000 });
  await prompt.fill('Create a simple flowchart with exactly two process nodes labeled Client and API, connected Client to API. Do not add any other nodes.');
  await page.getByLabel('Generate with Flowpilot', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to canvas' })).toBeVisible({ timeout: 180_000 });
  await page.getByRole('button', { name: 'Apply to canvas' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Client' })).toBeVisible();
  await expect(page.locator('.react-flow__node').filter({ hasText: 'API' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('copilot-live-diagram.png') });
});
