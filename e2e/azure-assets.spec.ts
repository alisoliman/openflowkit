import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
]) {
  test(`current Azure icons are labeled and insertable on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('hasSeenWelcome_v1', 'true'));
    await page.goto('/#/home');
    await page.getByTestId('home-create-new-main').click();
    await expect(page.locator('.react-flow')).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: /search command bar actions/i }).fill('assets');
    await page.getByRole('option', { name: /Assets/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Command bar' });
    const azureTab = dialog.getByRole('tab', { name: /AZURE/i });
    await azureTab.click();
    await expect(azureTab).toContainText('736');

    const search = dialog.getByPlaceholder('Search developer logos, AWS services, Azure diagrams, CNCF assets, icons...');
    await search.fill('foundry');
    for (const label of ['Foundry Agent Service', 'Foundry Models', 'Foundry Project', 'Microsoft Foundry']) {
      const tile = dialog.getByRole('button', { name: label, exact: true });
      await expect(tile.getByText(label, { exact: true })).toBeVisible();
      await expect(tile.locator('img')).toBeVisible();
      await expect.poll(() => tile.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }

    const layout = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const labels = [...element.querySelectorAll('button[aria-label] span')];
      return {
        left: bounds.left,
        right: bounds.right,
        viewportWidth: window.innerWidth,
        overflowingLabels: labels.filter((label) => label.scrollWidth > label.clientWidth).map((label) => label.textContent),
      };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.overflowingLabels).toEqual([]);
    await page.mouse.move(0, 0);
    await dialog.screenshot({ path: testInfo.outputPath(`azure-foundry-${viewport.name}.png`) });

    await search.fill('documentdb');
    await dialog.getByRole('button', { name: 'Azure DocumentDB', exact: true }).click();
    await expect(dialog).toBeHidden();
    const node = page.locator('.react-flow__node').filter({ hasText: 'Azure DocumentDB' });
    await expect(node).toHaveCount(1);
    await expect(node.getByText('Azure DocumentDB', { exact: true })).toBeVisible();
    await expect.poll(() => node.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  });
}

test('keeps the existing small-screen editor guidance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('hasSeenWelcome_v1', 'true'));
  await page.goto('/#/home');
  await page.getByTestId('home-create-new-main').click();

  await expect(page.getByRole('heading', { name: 'Made for big screens' })).toBeVisible();
  await expect(page.locator('.react-flow')).toBeHidden();
});
