import { expect, type Page } from '@playwright/test';

export async function openProject(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '我的專案', exact: true })).toBeVisible();
  const existing = page.locator('.project-card-main').first();
  if (await existing.count()) await existing.click();
  else {
    await page.getByRole('button', { name: '建立專案', exact: true }).click();
    await page.getByLabel('專案名稱', { exact: true }).fill('測試研究');
    await page.getByRole('button', { name: '建立並進入', exact: true }).click();
  }
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.project-transition-overlay')).toHaveCount(0);
}
