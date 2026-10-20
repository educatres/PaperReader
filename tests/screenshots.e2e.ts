import { openProject } from './projectHelpers';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test.use({ deviceScaleFactor: 2 });
async function load(page: Page) {
  page.on('dialog', d => d.accept()); await openProject(page);
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const p = pdf.addPage([400, 400]);
    p.drawRectangle({ x: 0, y: 200, width: 200, height: 200, color: rgb(1, 0, 0) });
    p.drawRectangle({ x: 200, y: 200, width: 200, height: 200, color: rgb(0, 0, 1) });
    p.drawRectangle({ x: 0, y: 0, width: 200, height: 200, color: rgb(0, 1, 0) });
    p.drawText('PDF_SECRET_UNDER_IMAGE', { x: 5, y: 395, size: 4, font });
    if (i === 1) p.setRotation(degrees(270));
  }
  await page.getByTestId('pdf-input').setInputFiles({ name: 'Colored-regions.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '截圖模式', exact: true }).click();
  await expect(page.getByTestId('screenshot-selection-0')).toBeVisible();
}
async function drag(page: Page, pageIndex = 0, from = { x: .1, y: .1 }, to = { x: .4, y: .4 }) {
  const overlay = page.getByTestId(`screenshot-selection-${pageIndex}`); await overlay.scrollIntoViewIfNeeded();
  const b = (await overlay.boundingBox())!;
  await page.mouse.move(b.x + b.width * from.x, b.y + b.height * from.y); await page.mouse.down();
  await page.mouse.move(b.x + b.width * to.x, b.y + b.height * to.y, { steps: 8 }); await page.mouse.up();
}
async function rendered(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  return image.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return { width: img.naturalWidth, height: img.naturalHeight, pixel: [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data] };
  });
}
async function edit(page: Page, card: Locator, text: string, notes = '') {
  await card.getByRole('button', { name: '編輯便條', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編輯研究便條' });
  await dialog.getByLabel('截圖便條文字（自行輸入或貼上）').fill(text); await dialog.getByLabel('我的筆記').fill(notes);
  await dialog.getByRole('button', { name: '儲存便條' }).click();
}
async function download(page: Page, kind: RegExp) {
  await page.getByRole('button', { name: '匯出研究', exact: true }).click(); const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: kind }).click();
  return readFile((await (await pending).path())!);
}
async function clear(page: Page) {
  await page.getByRole('button', { name: '文獻庫', exact: true }).click(); await page.getByRole('button', { name: '清空目前專案', exact: true }).click();
  await page.getByRole('button', { name: '確認清空', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(0);
}

test('drag screenshots capture exact PDF pixels through zoom, rotation and DPR; reverse/clamped drags, cancel and source focus work', async ({ page }) => {
  await load(page);
  await drag(page); const card = page.locator('.screenshot-note'); await expect(card).toHaveCount(1);
  const first = await rendered(card.locator('.screenshot-thumbnail img')); expect(first.pixel).toEqual([255, 0, 0, 255]);
  const canvasWidth = await page.locator('.pdf-page[data-page-index="0"] > canvas').evaluate((c: HTMLCanvasElement) => c.width);
  expect(Math.abs(first.width - canvasWidth * .3)).toBeLessThan(3);
  await expect(card.getByRole('button', { name: '摘要', exact: true }).last()).toBeDisabled();
  await card.getByRole('button', { name: '編輯便條', exact: true }).click();
  await expect(page.getByLabel('截圖便條文字（自行輸入或貼上）')).toHaveValue(''); await expect(page.getByLabel('我的筆記')).toHaveValue('');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await card.getByRole('button', { name: '放大截圖', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: '完整框選截圖', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '截圖模式', exact: true }).click(); // Escape exits screenshot mode too.
  const b = (await page.getByTestId('screenshot-selection-0').boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + 30); await page.mouse.down(); await page.mouse.move(b.x + 60, b.y + 60); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(card).toHaveCount(1); await page.getByRole('button', { name: '截圖模式', exact: true }).click();
  await drag(page, 0, { x: .2, y: .2 }, { x: .202, y: .202 }); await expect(card).toHaveCount(1);
  await page.getByRole('button', { name: '放大 PDF', exact: true }).click();
  await page.getByRole('button', { name: '旋轉 PDF', exact: true }).click();
  await expect(page.getByTestId('screenshot-selection-0')).toBeVisible();
  await page.locator('.pdf-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth; }); // Expose the right quadrant of the full-width page at 125% zoom.
  await drag(page, 0, { x: .85, y: .35 }, { x: .6, y: .1 }); // reverse drag in the rotated red quadrant
  await expect(card).toHaveCount(2); expect((await rendered(card.last().locator('.screenshot-thumbnail img'))).pixel).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: '適合寬度', exact: true }).click();
  await page.getByRole('button', { name: '旋轉 PDF', exact: true }).click();
  await page.getByRole('button', { name: '旋轉 PDF', exact: true }).click();
  await page.getByRole('button', { name: '旋轉 PDF', exact: true }).click();
  await page.getByRole('textbox', { name: '頁碼', exact: true }).fill('2'); await page.getByRole('textbox', { name: '頁碼', exact: true }).press('Enter');
  await expect(page.getByTestId('screenshot-selection-1')).toBeVisible();
  await drag(page, 1, { x: .1, y: .6 }, { x: .35, y: .85 }); // intrinsic rotation 270
  await expect(card).toHaveCount(3); expect((await rendered(card.last().locator('.screenshot-thumbnail img'))).pixel).toEqual([255, 0, 0, 255]);
  const last = card.last(); await last.getByRole('button', { name: '定位原文', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '頁碼', exact: true })).toHaveValue('2'); await expect(page.locator('.screenshot-source-region')).toBeVisible();
  await drag(page, 1, { x: .2, y: .2 }, { x: -.1, y: .4 }); await expect(card).toHaveCount(4);
  const json = JSON.parse((await download(page, /JSON 註記資料/)).toString());
  expect(json.notes.at(-1).screenshot.region.y).toBeCloseTo(0);
  await page.screenshot({ path: 'test-results/screenshot-notes.png' });
});

