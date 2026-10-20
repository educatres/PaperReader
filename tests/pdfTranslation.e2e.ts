import { openProject } from './projectHelpers';
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
  await openProject(page);
  await page.getByTestId('pdf-input').setInputFiles({ name: 'columns.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible({ timeout: 15000 });
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
      const tx = db.transaction('projectWorkspaces'); const read = tx.objectStore('projectWorkspaces').get(new URL(location.href).searchParams.get('project')!);
      return await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
    } finally { db.close(); }
  });
}
function result(text: string) { return { status: 'completed', output: [{ content: [{ type: 'output_text', text }] }], usage: { total_tokens: 25 } }; }
async function expectAttachedToParagraph(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const popup = document.querySelector('.translation-popover')?.getBoundingClientRect();
    const anchor = document.querySelector('.pdf-translation-marker[aria-expanded=true]')?.getBoundingClientRect();
    const lines = [...document.querySelectorAll('.translation-source-outline')].map(line => line.getBoundingClientRect());
    if (!popup || !anchor || !lines.length) return false;
    const top = Math.min(anchor.top, ...lines.map(r => r.top));
    const bottom = Math.max(anchor.bottom, ...lines.map(r => r.bottom));
    const side = document.querySelector('.translation-popover')?.getAttribute('data-placement');
    // The popup must touch the icon/source edge with an 8px gap, even when a
    // larger blank region is available elsewhere on the page.
    return side === 'above' ? Math.abs(top - popup.bottom - 8) < 1 : Math.abs(popup.top - bottom - 8) < 1;
  })).toBe(true);
}

test('translation windows stay immediately above their icon and keep the selected English clear', async ({ page }) => {
  let count = 0;
  await page.route('https://api.openai.com/v1/**', route => { count++; return route.fulfill({ json: result('不遮擋英文的中文譯文。') }); });
  await loadFixture(page); await configure(page);
  const dialog = await manager(page);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click(); await expect(dialog).toContainText('已保存 8 段');
  await dialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  const marker = page.locator('.pdf-translation-marker').first();
  const popup = page.getByRole('region', { name: '中文譯文', exact: true });
  await marker.hover(); await expect(popup).toBeVisible(); await expect(popup).toHaveAttribute('data-placement', 'above');
  await expectAttachedToParagraph(page);
  await popup.hover(); await expect(popup).toBeVisible();
  await page.screenshot({ path: 'test-results/pdf-translation-above.png' });
  await page.keyboard.press('Escape');
  // The second paragraph has text directly above it. It must stay attached
  // to its own icon rather than jumping above the previous paragraph.
  const secondMarker = page.locator('.pdf-page').first().locator('.pdf-translation-marker').nth(1);
  await secondMarker.click(); await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('data-placement', 'above'); await expectAttachedToParagraph(page);
  await popup.hover(); await expect(popup).toBeVisible();
  await page.screenshot({ path: 'test-results/pdf-translation-nearby.png' });
  await page.keyboard.press('Escape');
  await marker.click();
  // Keep the icon visible near the top: the translation must move down instead
  // of being clamped onto the English paragraph.
  await marker.evaluate(button => {
    const root = button.closest('.pdf-scroll')!;
    root.scrollTop += button.getBoundingClientRect().top - root.getBoundingClientRect().top - 8;
  });
  await expect(popup).toHaveAttribute('data-placement', 'below'); await expectAttachedToParagraph(page);
  await page.screenshot({ path: 'test-results/pdf-translation-below.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '旋轉 PDF', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rotation', '90');
  await marker.click(); await expect(popup).toBeVisible(); await expectAttachedToParagraph(page);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1180, height: 820 });
  await marker.click(); await expect(popup).toBeVisible(); await expectAttachedToParagraph(page);
  expect(count).toBe(8);
});

