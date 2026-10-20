import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

async function loadFixture(page: Page) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 2; n++) {
    const p = pdf.addPage([612, 792]);
    for (const [x, side] of [[48, 'Left'], [330, 'Right']] as const) {
      p.drawText(side + ' page ' + n + ' first passage with', { x, y: 700, size: 11, font });
      p.drawText('evidence in the same paragraph.', { x, y: 685, size: 11, font });
      p.drawText(side + ' page ' + n + ' second passage with', { x, y: 640, size: 11, font });
      p.drawText('more evidence and limitations.', { x, y: 625, size: 11, font });
    }
  }
  await page.goto('./');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'columns.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
}
async function configure(page: Page) {
  const settings = page.getByRole('dialog', { name: '連接你的 AI', exact: true });
  if (!await settings.isVisible()) await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await settings.getByLabel('你的 API key').fill('sk-test-translation-never-export');
  await settings.getByRole('button', { name: '使用此金鑰', exact: true }).click();
  await settings.getByLabel('選擇模型').fill('test-translation');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
}
async function manager(page: Page) {
  await page.getByRole('button', { name: '逐段翻譯', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'PDF 逐段翻譯', exact: true });
  await expect(dialog).toContainText('可翻譯 8 段');
  return dialog;
}
async function saved(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const request = indexedDB.open('PaperReader');
    const db: IDBDatabase = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    try {
      const tx = db.transaction('workspacesV2'); const read = tx.objectStore('workspacesV2').get('default');
      return await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
    } finally { db.close(); }
  });
}
function result(text: string) { return { status: 'completed', output: [{ content: [{ type: 'output_text', text }] }], usage: { total_tokens: 25 } }; }

test('translates page/column paragraphs, pure hover popup, keyboard, rotation and complete pack restore', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const requests: any[] = [];
  await page.route('https://api.openai.com/v1/**', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: result('這是第' + requests.length + '段的完整繁體中文譯文。') });
  });
  await loadFixture(page); await configure(page);
  const dialog = await manager(page);
  expect(requests).toHaveLength(0);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect(dialog).toContainText('已保存 8 段');
  expect(requests).toHaveLength(8);
  for (const r of requests) { expect(r.store).toBe(false); expect(r.input).not.toContain('sk-test'); }
  const data = await saved(page);
  expect(data.pdfParagraphs).toHaveLength(8); expect(data.notes).toHaveLength(0);
  expect(data.pdfParagraphs.map((p: any) => [p.pageIndex, p.columnId])).toEqual([[0,0],[0,0],[0,1],[0,1],[1,0],[1,0],[1,1],[1,1]]);
  for (const p of data.pdfParagraphs) {
    expect(p.itemIndices).toHaveLength(2);
    expect(p.normalizedText).not.toMatch(/Left.*Right/);
  }
  await dialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  const marker = page.locator('.pdf-translation-marker').first();
  await marker.hover();
  const popup = page.getByRole('region', { name: '中文譯文', exact: true });
  await expect(popup).toHaveText('這是第1段的完整繁體中文譯文。');
  await expect(popup.locator('button,h1,h2,h3')).toHaveCount(0);
  expect(await marker.getAttribute('title')).toBeNull();
  await popup.hover(); await expect(popup).toBeVisible();
  await page.screenshot({ path: 'test-results/pdf-translation-hover.png' });
  await marker.click(); await page.mouse.move(1000, 800); await expect(popup).toBeVisible();
  await page.locator('.pdf-translation-marker').nth(1).hover();
  await expect(popup).toHaveText('這是第1段的完整繁體中文譯文。');
  await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0);
  await marker.blur(); await marker.focus(); await expect(popup).toBeVisible();
  await marker.press('Tab'); await expect(popup).toBeFocused();
  await page.keyboard.press('Escape'); await expect(marker).toBeFocused();
  await page.getByRole('button', { name: '旋轉 PDF', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rotation', '90');
  await expect(marker).toBeVisible(); await marker.click(); await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  expect(requests).toHaveLength(8);
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /完整研究封裝/ }).click();
  const download = await downloading; const bytes = await readFile((await download.path())!);
  const zip = await JSZip.loadAsync(bytes);
  const packed = JSON.parse(await zip.file('annotations.json')!.async('string'));
  expect(packed.pdfTranslations).toHaveLength(8); expect(packed.pdfTranslationJobs[0].status).toBe('complete');
  expect(JSON.stringify(packed)).not.toContain('sk-test');
  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: '文獻庫', exact: true }).click();
  await page.getByRole('button', { name: '清除本機資料', exact: true }).click();
  await page.getByTestId('restore-input').setInputFiles({ name: 'translations.researchpack', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('.pdf-translation-marker').first()).toBeVisible();
  expect((await saved(page)).pdfTranslations).toHaveLength(8);
  await page.reload(); await expect(page.locator('.pdf-translation-marker').first()).toBeVisible();
  await page.locator('.pdf-translation-marker').first().hover(); await expect(popup).toBeVisible();
  expect(requests).toHaveLength(8); expect(errors).toEqual([]);
});

