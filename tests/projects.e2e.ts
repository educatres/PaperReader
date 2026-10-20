import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function home(page: Page) {
  await page.bringToFront();
  await page.getByRole('button', { name: '← 我的專案', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的專案', exact: true })).toBeVisible();
  await expect(page.locator('.project-transition-overlay')).toHaveCount(0);
}
async function create(page: Page, name: string) {
  await page.bringToFront();
  await page.getByRole('button', { name: '建立專案', exact: true }).click();
  await page.getByLabel('專案名稱', { exact: true }).fill(name);
  await page.getByRole('button', { name: '建立並進入', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.project-transition-overlay')).toHaveCount(0);
  return new URL(page.url()).searchParams.get('project')!;
}
async function sample(page: Page) {
  await page.getByRole('button', { name: '先試讀一篇範例' }).click();
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
}
async function snapshot(page: Page, projectId?: string): Promise<any> {
  await page.bringToFront();
  await expect(page.locator('.project-transition-overlay')).toHaveCount(0);
  projectId ||= new URL(page.url()).searchParams.get('project')!;
  return page.evaluate(async id => {
    const open = indexedDB.open('PaperReader'); const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try { const read = db.transaction('projectWorkspaces').objectStore('projectWorkspaces').get(id); return await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); }); } finally { db.close(); }
  }, projectId);
}
async function configure(page: Page) {
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByLabel('你的 API key').fill('sk-project-test-memory-only');
  await page.getByRole('button', { name: '使用此金鑰', exact: true }).click();
  await page.getByLabel('選擇模型').fill('mock-project-model');
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
const response = { status: 'completed', output: [{ content: [{ type: 'output_text', text: '原專案的回應' }] }] };

test('overview stays empty until creation; name validation, search, sort and rename work', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: '建立第一個專案' })).toBeVisible();
  await page.keyboard.press('n'); await page.keyboard.press('Control+o');
  await expect(page.locator('.pdf-page, .react-flow, .note-card')).toHaveCount(0);
  await page.getByRole('button', { name: '建立專案', exact: true }).click();
  await page.getByLabel('專案名稱', { exact: true }).fill('  ');
  await page.getByRole('button', { name: '建立並進入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1–100');
  await page.getByLabel('專案名稱', { exact: true }).fill('Beta');
  await page.getByRole('button', { name: '建立並進入', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible(); await home(page);
  await create(page, 'Alpha'); await home(page);
  await page.getByLabel('專案排序').selectOption('name');
  await expect(page.locator('.project-card h3')).toHaveText(['Alpha', 'Beta']);
  await page.getByLabel('搜尋專案名稱').fill('  bEtA  ');
  await expect(page.locator('.project-card h3')).toHaveText(['Beta']);
  await page.getByRole('button', { name: '專案選單 Beta' }).click();
  await page.getByRole('button', { name: '重新命名', exact: true }).click();
  await page.getByLabel('專案名稱', { exact: true }).fill('Gamma');
  await page.getByRole('button', { name: '儲存名稱' }).click();
  await expect(page.getByText('找不到符合的專案')).toBeVisible();
  await page.getByRole('button', { name: '清除搜尋', exact: true }).last().click();
  await expect(page.locator('.project-card h3')).toHaveText(['Alpha', 'Gamma']);
  await page.screenshot({ path: 'test-results/projects-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.getByRole('button', { name: '建立專案', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/projects-mobile.png', fullPage: true });
});

test('SPA navigation saves an open editor, retains API keys and restores project-specific PDF views', async ({ page }) => {
  await page.goto('./'); const a = await create(page, 'A'); await sample(page); await configure(page);
  await page.getByRole('button', { name: '放大 PDF', exact: true }).click();
  await page.getByRole('button', { name: '旋轉 PDF', exact: true }).click();
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '編輯便條', exact: true }).click();
  await page.getByLabel('我的筆記', { exact: true }).fill('尚未按儲存的 A 筆記');
  await page.evaluate(() => { (window as any).__spaSentinel = 'same-window'; });
  await page.goBack();
  await expect(page.getByRole('heading', { name: '我的專案', exact: true })).toBeVisible();
  expect((await snapshot(page, a)).notes[0].userNotes).toBe('尚未按儲存的 A 筆記');
  await create(page, 'B'); await expect(page.locator('.note-card')).toHaveCount(0); await sample(page);
  await expect(page.locator('.zoom-value')).toHaveText('100%');
  await expect(page.getByRole('button', { name: 'OpenAI', exact: true })).toBeVisible();
  await home(page); await page.getByRole('button', { name: '進入專案 A', exact: true }).click();
  await expect(page.locator('.notes-preview')).toHaveText('尚未按儲存的 A 筆記');
  await expect(page.locator('.zoom-value')).toHaveText('125%');
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rotation', '90');
  expect(await page.evaluate(() => (window as any).__spaSentinel)).toBe('same-window');
  await home(page); await page.reload(); await page.getByRole('button', { name: '進入專案 A', exact: true }).click();
  await expect(page.locator('.zoom-value')).toHaveText('125%');
  await expect(page.getByRole('button', { name: '連接你的 AI', exact: true })).toBeVisible();
});