test('erase highlight preserves notes and source-page navigation through undo, reload and pack restore', async ({ page }) => {
  await loadFixture(page);
  await page.getByLabel('頁碼', { exact: true }).fill('2'); await page.getByLabel('頁碼', { exact: true }).press('Enter');
  const passage = page.locator('.pdf-page[data-page-index="1"] .textLayer span').first();
  await expect(passage).toBeVisible();
  await passage.evaluate(span => {
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.getByRole('button', { name: '編輯便條', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '編輯研究便條' });
  await editor.getByLabel('我的筆記', { exact: true }).fill('刪除螢光標註後依然保留');
  await editor.getByLabel('標籤').fill('重要,方法');
  await editor.getByRole('button', { name: '儲存便條', exact: true }).click();
  await page.route('https://api.openai.com/v1/**', route => route.fulfill({ json: result('便條 AI 內容保留') }));
  await configure(page);
  await page.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true }).click();
  await expect(page.locator('.note-content')).toHaveText('便條 AI 內容保留');
  await page.locator('.note-footer').getByRole('button', { name: '摘要', exact: true }).click();
  await expect(page.locator('.note-tabs button.active')).toHaveText('摘要');
  await expect.poll(async () => (await saved(page)).notes[0].summary?.text).toBe('便條 AI 內容保留');
  const before = await saved(page); const count = await page.locator('.pdf-highlight').count();
  expect(count).toBeGreaterThan(0);
  await page.getByRole('button', { name: '刪除 PDF 標註', exact: true }).click();
  // Native button activation also works for keyboard-only use.
  await page.screenshot({ path: 'test-results/pdf-erase-highlight.png' });
  await page.locator('.pdf-highlight').first().focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.pdf-highlight')).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).highlights[0].deletedAt).toBeTruthy();
  expect((await saved(page)).notes).toEqual(before.notes);
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(page.locator('.pdf-highlight')).toHaveCount(count);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.pdf-highlight')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(page.locator('.pdf-erase-notice')).toHaveCount(0);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await page.reload(); await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.pdf-highlight')).toHaveCount(0);
  await page.getByLabel('頁碼', { exact: true }).fill('1'); await page.getByLabel('頁碼', { exact: true }).press('Enter');
  await expect(page.getByLabel('頁碼', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: '定位原文', exact: true }).click();
  await expect(page.getByLabel('頁碼', { exact: true })).toHaveValue('2');
  await expect(page.locator('.pdf-highlight')).toHaveCount(0);
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /完整研究封裝/ }).click();
  const pack = await readFile((await (await downloading).path())!);
  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: '文獻庫', exact: true }).click();
  await page.getByRole('button', { name: '清空目前專案', exact: true }).click();
  await page.getByRole('button', { name: '確認清空', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.getByTestId('restore-input').setInputFiles({ name: 'erased.researchpack', mimeType: 'application/zip', buffer: pack });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await expect(page.locator('.pdf-highlight')).toHaveCount(0);
  expect((await saved(page)).notes).toEqual(before.notes);
  expect((await saved(page)).highlights[0].deletedAt).toBeTruthy();
});

test('erase translation removes saved parts, supports undo and backups, and only regenerates on explicit start', async ({ page }) => {
  let requests = 0;
  await page.route('https://api.openai.com/v1/**', route => { requests++; return route.fulfill({ json: result('逐段中文譯文') }); });
  await loadFixture(page); await configure(page);
  const dialog = await manager(page);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect(dialog).toContainText('已保存 8 段');
  await dialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  const first = page.locator('.pdf-translation-marker').first();
  const id = await first.getAttribute('data-paragraph-id');
  const locator = page.locator(`.pdf-translation-marker[data-paragraph-id="${id}"]`);
  await first.click(); await expect(page.locator('.translation-popover')).toBeVisible();
  await page.getByRole('button', { name: '刪除 PDF 標註', exact: true }).click();
  await expect(page.locator('.translation-popover')).toHaveCount(0);
  await first.hover(); await page.waitForTimeout(250); await expect(page.locator('.translation-popover')).toHaveCount(0);
  await first.click(); await expect(locator).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).pdfTranslations.length).toBe(7);
  let data = await saved(page);
  expect(data.pdfTranslationJobs.every((j: any) => j.targets.every((t: any) => t.paragraphId !== id))).toBe(true);
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(locator).toBeVisible();
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(locator).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await page.reload(); await expect(page.locator('.pdf-translation-marker').first()).toBeVisible(); await expect(locator).toHaveCount(0);
  expect(requests).toBe(8);
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: /完整研究封裝/ }).click();
  const pack = await readFile((await (await downloading).path())!);
  const zip = await JSZip.loadAsync(pack); data = JSON.parse(await zip.file('annotations.json')!.async('string'));
  expect(data.pdfTranslations).toHaveLength(7); expect(data.pdfTranslationJobs[0].targets).toHaveLength(7);
  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: '文獻庫', exact: true }).click();
  await page.getByRole('button', { name: '清空目前專案', exact: true }).click();
  await page.getByRole('button', { name: '確認清空', exact: true }).click();
  await expect(page.locator('.pdf-translation-marker')).toHaveCount(0);
  await page.getByTestId('restore-input').setInputFiles({ name: 'erased.researchpack', mimeType: 'application/zip', buffer: pack });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect(page.locator('.pdf-translation-marker').first()).toBeVisible(); await expect(locator).toHaveCount(0);
  await configure(page);
  const next = await manager(page); await expect(next).toContainText('已保存 7 段');
  expect(requests).toBe(8);
  await next.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect(next).toContainText('已保存 8 段'); expect(requests).toBe(9);
});