test('pause/reload/resume skips saved passages; failed replacement retains readable translations', async ({ page }) => {
  let count = 0; let hold = true; let fail = false;
  await page.route('https://api.openai.com/v1/**', async route => {
    count++;
    if (hold && count === 2) { await new Promise(r => setTimeout(r, 1500)); }
    try { await route.fulfill(fail ? { status: 429, json: { error: { message: 'quota' } } } : { json: result('已保存的中文譯文' + count) }); } catch { /* A paused fetch is aborted. */ }
  });
  await loadFixture(page); await configure(page);
  let dialog = await manager(page);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect.poll(() => count).toBe(2);
  await dialog.getByRole('button', { name: '暫停', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '接續未完成翻譯', exact: true })).toBeVisible();
  expect((await saved(page)).pdfTranslations).toHaveLength(1);
  await page.reload(); dialog = await manager(page);
  await dialog.getByRole('button', { name: '接續未完成翻譯', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '連接你的 AI', exact: true })).toBeVisible();
  await configure(page); hold = false; dialog = await manager(page);
  await dialog.getByRole('button', { name: '接續未完成翻譯', exact: true }).click();
  await expect(dialog).toContainText('已保存 8 段');
  expect(count).toBe(9);
  fail = true; page.on('dialog', d => d.accept());
  await dialog.getByRole('button', { name: '重新翻譯全部', exact: true }).click();
  await expect(dialog).toContainText('429');
  expect(count).toBe(10); expect((await saved(page)).pdfTranslations).toHaveLength(8);
  await dialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  await page.locator('.pdf-translation-marker').first().hover();
  await expect(page.getByRole('region', { name: '中文譯文', exact: true })).toHaveText('已保存的中文譯文1');
});

test('standalone readers use their own key, block duplicate translation and recover after the owner closes', async ({ page, context }) => {
  let count = 0; let hold = true;
  await context.route('https://api.openai.com/v1/**', async route => {
    count++;
    if (hold && count === 2) await new Promise(r => setTimeout(r, 1800));
    try { await route.fulfill({ json: result('跨視窗中文譯文' + count) }); } catch { /* Owner closed. */ }
  });
  await loadFixture(page); await configure(page);
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: '在新視窗閱讀', exact: true }).click();
  const owner = await opened;
  await expect(owner.locator('.textLayer span').first()).toBeVisible();
  let dialog = await manager(owner);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect(owner.getByRole('dialog', { name: '連接你的 AI', exact: true })).toBeVisible();
  expect(count).toBe(0); await configure(owner);
  dialog = await manager(owner);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect.poll(() => count).toBe(2);
  const peer = await context.newPage();
  const url = new URL(owner.url()); url.searchParams.set('instance', 'peer-translation');
  await peer.goto(url.toString());
  const peerDialog = await manager(peer);
  await expect(peerDialog.getByRole('button', { name: '接續未完成翻譯', exact: true })).toBeDisabled();
  expect(count).toBe(2);
  await owner.close(); hold = false;
  await peerDialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  const recovered = await manager(peer);
  await expect(recovered.getByRole('button', { name: '接續未完成翻譯', exact: true })).toBeEnabled();
  await recovered.getByRole('button', { name: '接續未完成翻譯', exact: true }).click();
  await configure(peer);
  const ready = await manager(peer);
  await page.close();
  await ready.getByRole('button', { name: '接續未完成翻譯', exact: true }).click();
  await expect(ready).toContainText('已保存 8 段');
  expect(count).toBe(9);
  await ready.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  await peer.locator('.pdf-translation-marker').first().hover();
  await expect(peer.getByRole('region', { name: '中文譯文', exact: true })).toHaveText('跨視窗中文譯文1');
});

