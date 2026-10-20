import { openProject } from './projectHelpers';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function loadPaper(page: Page, name = 'Window A') {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) {
    const paper = pdf.addPage([612, 792]);
    paper.drawText(`${name} page ${i}`, { x: 48, y: 730, size: 18, font });
    for (let j = 0; j < 25; j++) paper.drawText(`Evidence ${i}, line ${j + 1}.`, { x: 48, y: 690 - j * 20, size: 12, font });
  }
  await page.getByTestId('pdf-input').setInputFiles({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
}
async function ready(page: Page) { await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible(); }
async function openReader(page: Page, context: BrowserContext) {
  const next = context.waitForEvent('page');
  await page.getByRole('button', { name: '在新視窗閱讀', exact: true }).click();
  const reader = await next; await ready(reader); return reader;
}
async function go(page: Page, n: number) {
  await page.getByLabel('頁碼', { exact: true }).fill(String(n));
  await page.getByLabel('頁碼', { exact: true }).press('Enter');
  await expect(page.locator(`.pdf-page[data-page-index="${n - 1}"] .textLayer span`).first()).toBeVisible();
  await expect(page.getByLabel('頁碼', { exact: true })).toHaveValue(String(n));
}
async function mark(page: Page, n: number, line = 0) {
  await page.locator(`.pdf-page[data-page-index="${n - 1}"] .textLayer span`).nth(line).evaluate(span => {
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}
async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('PaperReader'); opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => { const database = opening.result; const request = database.transaction('projectWorkspaces').objectStore('projectWorkspaces').get(new URL(location.href).searchParams.get('project')!); request.onsuccess = () => { database.close(); resolve(request.result); }; request.onerror = () => reject(request.error); };
  }));
}
async function boardView(page: Page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem(`PaperReader.project.${new URL(location.href).searchParams.get('project')}.view.${new URL(location.href).searchParams.get('view') || 'main'}`) || '{}').viewport as { x: number; y: number; zoom: number });
}
async function panBoard(page: Page, dx = -180, dy = -100) {
  const previous = await boardView(page); const bounds = (await page.locator('.react-flow__pane').boundingBox())!;
  const x = bounds.x + bounds.width - 65; const y = bounds.y + bounds.height - 85;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => Math.abs((await boardView(page)).x - previous.x)).toBeGreaterThan(20);
  await page.waitForTimeout(400); // Allow the canvas pan animation to finish before capturing a new window's view.
  return boardView(page);
}
async function openBoard(page: Page, context: BrowserContext) {
  const next = context.waitForEvent('page'); await page.getByRole('button', { name: '在新視窗開啟白板', exact: true }).click();
  const board = await next; await expect(board.locator('.research-canvas')).toBeVisible(); return board;
}

test('PDF collapse restores this window’s page, zoom and hand mode across reload; popup blocking has a tab fallback', async ({ page }) => {
  await openProject(page); await loadPaper(page); await ready(page);
  await page.getByRole('button', { name: '放大 PDF', exact: true }).click(); await go(page, 2);
  await page.getByRole('button', { name: '手掌模式', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem(`PaperReader.project.${new URL(location.href).searchParams.get('project')}.readingPreferences.${new URL(location.href).searchParams.get('view') || 'main'}`) || '{}').lastPage?.[JSON.parse(sessionStorage.getItem(`PaperReader.project.${new URL(location.href).searchParams.get('project')}.view.${new URL(location.href).searchParams.get('view') || 'main'}`) || '{}').activeDocumentId])).toBe(2);
  await page.getByRole('button', { name: '隱藏 PDF 面板', exact: true }).click();
  await expect(page.locator('.pdf-pane, .split-handle')).toHaveCount(0);
  const board = (await page.locator('.board-pane').boundingBox())!; expect(board.width).toBe(1440);
  await page.reload(); await page.getByRole('button', { name: '顯示 PDF', exact: true }).click(); await ready(page);
  await expect(page.getByLabel('頁碼', { exact: true })).toHaveValue('2');
  await expect(page.locator('.zoom-value')).toHaveText('125%');
  await expect(page.getByRole('button', { name: '手掌模式', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: '在新視窗閱讀', exact: true }).click();
  await expect(page.getByRole('link', { name: '改用新分頁開啟', exact: true })).toHaveAttribute('href', /view=reader/);
  await expect(page.locator('.pdf-pane')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '隱藏 PDF 面板', exact: true }).click();
  await expect(page.locator('.board-pane')).toBeVisible();
  await page.getByRole('button', { name: '顯示 PDF', exact: true }).click(); await ready(page);
  await page.screenshot({ path: 'test-results/multiwindow-mobile.png' });
});