test('duplicate backup imports keep identical internal IDs isolated; restore and clear affect only the target', async ({ page }) => {
  await page.goto('./'); await create(page, 'Source'); await sample(page);
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: /完整研究封裝/ }).click();
  const backup = await readFile((await (await downloading).path())!); const source = await snapshot(page);
  await home(page);
  await page.getByTestId('project-import-input').setInputFiles({ name: 'copy.researchpack', mimeType: 'application/zip', buffer: backup });
  await expect(page.locator('.app-shell')).toBeVisible(); await expect(page.locator('.project-transition-overlay')).toHaveCount(0); const a = new URL(page.url()).searchParams.get('project')!;
  await page.getByLabel('研究空間名稱').fill('Copy A'); await page.getByLabel('研究空間名稱').press('Tab');
  await home(page);
  await page.getByTestId('project-import-input').setInputFiles({ name: 'copy.researchpack', mimeType: 'application/zip', buffer: backup });
  await expect(page.locator('.app-shell')).toBeVisible(); await expect(page.locator('.project-transition-overlay')).toHaveCount(0); const b = new URL(page.url()).searchParams.get('project')!;
  expect(a).not.toBe(b); expect((await snapshot(page)).notes[0].id).toBe(source.notes[0].id);
  await page.getByLabel('研究空間名稱').fill('Copy B'); await page.getByLabel('研究空間名稱').press('Tab');
  await home(page); await page.getByRole('button', { name: '進入專案 Copy A' }).click();
  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: '文獻庫', exact: true }).click();
  await page.getByRole('button', { name: '清空目前專案', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '清空目前專案', exact: true })).toContainText('Copy A');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清空目前專案', exact: true }).click();
  await page.getByRole('button', { name: '確認清空', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(0);
  expect((await snapshot(page, b)).notes).toHaveLength(1);
  await page.getByTestId('restore-input').setInputFiles({ name: 'restore.researchpack', mimeType: 'application/zip', buffer: backup });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('project')).toBe(a);
  expect((await snapshot(page, b)).title).toBe('Copy B');
  await home(page); await page.getByRole('button', { name: '專案選單 Source' }).first().click();
  await page.getByRole('button', { name: '刪除專案', exact: true }).click(); await page.getByRole('button', { name: '永久刪除專案' }).click();
  await page.getByRole('button', { name: '進入專案 Copy B' }).click();
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
});

test('save failure blocks navigation and keeps the draft; retry succeeds', async ({ page }) => {
  await page.goto('./'); const id = await create(page, 'Durable');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function(value, ...rest) {
      if (this.name === 'projectWorkspaces' && value.notes?.length) throw new DOMException('Simulated quota', 'QuotaExceededError');
      return original.call(this, value, ...rest);
    };
  });
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '← 我的專案', exact: true }).click();
  await expect(page.locator('.project-transition-overlay')).toHaveCount(0);
  await expect(page.locator('.app-shell')).toBeVisible(); expect(new URL(page.url()).searchParams.get('project')).toBe(id);
  await expect(page.locator('.save-status')).toContainText('儲存失敗');
  await expect(page.getByRole('button', { name: '下載本視窗草稿', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__restorePut());
  await home(page); expect((await snapshot(page, id)).notes).toHaveLength(1);
});