test('long paragraphs expose one complete scrollable popup and resume saved subparts', async ({ page }) => {
  let count = 0; let hold = true;
  const longTranslation = '這段翻譯保留完整內容、數據與限制。'.repeat(100);
  await page.route('https://api.openai.com/v1/**', async route => {
    count++;
    if (hold && count === 2) await new Promise(r => setTimeout(r, 1200));
    try { await route.fulfill({ json: result(longTranslation) }); } catch { /* Paused. */ }
  });
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const p = pdf.addPage([612, 792]);
  for (let i = 0; i < 140; i++) p.drawText('Evidence continues in this paragraph with data and limits', { x: 48, y: 740 - i * 5, font, size: 4 });
  await page.goto('./');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.textLayer span').first()).toBeVisible(); await configure(page);
  await page.getByRole('button', { name: '逐段翻譯', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'PDF 逐段翻譯', exact: true });
  await expect(dialog).toContainText('可翻譯 1 段'); await expect(dialog).toContainText('預估 2 次請求');
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect.poll(() => count).toBe(2);
  await dialog.getByRole('button', { name: '暫停', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '接續未完成翻譯', exact: true })).toBeVisible();
  await expect(page.locator('.pdf-translation-marker')).toHaveCount(0);
  expect((await saved(page)).pdfTranslationJobs[0].targets[0].parts[0].result.text).toBe(longTranslation);
  hold = false;
  await dialog.getByRole('button', { name: '接續未完成翻譯', exact: true }).click();
  await expect(dialog).toContainText('已保存 1 段'); expect(count).toBe(3);
  await dialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  await page.locator('.pdf-translation-marker').click();
  const popup = page.getByRole('region', { name: '中文譯文', exact: true });
  await expect(popup).toHaveText(longTranslation + '\n\n' + longTranslation);
  const dimensions = await popup.evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, scroll: el.scrollHeight, client: el.clientHeight }));
  expect(dimensions.w).toBeLessThanOrEqual(320); expect(dimensions.h).toBeLessThanOrEqual(240); expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
  await popup.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(popup).toBeVisible();
  await page.screenshot({ path: 'test-results/pdf-translation-long.png' });
});

test('touch popup stays in the mobile viewport, hiding icons preserves saved translations', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, hasTouch: true, viewport: { width: 390, height: 844 } }); const page = await context.newPage();
  let count = 0;
  await page.route('https://api.openai.com/v1/**', route => { count++; return route.fulfill({ json: result('完整的手機中文譯文。') }); });
  await loadFixture(page); await configure(page);
  const dialog = await manager(page);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click(); await expect(dialog).toContainText('已保存 8 段');
  await dialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  const marker = page.locator('.pdf-translation-marker').first(); await marker.tap();
  const popup = page.getByRole('region', { name: '中文譯文', exact: true }); await expect(popup).toBeVisible();
  const box = (await popup.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(12); expect(box.x + box.width).toBeLessThanOrEqual(378);
  const buttonBox = (await marker.boundingBox())!; expect(buttonBox.width).toBeGreaterThanOrEqual(44); expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'test-results/pdf-translation-touch.png' });
  await marker.tap(); await expect(popup).toHaveCount(0);
  const manage = await manager(page); await manage.getByLabel('顯示翻譯圖示').uncheck(); await manage.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  await expect(page.locator('.pdf-translation-marker')).toHaveCount(0); expect((await saved(page)).pdfTranslations).toHaveLength(8); expect(count).toBe(8);
  await context.close();
});

test('storage failure stops subsequent generation and never exposes an uncommitted translation', async ({ page }) => {
  let count = 0;
  await page.route('https://api.openai.com/v1/**', route => { count++; return route.fulfill({ json: result('尚未成功保存的譯文') }); });
  await loadFixture(page); await configure(page);
  const dialog = await manager(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
      if (this.name === 'workspacesV2' && value.pdfTranslations?.length) throw new DOMException('Simulated quota', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('尚未保存');
  await expect(page.locator('.pdf-translation-marker')).toHaveCount(0);
  expect(count).toBe(1); expect((await saved(page)).pdfTranslations).toHaveLength(0);
});

test('deleting a source aborts pending output; undo restores its paragraph index without stale translations', async ({ page, context }) => {
  let count = 0;
  await context.route('https://api.openai.com/v1/**', () => { count++; /* Keep the source request pending until deletion. */ });
  await loadFixture(page); await configure(page);
  const dialog = await manager(page);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click(); await expect.poll(() => count).toBe(1);
  const other = await context.newPage(); await other.goto('./');
  await other.getByRole('button', { name: '文獻庫', exact: true }).click(); other.once('dialog', d => d.accept());
  await other.getByRole('button', { name: '移除 columns.pdf', exact: true }).click();
  await expect.poll(async () => (await saved(other)).documents.length).toBe(0);
  await expect(dialog).toHaveCount(0);
  expect((await saved(other)).pdfParagraphs).toHaveLength(0); expect((await saved(other)).pdfTranslations).toHaveLength(0);
  await other.getByRole('button', { name: '復原', exact: true }).click();
  await expect.poll(async () => (await saved(other)).pdfParagraphs.length).toBe(8);
  expect((await saved(other)).pdfTranslations).toHaveLength(0); expect(count).toBe(1);
});