test('multiple independent PDF windows share simultaneous marks, local undo, source routing and survive closing the main window', async ({ page, context }) => {
  await openProject(page); await loadPaper(page); await ready(page);
  const one = await openReader(page, context);
  await expect(page.getByRole('button', { name: '顯示 PDF', exact: true })).toBeVisible();
  const two = await openReader(one, context);
  await expect(one.locator('.board-pane, .header-actions')).toHaveCount(0);
  await go(one, 2); await go(two, 3);
  await Promise.all([mark(one, 2), mark(two, 3)]);
  await expect(page.locator('.note-card')).toHaveCount(2);
  await expect.poll(async () => (await snapshot(page)).notes.length).toBe(2);
  const positions = (await snapshot(page)).notes.map((note: any) => note.position);
  expect(positions[0]).not.toEqual(positions[1]);
  await expect(one.getByLabel('頁碼', { exact: true })).toHaveValue('2');
  await expect(two.getByLabel('頁碼', { exact: true })).toHaveValue('3');
  await one.getByRole('button', { name: '復原', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-card')).toContainText('Window A page 3');
  await one.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(2);
  await one.getByRole('button', { name: '復原', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await one.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(2);
  await go(one, 1); await two.bringToFront();
  await two.getByLabel('頁碼', { exact: true }).click(); // Use the target reader: headless bringToFront alone does not always emit a window focus event.
  await page.locator('.note-card').filter({ hasText: 'Window A page 2' }).getByRole('button', { name: '定位原文', exact: true }).click();
  await expect(two.getByLabel('頁碼', { exact: true })).toHaveValue('2');
  await expect(one.getByLabel('頁碼', { exact: true })).toHaveValue('1');
  await expect(page.locator('.pdf-pane')).toHaveCount(0);
  await go(two, 3);
  await expect.poll(() => two.evaluate(() => JSON.parse(sessionStorage.getItem(`PaperReader.project.${new URL(location.href).searchParams.get('project')}.readingPreferences.${new URL(location.href).searchParams.get('view') || 'main'}`) || '{}').lastPage?.[JSON.parse(sessionStorage.getItem(`PaperReader.project.${new URL(location.href).searchParams.get('project')}.view.${new URL(location.href).searchParams.get('view') || 'main'}`) || '{}').activeDocumentId])).toBe(3);
  await two.reload(); await ready(two); await expect(two.getByLabel('頁碼', { exact: true })).toHaveValue('3');
  await page.close(); await mark(two, 3, 2);
  await expect.poll(async () => (await snapshot(two)).notes.length).toBe(3);
  const newMain = context.waitForEvent('page'); await two.getByRole('link', { name: '研究白板', exact: true }).click();
  const main = await newMain; await expect(main.locator('.note-card')).toHaveCount(3);
  await main.screenshot({ path: 'test-results/multiwindow-whiteboard.png' });
  await two.screenshot({ path: 'test-results/multiwindow-reader.png' });
});

test('a running summary keeps its owner across new windows; duplicate execution is blocked and a closed owner can be resumed', async ({ page, context }) => {
  await openProject(page); await loadPaper(page); await ready(page);
  async function configure(target: Page) {
    await target.getByRole('button', { name: '連接你的 AI', exact: true }).click();
    await target.getByLabel('你的 API key').fill('sk-mocked-window-only');
    await target.getByRole('button', { name: '使用此金鑰', exact: true }).click();
    await target.getByLabel('選擇模型').fill('mock-window-model');
    await target.getByRole('button', { name: '完成', exact: true }).click();
  }
  await configure(page);
  let calls = 0;
  await context.route('https://api.openai.com/v1/responses', route => {
    calls++;
    if (calls === 1) return; // Keep the owner's request pending until its window closes.
    return route.fulfill({ json: { status: 'completed', output: [{ content: [{ type: 'output_text', text: '跨視窗研究總覽 [p. 1–4]' }] }] } });
  });
  await page.getByRole('button', { name: '全文摘要', exact: true }).click();
  await page.getByRole('button', { name: '同意傳送並生成', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await expect.poll(async () => (await snapshot(page)).jobs[0]?.status).toBe('running');
  const reader = await openReader(page, context);
  const other = await context.newPage(); await openProject(other);
  await expect(other.getByRole('button', { name: '連接你的 AI', exact: true })).toBeVisible();
  expect((await snapshot(other)).jobs[0].status).toBe('running');
  await configure(other);
  await other.getByRole('button', { name: '全文摘要', exact: true }).click();
  await other.getByRole('button', { name: '同意傳送並生成', exact: true }).click();
  await expect(other.locator('.toast')).toContainText('另一個視窗正在執行全文摘要');
  expect(calls).toBe(1); expect((await snapshot(other)).jobs).toHaveLength(1);
  await page.close();
  await other.getByRole('button', { name: '全文摘要', exact: true }).click();
  await expect(other.locator('.resume-notice')).toBeVisible();
  await other.getByRole('button', { name: '同意傳送並接續', exact: true }).click();
  await expect(other.locator('.note-card')).toContainText('跨視窗研究總覽');
  await expect.poll(async () => (await snapshot(reader)).jobs[0]?.status).toBe('complete');
  expect((await snapshot(reader)).jobs).toHaveLength(1);
});

test('screenshot assets remain available for another window to undo, and reader windows reload offline', async ({ page, context }) => {
  await openProject(page); await loadPaper(page); await ready(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const reader = await openReader(page, context);
  await reader.getByRole('button', { name: '截圖模式', exact: true }).click();
  const overlay = reader.getByTestId('screenshot-selection-0'); await overlay.scrollIntoViewIfNeeded();
  const bounds = (await overlay.boundingBox())!;
  await reader.mouse.move(bounds.x + bounds.width * .1, bounds.y + bounds.height * .1); await reader.mouse.down();
  await reader.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .25, { steps: 8 }); await reader.mouse.up();
  const image = page.locator('.screenshot-thumbnail img');
  await expect(image).toBeVisible();
  await page.getByRole('button', { name: '更多便條選項', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '刪除便條與標記', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  const another = await context.newPage(); await openProject(another);
  await expect(another.locator('.app-loading')).toHaveCount(0);
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(another.locator('.screenshot-thumbnail img')).toBeVisible();
  await expect.poll(() => another.locator('.screenshot-thumbnail img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await reader.getByRole('button', { name: '螢光筆模式', exact: true }).click(); await mark(reader, 1);
  await expect.poll(async () => (await snapshot(reader)).notes.length).toBe(2);
  await context.setOffline(true); await reader.reload(); await ready(reader);
  await expect(reader.locator('.pdf-highlight').first()).toBeVisible();
  expect((await snapshot(reader)).notes.some((note: any) => note.screenshot)).toBe(true);
  await another.reload();
  await expect.poll(() => another.locator('.screenshot-thumbnail img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await context.setOffline(false);
});

test('different PDFs can be opened from the library and changes do not switch the other window’s document', async ({ page, context }) => {
  await openProject(page); await loadPaper(page, 'Window A'); await ready(page);
  const one = await openReader(page, context);
  await page.getByRole('button', { name: '顯示 PDF', exact: true }).click();
  await loadPaper(page, 'Window B');
  await page.getByRole('button', { name: '文獻庫', exact: true }).click();
  const created = context.waitForEvent('page'); await page.getByRole('button', { name: '另開視窗閱讀 Window B.pdf', exact: true }).click();
  const two = await created; await ready(two);
  await expect(one.getByLabel('閱讀文獻')).toHaveValue((await snapshot(one)).documents[0].id);
  await expect(two.getByLabel('閱讀文獻')).toHaveValue((await snapshot(two)).documents[1].id);
  await Promise.all([mark(one, 1), mark(two, 1)]);
  await expect(page.locator('.note-card')).toHaveCount(2);
  await expect(one.locator('.pdf-page .textLayer')).toContainText(['Window A page 1']);
  await expect(two.locator('.pdf-page .textLayer')).toContainText(['Window B page 1']);
});

test('stale editor fields merge independently; same-field conflicts persist across reload and allow choosing a version', async ({ page, context }) => {
  await openProject(page); await loadPaper(page); await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).notes.length).toBe(1);
  const other = await context.newPage(); await openProject(other); await expect(other.locator('.note-card')).toHaveCount(1);
  for (const target of [page, other]) { await target.bringToFront(); await target.getByRole('button', { name: '編輯便條', exact: true }).click(); }
  await page.bringToFront();
  await page.getByLabel('便條標題').fill('Shared title');
  await other.bringToFront();
  await other.getByRole('textbox', { name: '我的筆記', exact: true }).fill('Independent field');
  await page.bringToFront();
  await page.getByRole('button', { name: '儲存便條', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await other.bringToFront();
  await other.getByRole('button', { name: '儲存便條', exact: true }).click();
  await expect.poll(async () => (await snapshot(other)).notes[0]).toMatchObject({ title: 'Shared title', userNotes: 'Independent field' });
  await expect(page.locator('.sync-conflict-notice')).toHaveCount(0);
  for (const target of [page, other]) { await target.bringToFront(); await target.getByRole('button', { name: '編輯便條', exact: true }).click(); }
  await page.bringToFront();
  await page.getByRole('textbox', { name: '我的筆記', exact: true }).fill('Version A');
  await other.bringToFront();
  await other.getByRole('textbox', { name: '我的筆記', exact: true }).fill('Version B');
  await page.bringToFront();
  await page.getByRole('button', { name: '儲存便條', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).notes[0].userNotes).toBe('Version A');
  await other.bringToFront();
  await other.getByRole('button', { name: '儲存便條', exact: true }).click();
  await expect(other.locator('.sync-conflict-notice')).toBeVisible();
  await other.reload(); await other.locator('.sync-conflict-notice').click();
  const conflict = other.getByRole('dialog', { name: '確認跨視窗修改' });
  await expect(conflict.getByLabel('目前共用版本')).toHaveValue('Version A');
  await expect(conflict.getByLabel('這份草稿')).toHaveValue('Version B');
  await conflict.getByRole('button', { name: '套用草稿版本', exact: true }).click();
  await expect(other.locator('.sync-conflict-notice')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(other)).notes[0].userNotes).toBe('Version B');
  // A stale editor must never recreate a note after another window clears the workspace.
  await other.getByRole('button', { name: '編輯便條', exact: true }).click(); await other.getByRole('textbox', { name: '我的筆記', exact: true }).fill('Old workspace draft');
  await page.bringToFront();
  await page.getByRole('button', { name: '文獻庫', exact: true }).click(); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '清空目前專案', exact: true }).click();
  await page.getByRole('button', { name: '確認清空', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(other.locator('.sync-conflict-notice')).toBeVisible();
  expect((await snapshot(page)).notes).toHaveLength(0);
});

test('an editor opened before restore cannot overwrite the restored note even when its ID is unchanged', async ({ page, context }) => {
  await openProject(page); await loadPaper(page);
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).notes.length).toBe(1);
  const backup = await snapshot(page); backup.notes[0].userNotes = 'Restored workspace';
  const other = await context.newPage(); await openProject(other);
  await other.getByRole('button', { name: '編輯便條', exact: true }).click();
  await other.getByRole('textbox', { name: '我的筆記', exact: true }).fill('Old unsaved draft');
  await page.bringToFront();
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('restore-input').setInputFiles({ name: 'restored.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).notes[0].userNotes).toBe('Restored workspace');
  await expect(other.locator('.note-card')).toHaveCount(1);
  await expect(other.locator('.notes-preview')).toHaveText('Restored workspace');
  await other.bringToFront();
  await other.getByRole('button', { name: '儲存便條', exact: true }).click();
  await expect(other.locator('.sync-conflict-notice')).toBeVisible();
  expect((await snapshot(other)).notes[0].userNotes).toBe('Restored workspace');
  await other.locator('.sync-conflict-notice').click();
  await other.getByRole('button', { name: '套用草稿版本', exact: true }).click();
  await expect(other.locator('.toast')).toContainText('研究空間已更換');
  expect((await snapshot(page)).notes[0].userNotes).toBe('Restored workspace');
});

test('either panel can fill the window, hidden whiteboard views survive reload, and mobile actions remain reachable', async ({ page, context }) => {
  await openProject(page); await loadPaper(page); await ready(page);
  const divider = page.getByRole('separator', { name: '調整閱讀器與白板寬度' });
  for (let i = 0; i < 11; i++) await divider.press('ArrowRight');
  const narrowBoard = (await page.locator('.board-pane').boundingBox())!;
  const hideBoard = (await page.getByRole('button', { name: '隱藏知識白板', exact: true }).boundingBox())!;
  expect(hideBoard.x + hideBoard.width).toBeLessThanOrEqual(narrowBoard.x + narrowBoard.width);
  for (let i = 0; i < 11; i++) await divider.press('ArrowLeft');
  const view = await panBoard(page);
  await page.getByRole('button', { name: '隱藏知識白板', exact: true }).click();
  await expect(page.locator('.board-pane, .split-handle')).toHaveCount(0);
  expect((await page.locator('.pdf-pane').boundingBox())!.width).toBe(1440);
  await page.reload(); await ready(page); await expect(page.locator('.board-pane')).toHaveCount(0);
  await page.getByRole('button', { name: '顯示知識白板', exact: true }).click();
  await expect(page.locator('.board-pane')).toBeVisible(); expect(await boardView(page)).toEqual(view);
  await page.getByRole('button', { name: '隱藏 PDF 面板', exact: true }).click();
  await expect(page.locator('.pdf-pane')).toHaveCount(0);
  await page.getByRole('button', { name: '隱藏知識白板', exact: true }).click();
  await ready(page); await expect(page.locator('.board-pane')).toHaveCount(0);
  const reader = await openReader(page, context); // A board must open even when inherited preferences hide it.
  const next = context.waitForEvent('page'); await reader.getByRole('link', { name: '研究白板', exact: true }).click();
  const board = await next; await expect(board.locator('.board-pane')).toBeVisible();
  await expect(board.locator('.pdf-pane')).toHaveCount(0);
  await board.reload(); await expect(board.locator('.board-pane')).toBeVisible(); await expect(board.locator('.pdf-pane')).toHaveCount(0);
  await board.evaluate(() => { window.open = () => null; });
  await board.getByRole('button', { name: '在新視窗開啟白板', exact: true }).click();
  await expect(board.getByRole('link', { name: '改用新分頁開啟', exact: true })).toHaveAttribute('href', /view=board/);
  await expect(board.locator('.board-pane')).toBeVisible();
  await board.setViewportSize({ width: 390, height: 844 });
  await expect(board.getByRole('button', { name: '在新視窗開啟白板', exact: true })).toBeInViewport();
  await expect(board.getByRole('button', { name: '隱藏知識白板', exact: true })).toBeInViewport();
  await board.screenshot({ path: 'test-results/whiteboard-window-mobile.png' });
  await board.getByRole('button', { name: '隱藏知識白板', exact: true }).click(); await ready(board);
  await board.getByRole('button', { name: '顯示知識白板', exact: true }).click();
  await expect(board.locator('.board-pane')).toBeVisible();
});

test('multiple board windows inherit the current view then retain independent positions through edits, hiding and reload', async ({ page, context }) => {
  await openProject(page); await loadPaper(page); await ready(page);
  await page.getByRole('button', { name: '隱藏 PDF 面板', exact: true }).click();
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(1); await page.waitForTimeout(550);
  const original = await panBoard(page);
  const one = await openBoard(page, context); expect(await boardView(one)).toEqual(original);
  const first = await panBoard(one, -280, -90);
  const two = await openBoard(one, context); expect(await boardView(two)).toEqual(first);
  await two.getByRole('button', { name: '縮小白板', exact: true }).click();
  await expect.poll(async () => (await boardView(two)).zoom).toBeLessThan(first.zoom);
  const second = await panBoard(two, -140, -80);
  expect(await boardView(one)).toEqual(first); expect(await boardView(page)).toEqual(original);
  await page.getByRole('button', { name: '白板全貌', exact: true }).click(); await page.waitForTimeout(450);
  await page.getByRole('button', { name: '編輯便條', exact: true }).click(); await page.getByLabel('便條標題').fill('Shared board edit');
  await page.bringToFront();
  await page.getByRole('button', { name: '儲存便條', exact: true }).click();
  for (const target of [one, two]) await expect(target.locator('.note-title')).toHaveText('Shared board edit');
  expect(await boardView(one)).toEqual(first); expect(await boardView(two)).toEqual(second);
  await one.getByRole('button', { name: '隱藏知識白板', exact: true }).click();
  await one.getByRole('button', { name: '顯示知識白板', exact: true }).click();
  expect(await boardView(one)).toEqual(first);
  await two.reload(); await expect(two.locator('.note-title')).toHaveText('Shared board edit');
  expect(await boardView(two)).toEqual(second);
  await page.close(); await one.close();
  await two.getByRole('button', { name: '新增便條', exact: true }).click(); await expect(two.locator('.note-card')).toHaveCount(2);
  await expect.poll(async () => (await snapshot(two)).notes.length).toBe(2);
  await two.screenshot({ path: 'test-results/whiteboard-window-desktop.png' });
});

test('a PDF highlight focuses only the most recently used visible board and source navigation returns to its reader', async ({ page, context }) => {
  await openProject(page); await loadPaper(page); await ready(page); await mark(page, 1);
  await expect(page.locator('.note-card')).toHaveCount(1); await page.waitForTimeout(550);
  const reader = await openReader(page, context);
  const one = await openBoard(page, context); await panBoard(one, -340, -120);
  const two = await openBoard(one, context); const otherView = await panBoard(two, -260, -130);
  const oldMainView = await panBoard(page, -220, -100); const before = await boardView(one);
  await one.bringToFront(); await one.getByLabel('搜尋便條', { exact: true }).click();
  await reader.locator('.pdf-highlight').first().click();
  await expect.poll(async () => (await boardView(one)).x).not.toBe(before.x);
  expect(await boardView(two)).toEqual(otherView); expect(await boardView(page)).toEqual(oldMainView);
  await page.getByRole('button', { name: '隱藏知識白板', exact: true }).click(); await ready(page);
  const beforeHiddenFocus = await panBoard(one, -300, -90);
  await page.locator('.pdf-highlight').first().click();
  await expect.poll(async () => (await boardView(one)).x).not.toBe(beforeHiddenFocus.x);
  expect(await boardView(two)).toEqual(otherView);
  await page.getByRole('button', { name: '顯示知識白板', exact: true }).click();
  await page.waitForTimeout(550); // A hidden board must retain its own view after routing a highlight to another board.
  expect(await boardView(page)).toEqual(oldMainView);
  await go(reader, 2);
  await one.getByRole('button', { name: '定位原文', exact: true }).click();
  await expect(reader.getByLabel('頁碼', { exact: true })).toHaveValue('1');
  await expect(one.locator('.pdf-pane')).toHaveCount(0);
});