test('an unmounted editor keeps its text when conflict-draft storage fails and blocks navigation until retry', async ({ page, context }) => {
  await page.goto('./'); const id = await create(page, 'Draft retry');
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  const peer = await context.newPage(); await peer.goto(page.url());
  await peer.getByRole('button', { name: '編輯便條', exact: true }).click();
  await peer.getByLabel('我的筆記', { exact: true }).fill('來源刪除後仍須保留的未存文字');
  await peer.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function(value, ...rest) {
      if (this.name === 'projectDrafts') throw new DOMException('Simulated quota', 'QuotaExceededError');
      return original.call(this, value, ...rest);
    };
  });
  await page.bringToFront();
  await page.getByRole('button', { name: '更多便條選項', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '刪除便條與標記', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await peer.bringToFront();
  await expect(peer.getByRole('dialog', { name: '編輯研究便條' })).toHaveCount(0);
  await expect(peer.locator('.save-status')).toContainText('儲存失敗');
  await peer.getByRole('button', { name: '← 我的專案', exact: true }).click();
  await expect(peer.locator('.project-transition-overlay')).toHaveCount(0);
  await expect(peer.locator('.app-shell')).toBeVisible();
  expect(new URL(peer.url()).searchParams.get('project')).toBe(id);
  const downloading = peer.waitForEvent('download');
  await peer.getByRole('button', { name: '下載本視窗草稿', exact: true }).click();
  expect(await readFile((await (await downloading).path())!, 'utf8')).toContain('來源刪除後仍須保留的未存文字');
  await peer.evaluate(() => (window as any).__restorePut());
  await home(peer);
  await peer.getByRole('button', { name: '進入專案 Draft retry' }).click();
  await expect(peer.locator('.project-transition-overlay')).toHaveCount(0);
  await peer.reload();
  await expect(peer.locator('.sync-conflict-notice')).toBeVisible();
  expect((await snapshot(peer)).notes).toHaveLength(0);
});

test('deleting a project invalidates its open peer and old URLs without affecting other projects', async ({ page, context }) => {
  await page.goto('./'); const a = await create(page, 'A'); await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  const peer = await context.newPage(); await peer.goto(page.url());
  await peer.getByRole('button', { name: '編輯便條', exact: true }).click(); await peer.getByLabel('我的筆記', { exact: true }).fill('未保存草稿');
  await home(page); await create(page, 'B'); await home(page);
  await page.getByRole('button', { name: '專案選單 A' }).click(); await page.getByRole('button', { name: '刪除專案', exact: true }).click();
  await page.getByRole('button', { name: '永久刪除專案' }).click();
  await expect(page.getByRole('button', { name: '進入專案 A', exact: true })).toHaveCount(0);
  await peer.bringToFront();
  await expect(peer.getByRole('heading', { name: '此專案不存在或已刪除' })).toBeVisible();
  const download = peer.waitForEvent('download'); await peer.getByRole('button', { name: '下載本視窗未儲存草稿' }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toContain('未保存草稿');
  peer.once('dialog', dialog => dialog.accept());
  await peer.reload(); await expect(peer.getByRole('heading', { name: '此專案不存在或已刪除' })).toBeVisible();
  expect(await snapshot(page, a)).toBeUndefined();
  await page.getByRole('button', { name: '進入專案 B' }).click(); await expect(page.locator('.app-shell')).toBeVisible();
});

test('late note AI responses never enter B or a newly opened A generation', async ({ page }) => {
  await page.goto('./'); await create(page, 'A'); await configure(page);
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '編輯便條', exact: true }).click(); await page.getByLabel('我的筆記', { exact: true }).fill('Analyze source A');
  await page.getByRole('button', { name: '儲存便條', exact: true }).click();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.route('https://api.openai.com/v1/responses', async route => { calls++; await gate; await route.fulfill({ json: response }).catch(() => {}); });
  await page.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true }).click(); await expect.poll(() => calls).toBe(1);
  await home(page); await create(page, 'B'); release();
  await expect(page.locator('.note-card')).toHaveCount(0); await home(page); await page.getByRole('button', { name: '進入專案 A' }).click();
  expect((await snapshot(page)).notes[0].translation).toBeUndefined();
  await expect(page.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true })).toBeEnabled();
});