test('single and connected summaries use typed text only; empty image groups never request AI', async ({ page }) => {
  await load(page); await drag(page); await drag(page, 0, { x: .6, y: .1 }, { x: .85, y: .35 });
  const cards = page.locator('.screenshot-note'); await expect(cards).toHaveCount(2);
  const ids = await cards.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-note-id')!));
  await page.getByRole('button', { name: '結束截圖 · Esc' }).click();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click(); await page.getByLabel('你的 API key').fill('screenshot-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click(); await page.getByRole('button', { name: '完成', exact: true }).click();
  const requests: any[] = [];
  await page.route('https://api.openai.com/v1/responses', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { status: 'completed', output: [{ content: [{ type: 'output_text', text: '僅依便條文字整理的摘要 [N1]。' }] }] } }); });
  await page.getByRole('button', { name: '白板全貌', exact: true }).click(); await page.waitForTimeout(500);
  const a = (await cards.nth(0).locator('.react-flow__handle-right').boundingBox())!; const b = (await cards.nth(1).locator('.react-flow__handle-left').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
  const relation = page.getByRole('dialog', { name: '編輯便條關係' }); await relation.getByLabel('關係類型').selectOption('對比');
  await relation.getByLabel('說明').fill('Different conditions'); await relation.getByRole('button', { name: '儲存關係' }).click();
  await cards.first().locator('.note-title').click(); await page.getByRole('button', { name: '關聯摘要', exact: true }).click();
  await expect(page.getByRole('button', { name: '同意傳送並整合' })).toBeDisabled(); expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await edit(page, cards.first(), 'USER_PASTED_EVIDENCE', 'USER_INTERPRETATION');
  await cards.first().locator('.note-footer').getByRole('button', { name: '摘要', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].input).toContain('USER_PASTED_EVIDENCE'); expect(requests[0].input).toContain('USER_INTERPRETATION');
  await expect(cards.first().locator('.note-content')).toContainText('僅依便條文字');
  await cards.first().locator('.note-title').click(); await page.getByRole('button', { name: '關聯摘要', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('不傳送或分析圖片'); await page.getByRole('button', { name: '同意傳送並整合' }).click();
  await expect(page.locator('.group-summary-note')).toHaveCount(1);
  expect(requests[1].input).toContain('USER_PASTED_EVIDENCE'); expect(requests[1].input).toContain('no text; image excluded');
  expect(requests[1].input).toContain('Different conditions'); expect(requests[1].input).toContain('對比');
  for (const req of requests) for (const forbidden of ['PDF_SECRET_UNDER_IMAGE', 'assetId', 'sha256', 'image_url', 'input_image', 'blob:', 'data:image', 'screenshot-secret', ...ids]) expect(JSON.stringify(req)).not.toContain(forbidden);
});

test('images survive undo/redo, offline reload and full backup; missing/corrupt PNG imports preserve workspace; JSON shows missing images', async ({ page, context }) => {
  await load(page); await drag(page); const card = page.locator('.screenshot-note'); await expect(card).toHaveCount(1);
  await edit(page, card, 'Manual transcription survives backup');
  const before = await rendered(card.locator('.screenshot-thumbnail img'));
  await card.getByRole('button', { name: '更多便條選項' }).click(); await card.getByRole('button', { name: '刪除便條與標記' }).click(); await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '復原', exact: true }).click(); expect(await rendered(card.locator('.screenshot-thumbnail img'))).toEqual(before);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '復原', exact: true }).click(); await expect(card).toHaveCount(1);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await context.setOffline(true); await page.reload();
  expect(await rendered(card.locator('.screenshot-thumbnail img'))).toEqual(before); await expect(card.locator('.note-content')).toContainText('Manual transcription'); await context.setOffline(false);
  const pack = await download(page, /完整研究封裝/); const json = await download(page, /JSON 註記資料/);
  const zip = await JSZip.loadAsync(pack); const png = Object.keys(zip.files).find(name => name.endsWith('.png'))!;
  const annotations = JSON.parse(await zip.file('annotations.json')!.async('string')); expect(annotations.notes[0].originalText).toBe('Manual transcription survives backup');
  expect((await zip.file(png)!.async('uint8array')).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  const missing = await JSZip.loadAsync(pack); missing.remove(png);
  await page.getByTestId('restore-input').setInputFiles({ name: 'missing.researchpack', mimeType: 'application/zip', buffer: await missing.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.getByRole('alert')).toContainText('匯入失敗'); expect(await rendered(card.locator('.screenshot-thumbnail img'))).toEqual(before);
  const corrupt = await JSZip.loadAsync(pack); const pngData = await corrupt.file(png)!.async('uint8array'); pngData[pngData.length - 1] ^= 1; corrupt.file(png, pngData);
  await page.getByTestId('restore-input').setInputFiles({ name: 'corrupt.researchpack', mimeType: 'application/zip', buffer: await corrupt.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.getByRole('alert')).toContainText('匯入失敗'); await expect(card).toHaveCount(1);
  await clear(page);
  await page.getByTestId('restore-input').setInputFiles({ name: 'saved.researchpack', mimeType: 'application/zip', buffer: pack });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  expect(await rendered(card.locator('.screenshot-thumbnail img'))).toEqual(before); await expect(card.locator('.note-content')).toContainText('Manual transcription');
  await clear(page);
  await page.getByTestId('restore-input').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: json });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect(card.locator('.screenshot-missing')).toContainText('缺少截圖圖片'); await expect(card.locator('.note-content')).toContainText('Manual transcription');
  await page.getByRole('button', { name: '匯出研究', exact: true }).click(); await page.getByRole('button', { name: /完整研究封裝/ }).click();
  await expect(page.locator('.export-error')).toContainText('缺少');
});
