import { expect, test } from '@playwright/test';
import { loadEnv } from 'vite';

const configuredAppUrl = loadEnv('development', process.cwd(), 'VITE_APP_URL').VITE_APP_URL?.trim();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenWelcome_v1', 'true');
    localStorage.setItem('i18nextLng', 'en');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          localStorage.setItem('mcp-test-clipboard', value);
        },
      },
    });
  });
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`Copilot-first setup works on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/home');
    await page.getByTestId('sidebar-mcp').click();
    const appUrl = (configuredAppUrl || new URL(page.url()).origin).replace(/\/+$/, '');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Diagram with GitHub Copilot' })
    ).toBeVisible();
    const app = page.getByRole('radio', { name: 'GitHub Copilot App', exact: true });
    const cli = page.getByRole('radio', { name: 'GitHub Copilot CLI', exact: true });
    await expect(app).toBeChecked();
    await expect(page.getByText(/open Customize → MCP/)).toBeVisible();
    expect(
      await page
        .getByTestId('mcp-page')
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`mcp-${viewport.name}-app.png`),
      fullPage: true,
      animations: 'disabled',
    });

    await app.focus();
    await app.press('ArrowRight');
    await expect(cli).toBeChecked();
    await expect(page.getByRole('heading', { name: 'GitHub Copilot CLI setup' })).toBeVisible();
    await page.getByRole('button', { name: 'Copy setup command', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('mcp-test-clipboard'))).toBe(
      `copilot mcp add openflowkit --env "OPENFLOWKIT_APP_URL=${appUrl}" -- npx -y @vrun-design/openflowkit-mcp`
    );
    await page.getByText('JSON configuration and setup prompt', { exact: true }).click();
    await page.getByRole('button', { name: 'Copy MCP config', exact: true }).click();
    const copilotConfig = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('mcp-test-clipboard')!)
    );
    expect(copilotConfig.mcpServers.openflowkit).toMatchObject({
      type: 'local',
      tools: ['*'],
      env: { OPENFLOWKIT_APP_URL: appUrl },
    });

    for (const name of ['Claude Code', 'Claude Desktop', 'Cursor', 'Windsurf']) {
      await page.getByRole('radio', { name, exact: true }).check();
      await expect(page.getByRole('heading', { name: `${name} setup`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Copy MCP config', exact: true }).click();
      const config = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('mcp-test-clipboard')!)
      );
      expect(config.mcpServers.openflowkit.command).toBe('npx');
      expect(config.mcpServers.openflowkit).not.toHaveProperty('tools');
      expect(
        await page
          .getByTestId('mcp-page')
          .evaluate((element) => element.scrollWidth <= element.clientWidth)
      ).toBe(true);
    }

    await app.check();
    await expect(app).toBeChecked();
    await page.getByRole('button', { name: 'Copy connection test prompt' }).click();
    expect(await page.evaluate(() => localStorage.getItem('mcp-test-clipboard'))).toContain(
      'server_info'
    );
  });
}

test('localized MCP setup fits a narrow dark viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => localStorage.setItem('i18nextLng', 'de'));
  await page.goto('/#/home');
  await page.getByTestId('sidebar-mcp').click();
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  await expect(
    page.getByRole('heading', { level: 1, name: 'Diagramme mit GitHub Copilot' })
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: 'GitHub Copilot App', exact: true })).toBeChecked();
  expect(
    await page
      .getByTestId('mcp-page')
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('mcp-mobile-dark-de.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