test('busy sample import blocks history navigation and offline overview can reopen projects', async ({ page, context }) => {
  await page.goto('./'); const a = await create(page, 'Offline');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let fetching = false;
  await page.route('**/sample.pdf', async route => { fetching = true; await gate; await route.fulfill({ contentType: 'application/pdf', body: await readFile('public/sample.pdf') }); });
  await page.getByRole('button', { name: '先試讀一篇範例' }).click(); await expect.poll(() => fetching).toBe(true);
  await page.goBack(); await expect(page.locator('.toast')).toContainText('處理完成後');
  await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe(a);
  release(); await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await home(page); await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: '進入專案 Offline' }).click(); await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await context.setOffline(false);
});

test('same-ID document summary jobs run independently across projects, and only the leaving owner is paused', async ({ page, context }) => {
  await page.goto('./'); const a = await create(page, 'Owner A'); await sample(page); await configure(page);
  const backup = await snapshot(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let aCalls = 0;
  await page.route('https://api.openai.com/v1/responses', async route => { aCalls++; await gate; await route.fulfill({ json: response }).catch(() => {}); });
  await page.getByRole('button', { name: '全文摘要', exact: true }).click();
  await page.getByRole('button', { name: '同意傳送並生成', exact: true }).click();
  await expect.poll(() => aCalls).toBe(1);
  const peer = await context.newPage(); await peer.goto(page.url());
  await expect(peer.locator('.app-shell')).toBeVisible();
  await expect.poll(async () => (await snapshot(peer)).jobs[0]?.status).toBe('running');
  await home(peer); expect((await snapshot(page, a)).jobs[0].status).toBe('running');
  // JSON intentionally has the same document ID; its text remains available to AI.
  await peer.getByTestId('project-import-input').setInputFiles({ name: 'same.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(peer.locator('.app-shell')).toBeVisible();
  await expect(peer.locator('.project-transition-overlay')).toHaveCount(0);
  const b = new URL(peer.url()).searchParams.get('project')!; expect(b).not.toBe(a);
  await configure(peer); let bCalls = 0;
  await peer.route('https://api.openai.com/v1/responses', route => { bCalls++; return route.fulfill({ json: response }); });
  await peer.getByRole('button', { name: '全文摘要', exact: true }).click();
  await peer.getByRole('button', { name: '同意傳送並生成', exact: true }).click();
  await expect.poll(async () => (await snapshot(peer)).jobs[0]?.status).toBe('complete');
  expect(bCalls).toBeGreaterThanOrEqual(2); expect((await snapshot(page, a)).jobs[0].status).toBe('running');
  await page.bringToFront(); await home(page);
  expect((await snapshot(page, a)).jobs[0].status).toBe('paused');
  expect((await snapshot(peer, b)).jobs[0].status).toBe('complete'); release();
  expect((await snapshot(page, a)).notes).toHaveLength(0);
});

test('invalid imports leave no partial project and legacy URLs never fall back to another project', async ({ page }) => {
  await page.goto('./'); await create(page, 'Preserved'); await home(page);
  await page.getByTestId('project-import-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') });
  await expect(page.locator('.toast')).toContainText('匯入失敗'); await expect(page.locator('.project-card')).toHaveCount(1);
  await page.goto('./?view=reader&document=missing');
  await expect(page.getByRole('heading', { name: '此專案不存在或已刪除' })).toBeVisible();
  await expect(page.locator('.pdf-page')).toHaveCount(0);
  await page.getByRole('button', { name: '返回我的專案' }).click();
  await expect(page.getByRole('button', { name: '進入專案 Preserved' })).toBeVisible();
});

test('a real v6 installation retains its PDF, note and per-window reading view on upgrade', async ({ page, context }) => {
  await page.goto('./'); await expect(page.getByRole('heading', { name: '我的專案', exact: true })).toBeVisible();
  await page.evaluate(async bytes => {
    await new Promise<void>((resolve, reject) => { const drop = indexedDB.deleteDatabase('PaperReader'); drop.onsuccess = () => resolve(); drop.onerror = () => reject(drop.error); });
    const opening = indexedDB.open('PaperReader', 60);
    opening.onupgradeneeded = () => { for (const name of ['workspacesV2', 'documents', 'assets', 'sync', 'drafts']) opening.result.createObjectStore(name, { keyPath: 'id' }); };
    const db = await new Promise<IDBDatabase>((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    const buffer = new Uint8Array(bytes); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
    const date = '2026-01-01T00:00:00.000Z';
    const tx = db.transaction(['workspacesV2', 'documents', 'sync'], 'readwrite');
    tx.objectStore('workspacesV2').put({ schemaVersion: 2, id: 'default', title: '原有研究', updatedAt: date, activeDocumentId: 'legacy-pdf', viewport: { x: 90, y: 110, zoom: .75 },
      documents: [{ id: 'legacy-pdf', name: 'Legacy.pdf', size: buffer.length, sha256: hash, pageCount: 3, pages: ['Legacy page 1', 'Legacy page 2', 'Legacy page 3'], createdAt: date }],
      notes: [{ id: 'legacy-note', type: 'manual-note', title: '保留舊便條', userNotes: '原有筆記', originalText: '', position: { x: 0, y: 0 }, width: 320, tags: [], collapsed: false, hidden: false, color: 'yellow', updatedAt: date }],
      highlights: [], edges: [], jobs: [], pdfLayouts: [], pdfParagraphs: [], pdfTranslations: [], pdfTranslationJobs: [] });
    tx.objectStore('documents').put({ id: 'legacy-pdf', blob: new Blob([buffer], { type: 'application/pdf' }) });
    tx.objectStore('sync').put({ id: 'default', epoch: 'legacy-epoch', revision: 12 });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    sessionStorage.setItem('PaperReader.view', JSON.stringify({ activeDocumentId: 'legacy-pdf', viewport: { x: 90, y: 110, zoom: .75 } }));
    sessionStorage.setItem('PaperReader.readingPreferences', JSON.stringify({ lastPage: { 'legacy-pdf': 2 }, split: 60 }));
    sessionStorage.setItem('PaperReader.pdf.legacy-pdf.zoom', '1.5'); sessionStorage.setItem('PaperReader.pdf.legacy-pdf.rotation', '90');
  }, [...await readFile('public/sample.pdf')]);
  await page.goto('./?project=default');
  await expect(page.locator('.note-title')).toHaveText('保留舊便條'); await expect(page.locator('.notes-preview')).toHaveText('原有筆記');
  await expect(page.locator('.zoom-value')).toHaveText('150%'); await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rotation', '90');
  await expect(page.getByLabel('頁碼', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '60');
  await home(page); await expect(page.locator('.project-card')).toHaveCount(1); await expect(page.locator('.project-card')).toContainText('1 篇 PDF · 1 張便條');
  // A second legacy window must keep its own settings instead of adopting
  // the first window's recently persisted project view.
  const peer = await context.newPage();
  await peer.addInitScript(() => {
    sessionStorage.setItem('PaperReader.view', JSON.stringify({ activeDocumentId: 'legacy-pdf', viewport: { x: 10, y: 20, zoom: .9 } }));
    sessionStorage.setItem('PaperReader.readingPreferences', JSON.stringify({ lastPage: { 'legacy-pdf': 3 }, split: 65 }));
    sessionStorage.setItem('PaperReader.pdf.legacy-pdf.zoom', '1.25');
    sessionStorage.setItem('PaperReader.pdf.legacy-pdf.rotation', '180');
  });
  await peer.goto('./?project=default');
  await expect(peer.locator('.zoom-value')).toHaveText('125%');
  await expect(peer.locator('.pdf-page').first()).toHaveAttribute('data-rotation', '180');
  await expect(peer.getByLabel('頁碼', { exact: true })).toHaveValue('3');
  await expect(peer.getByRole('separator')).toHaveAttribute('aria-valuenow', '65');
  await peer.reload();
  await expect(peer.getByLabel('頁碼', { exact: true })).toHaveValue('3');
  await expect(peer.getByRole('separator')).toHaveAttribute('aria-valuenow', '65');
});

test('a connection test blocks browser history until its result returns', async ({ page }) => {
  await page.goto('./'); const id = await create(page, 'Connection'); await configure(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.route('https://api.openai.com/v1/responses', async route => { calls++; await gate; await route.fulfill({ json: response }); });
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click();
  await page.getByRole('button', { name: /測試連線/ }).click(); await expect.poll(() => calls).toBe(1);
  await page.goBack(); await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe(id);
  release(); await expect(page.locator('.settings-message')).toContainText('連線成功');
  await page.getByRole('button', { name: '完成', exact: true }).click(); await home(page);
});
