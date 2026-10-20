import { openProject } from './projectHelpers';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function loadPaper(page: Page) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const paper = pdf.addPage([612, 792]);
    paper.drawText(`Research evidence on page ${i}`, { x: 48, y: 730, font, size: 16 });
    for (let line = 0; line < 25; line++) paper.drawText(`Reading evidence, line ${line + 1}.`, { x: 48, y: 690 - line * 20, font, size: 12 });
  }
  await openProject(page);
  await page.getByTestId('pdf-input').setInputFiles({ name: 'reader-controls.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
}

async function selectLine(page: Page) {
  await page.locator('.pdf-page .textLayer span').first().evaluate(span => {
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}

test('hand mode pans in both directions, releases outside the PDF, and keeps highlights intact', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loadPaper(page);
  await selectLine(page);
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.pdf-highlight').first()).toBeVisible();
  const segments = await page.locator('.pdf-highlight').count();
  await page.getByRole('button', { name: '放大 PDF', exact: true }).click();
  await page.getByRole('button', { name: '放大 PDF', exact: true }).click();
  await expect(page.locator('.zoom-value')).toHaveText('150%');
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await page.getByRole('button', { name: '手掌模式', exact: true }).click();
  await expect(page.getByRole('button', { name: '手掌模式', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const scroll = page.locator('.pdf-scroll');
  await expect(scroll).toHaveCSS('cursor', 'grab');
  const mark = (await page.locator('.pdf-highlight').first().boundingBox())!;
  const x = mark.x + mark.width / 2; const y = mark.y + mark.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await expect(scroll).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(x - 120, y - 80, { steps: 6 });
  expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThanOrEqual(110);
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(70);
  const box = (await scroll.boundingBox())!;
  await page.mouse.move(box.x + box.width + 30, box.y + 60, { steps: 4 });
  await page.mouse.up();
  await expect(scroll).toHaveCSS('cursor', 'grab');
  const position = await scroll.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }));
  await page.mouse.move(box.x + 100, box.y + 300);
  expect(await scroll.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual(position);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.pdf-highlight')).toHaveCount(segments);
  await page.getByRole('button', { name: '選字模式', exact: true }).click();
  await expect(scroll).not.toHaveCSS('cursor', 'grab');
  await selectLine(page);
  expect(await page.evaluate(() => getSelection()?.toString())).toContain('Research evidence');
  await expect(page.locator('.note-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('text selection is gray in both text modes and saved highlights remain yellow', async ({ page }) => {
  await loadPaper(page);
  const text = page.locator('.pdf-page .textLayer span').first();
  for (const mode of ['選字模式', '螢光筆模式']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    expect(await text.evaluate(element => getComputedStyle(element, '::selection').backgroundColor)).toBe('rgba(128, 128, 128, 0.333)');
    if (mode === '選字模式') {
      await selectLine(page);
      await expect(page.locator('.note-card')).toHaveCount(0);
      await page.screenshot({ path: 'test-results/pdf-gray-selection.png' });
    }
  }
  await selectLine(page);
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.pdf-highlight').first()).toHaveCSS('background-color', 'rgb(230, 199, 94)');
});

test('top page controls stay usable on desktop and mobile with the reading area reaching the bottom', async ({ page }) => {
  await loadPaper(page);
  const controls = page.getByRole('group', { name: 'PDF 翻頁', exact: true });
  await expect(page.locator('.pdf-toolbar').getByRole('group', { name: 'PDF 翻頁', exact: true })).toBeVisible();
  await expect(page.locator('.pdf-pane > .pane-heading')).toHaveCount(0);
  await expect(page.locator('.pdf-bottom, .app-footer')).toHaveCount(0);
  await expect(controls.getByRole('button', { name: '上一頁', exact: true })).toBeDisabled();
  await controls.getByRole('button', { name: '下一頁', exact: true }).click();
  await expect(controls.getByLabel('頁碼', { exact: true })).toHaveValue('2');
  await controls.getByLabel('頁碼', { exact: true }).fill('3');
  await controls.getByLabel('頁碼', { exact: true }).press('Enter');
  await expect(controls.getByRole('button', { name: '下一頁', exact: true })).toBeDisabled();
  await controls.getByRole('button', { name: '上一頁', exact: true }).click();
  await expect(controls.getByLabel('頁碼', { exact: true })).toHaveValue('2');
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: '使用指南', exact: true })).toBeVisible();
    const area = (await page.locator('.pdf-scroll').boundingBox())!;
    expect(area.y + area.height).toBe(844);
    const toolbar = (await page.locator('.pdf-toolbar').boundingBox())!;
    expect(area.y).toBe(toolbar.y + toolbar.height);
    const nav = (await controls.boundingBox())!;
    const pane = (await page.locator('.pdf-pane').boundingBox())!;
    expect(nav.x).toBeGreaterThanOrEqual(pane.x);
    expect(nav.x + nav.width).toBeLessThanOrEqual(pane.x + pane.width);
    await controls.getByLabel('頁碼', { exact: true }).fill('2');
    await controls.getByLabel('頁碼', { exact: true }).press('Enter');
    await expect(page.locator('.pdf-page[data-page-index="1"] .textLayer span').first()).toBeVisible();
    await controls.getByRole('button', { name: '上一頁', exact: true }).click();
    await expect(controls.getByLabel('頁碼', { exact: true })).toHaveValue('1');
    await expect.poll(() => page.locator('.pdf-page').first().evaluate(element => {
      const scroll = element.parentElement!;
      const sheet = element.getBoundingClientRect(); const viewport = scroll.getBoundingClientRect();
      return Math.max(Math.abs(sheet.x - viewport.x), Math.abs(sheet.y - viewport.y), Math.abs(sheet.width - scroll.clientWidth));
    })).toBeLessThan(1);
    await controls.getByRole('button', { name: '下一頁', exact: true }).click();
    await expect(controls.getByLabel('頁碼', { exact: true })).toHaveValue('2');
    await page.screenshot({ path: `test-results/pdf-controls-${width}.png` });
  }
});