test('deleting a saved translation from another reader aborts the active batch and does not resurrect from a late response', async ({ page, context }) => {
  let requests = 0; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://api.openai.com/v1/**', async route => {
    requests++;
    if (requests === 2) await held;
    await route.fulfill({ json: result('應可刪除的譯文') }).catch(() => {});
  });
  await loadFixture(page); await configure(page);
  const dialog = await manager(page);
  await dialog.getByRole('button', { name: '開始逐段翻譯', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect.poll(async () => (await saved(page)).pdfTranslations.length).toBe(1);
  await dialog.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  const opening = context.waitForEvent('page'); await page.getByRole('button', { name: '在新視窗閱讀', exact: true }).click();
  const reader = await opening;
  const marker = reader.locator('.pdf-translation-marker').first(); await expect(marker).toBeVisible();
  await reader.getByRole('button', { name: '刪除 PDF 標註', exact: true }).click(); await marker.click();
  await expect(reader.locator('.pdf-translation-marker')).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).pdfTranslations.length).toBe(0);
  release();
  await page.getByRole('button', { name: '顯示 PDF', exact: true }).click();
  const paused = await manager(page);
  await expect(paused.getByRole('button', { name: '接續未完成翻譯', exact: true })).toBeVisible();
  const data = await saved(page);
  expect(data.pdfTranslationJobs[0].status).toBe('paused'); expect(data.pdfTranslationJobs[0].targets).toHaveLength(7);
  expect(data.pdfTranslations).toHaveLength(0); expect(requests).toBe(2);
  await paused.getByRole('button', { name: '繼續閱讀', exact: true }).click();
  await expect(page.locator('.pdf-translation-marker')).toHaveCount(0);
  // Deletion is undoable only in the window where it occurred.
  await reader.getByRole('button', { name: '復原', exact: true }).click();
  await expect(reader.locator('.pdf-translation-marker')).toHaveCount(1);
  await expect(page.locator('.pdf-translation-marker')).toHaveCount(1);
  await reader.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.pdf-translation-marker')).toHaveCount(0);
  await reader.close();
});

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
  await page.getByRole('button', { name: '清空目前專案', exact: true }).click();
  await page.getByRole('button', { name: '確認清空', exact: true }).click();
  await page.getByTestId('restore-input').setInputFiles({ name: 'translations.researchpack', mimeType: 'application/zip', buffer: bytes });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
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
  let count = 0; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await context.route('https://api.openai.com/v1/**', async route => {
    count++;
    if (count === 2) await held;
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
  await owner.close(); release();
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
  await openProject(page);
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
  const dimensions = await popup.evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top, scroll: el.scrollHeight, client: el.clientHeight }));
  expect(dimensions.w).toBeLessThanOrEqual(320); expect(dimensions.h).toBeLessThanOrEqual(240); expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
  expect(dimensions.top).toBeGreaterThanOrEqual((await page.locator('.pdf-scroll').boundingBox())!.y);
  await expectAttachedToParagraph(page);
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
  await expectAttachedToParagraph(page);
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
      if (this.name === 'projectWorkspaces' && value.pdfTranslations?.length) throw new DOMException('Simulated quota', 'QuotaExceededError');
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
  const other = await context.newPage(); await openProject(other);
  await other.getByRole('button', { name: '文獻庫', exact: true }).click(); other.once('dialog', d => d.accept());
  await other.getByRole('button', { name: '移除 columns.pdf', exact: true }).click();
  await expect.poll(async () => (await saved(other)).documents.length).toBe(0);
  await expect(dialog).toHaveCount(0);
  expect((await saved(other)).pdfParagraphs).toHaveLength(0); expect((await saved(other)).pdfTranslations).toHaveLength(0);
  await other.getByRole('button', { name: '復原', exact: true }).click();
  await expect.poll(async () => (await saved(other)).pdfParagraphs.length).toBe(8);
  expect((await saved(other)).pdfTranslations).toHaveLength(0); expect(count).toBe(1);
});
