import { openProject } from './projectHelpers';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function configure(page: Page, model = 'research-test-model', effort = 'high') {
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByLabel('你的 API key').fill('sk-mocked-session-only');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await page.getByLabel('選擇模型').fill(model);
  await page.getByLabel('推理程度').selectOption(effort);
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
test('whole-document summary resumes cached chunks after failure and preserves the PDF', async ({ page }) => {
  const sourcePdf = await PDFDocument.load(await readFile('public/sample.pdf'));
  const longerPdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) for (const p of await longerPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())) longerPdf.addPage(p);
  await openProject(page);
  await page.getByTestId('pdf-input').setInputFiles({ name: 'long-paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await longerPdf.save()) });
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await configure(page);
  let calls = 0; let failed = false; const sources: string[] = []; const settings: { model: string; reasoning: { effort: string } }[] = [];
  await page.route('https://api.openai.com/v1/responses', route => {
    const body = route.request().postDataJSON(); calls++; sources.push(body.input); settings.push({ model: body.model, reasoning: body.reasoning });
    if (calls === 2 && !failed) { failed = true; return route.fulfill({ status: 429, json: { error: { message: 'quota' } } }); }
    return route.fulfill({ json: { status: 'completed', output: [{ content: [{ type: 'output_text', text: '研究背景\n研究閱讀的實踐 [p. 1–3]\n方法\n以來源為基礎整理。\n限制\n圖表與公式需自行核對。' }] }], usage: { total_tokens: 90 } } });
  });
  await page.getByRole('button', { name: '全文摘要', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('只傳送目前這篇 PDF 的擷取文字');
  await page.getByRole('button', { name: '同意傳送並生成' }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.locator('.global-ai-progress')).toHaveCount(0);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await page.reload();
  await configure(page, 'different-test-model', 'low');
  await page.getByRole('button', { name: '全文摘要', exact: true }).click();
  await expect(page.locator('.resume-notice')).toContainText('已完成 1 /');
  await expect(page.getByRole('dialog')).toContainText('research-test-model · 推理：高');
  await page.getByRole('button', { name: '同意傳送並接續' }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-card')).toContainText('文獻總覽');
  await expect(page.locator('.note-content')).toContainText('自行核對');
  expect(sources.filter(s => s === sources[0])).toHaveLength(1);
  expect(calls).toBeGreaterThanOrEqual(4);
  expect(settings.every(s => s.model === 'research-test-model' && s.reasoning.effort === 'high')).toBe(true);
  await expect(page.locator('.pdf-page[data-page-index="0"] .textLayer span').first()).toBeVisible();
});
test('offline reload retains local papers and notes with the installed service worker', async ({ page, context }) => {
  await openProject(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: '先試讀一篇範例' }).click();
  await expect(page.locator('.pdf-page[data-page-index="0"] .textLayer span').first()).toBeVisible();
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.pdf-page[data-page-index="0"] .textLayer span').first()).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await context.setOffline(false);
});
test('20-page double-column PDF renders lazily, supports page navigation, and scanned pages stay readable', async ({ page }) => {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 20; i++) { const p = pdf.addPage([612, 792]); for (const x of [48, 320]) { p.drawText(`Research page ${i}`, { x, y: 730, font, size: 16 }); for (let line = 0; line < 25; line++) p.drawText(`Column evidence ${i}, line ${line + 1}.`, { x, y: 690 - line * 20, font, size: 11 }); } }
  await openProject(page);
  await page.getByTestId('pdf-input').setInputFiles({ name: 'twenty-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.pdf-page')).toHaveCount(20);
  await expect(page.locator('.pdf-page[data-page-index="0"] .textLayer span').first()).toBeVisible();
  expect(await page.locator('.pdf-page canvas').count()).toBeLessThan(8);
  await page.getByRole('textbox', { name: '頁碼', exact: true }).fill('15'); await page.getByRole('textbox', { name: '頁碼', exact: true }).press('Enter');
  await expect(page.locator('.pdf-page[data-page-index="14"] .textLayer span').first()).toBeVisible();
  await page.getByRole('button', { name: '搜尋 PDF', exact: true }).click();
  await page.getByRole('textbox', { name: 'PDF 搜尋文字' }).fill('Research page 19');
  await expect(page.getByRole('textbox', { name: '頁碼', exact: true })).toHaveValue('19');
  const scan = await PDFDocument.create(); scan.addPage([612, 792]).drawRectangle({ x: 45, y: 100, width: 520, height: 600, color: rgb(.9, .91, .88) });
  await page.getByTestId('pdf-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await scan.save()) });
  await expect(page.locator('.ocr-notice')).toContainText('需要 OCR');
  await expect(page.locator('.pdf-page canvas')).toHaveCount(1);
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mobile-view-tabs')).toBeVisible();
  await page.getByRole('button', { name: '知識白板 (0)', exact: true }).click();
  await expect(page.locator('.board-pane')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-workspace.png' });
});
