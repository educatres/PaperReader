import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createBridge, BRIDGE_PORT } from '../public/PaperReader-CGU-Bridge.mjs';

// A real loopback HTTP server with a fake upstream: no private keys or CGU charges.
let bridge: ReturnType<typeof createBridge>;
let calls: { url: string; init: RequestInit }[] = [];
let modelStatus = 200;
test.beforeAll(async () => {
  bridge = createBridge({ fetchUpstream: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/models')) return Response.json(modelStatus === 200 ? { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-5.6-luna' }] } : { error: { message: 'private-provider-error' } }, { status: modelStatus });
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '本機助手文字摘要測試成功。' }] }] });
  } });
  await new Promise<void>((resolve, reject) => { bridge.server.once('error', reject); bridge.server.listen(BRIDGE_PORT, '127.0.0.1', resolve); });
});
test.afterAll(async () => {
  const closed = new Promise<void>(resolve => bridge.server.close(resolve));
  bridge.server.closeAllConnections(); await closed;
});
test.beforeEach(async ({ context }) => {
  calls = []; modelStatus = 200;
  // Equivalent to the user accepting the browser's local network permission prompt.
  await context.grantPermissions(['local-network-access']);
});
async function open(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByRole('button', { name: 'CGU API', exact: true }).click();
  await expect(page.getByLabel('CGU 連線方式')).toHaveValue('localhost');
}
async function pair(page: Page) {
  await page.getByLabel('本機助手連線碼').fill(bridge.pairingCode);
  await page.getByRole('button', { name: '連接本機助手', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('本機助手已連接');
}

test('real localhost transport verifies normalized keys, generates text and forgets secrets on reload', async ({ page }) => {
  const direct: string[] = []; const healthAuth: (string | undefined)[] = [];
  await page.route('https://air.cgu.edu.tw/cgullmapi/v1/**', route => { direct.push(route.request().url()); return route.abort(); });
  page.on('request', req => { if (req.url() === `http://127.0.0.1:${BRIDGE_PORT}/health`) healthAuth.push(req.headers().authorization); });
  await open(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: '下載本機助手', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('PaperReader-CGU-Bridge.mjs');
  expect(await readFile((await download.path())!, 'utf8')).toBe(await readFile('public/PaperReader-CGU-Bridge.mjs', 'utf8'));
  await pair(page);
  expect(calls).toHaveLength(0);
  for (const key of ['test-cgu-only-in-memory', 'Bearer test-cgu-only-in-memory', 'Authorization: Bearer test-cgu-only-in-memory']) {
    await page.getByLabel('你的 API key').fill(key);
    await page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
    await expect(page.locator('.settings-message')).toContainText('CGU 金鑰已通過驗證');
    await expect(page.getByLabel('你的 API key')).toHaveValue('');
    expect(calls.at(-1)!.init.headers).toMatchObject({ Authorization: 'Bearer test-cgu-only-in-memory' });
  }
  expect(calls.every(c => c.url.endsWith('/models'))).toBe(true);
  await page.getByLabel('推理程度').selectOption('high');
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(JSON.parse(calls.at(-1)!.init.body as string)).toMatchObject({ model: 'gpt-6-luna', store: false, reasoning: { effort: 'high' } });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '編輯便條', exact: true }).click();
  await page.getByLabel('參考文字（選填）').fill('Text-only research evidence.');
  await page.getByRole('button', { name: '儲存便條', exact: true }).click();
  await page.locator('.note-footer').getByRole('button', { name: '摘要', exact: true }).click();
  await expect(page.locator('.note-content')).toContainText('本機助手文字摘要測試成功');
  expect(JSON.parse(calls.at(-1)!.init.body as string).input).toContain('Text-only research evidence.');
  expect(direct).toEqual([]);
  expect(healthAuth.length).toBeGreaterThan(3); expect(healthAuth.every(h => !h)).toBe(true);
  expect(calls.every(c => !JSON.stringify(c.init).includes(bridge.pairingCode))).toBe(true);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  const storage = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('PaperReader'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const records = await new Promise(resolve => { const r = db.transaction('workspaces').objectStore('workspaces').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, records });
  });
  expect(storage).not.toContain('test-cgu-only-in-memory'); expect(storage).not.toContain(bridge.pairingCode);
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const exporting = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON 註記資料/ }).click();
  const json = await readFile((await (await exporting).path())!, 'utf8');
  expect(json).not.toContain('test-cgu-only-in-memory'); expect(json).not.toContain(bridge.pairingCode);
  await page.reload();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await expect(page.getByLabel('CGU 連線方式')).toHaveValue('localhost');
  await expect(page.getByLabel('推理程度')).toHaveValue('high');
  await expect(page.getByLabel('你的 API key')).not.toHaveAccessibleName(/本分頁已設定/);
  await expect(page.getByLabel('本機助手連線碼')).toHaveValue('');
  await expect(page.getByRole('button', { name: '連接本機助手', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('dialog').screenshot({ path: 'test-results/cgu-bridge-mobile.png' });
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('bad pairing, invalid pasted keys, CGU status errors and unavailable models do not trigger generation', async ({ page }) => {
  await open(page);
  await page.getByLabel('本機助手連線碼').fill('w'.repeat(32));
  await page.getByRole('button', { name: '連接本機助手', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('連線碼不符');
  await page.getByLabel('你的 API key').fill('Bearer test-cgu-only-in-memory');
  await page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('請先啟動本機助手');
  expect(calls).toHaveLength(0);
  await pair(page);
  await page.getByLabel('你的 API key').fill('invalid key with spaces');
  await page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('格式不正確');
  expect(calls).toHaveLength(0);
  await page.getByLabel('你的 API key').fill('test-cgu-only-in-memory');
  for (const [status, message] of [[401, '金鑰驗證失敗'], [403, 'Token 額度'], [404, 'Responses API']] as const) {
    modelStatus = status;
    await page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
    await expect(page.locator('.settings-message')).toContainText(message);
    await expect(page.locator('.settings-message')).not.toContainText('private-provider-error');
  }
  modelStatus = 200;
  await page.getByLabel('選擇模型').fill('unavailable-model');
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('目前模型不在帳戶可用清單中');
  expect(calls.every(c => c.url.endsWith('/models'))).toBe(true);
  await page.getByRole('button', { name: '清除本機 API Key', exact: true }).click();
  await expect(page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '清除配對', exact: true }).click();
  await expect(page.getByRole('button', { name: '連接本機助手', exact: true })).toBeDisabled();
});

test('unreachable helper explains startup and local network permission without sending a key', async ({ page }) => {
  await page.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, route => route.abort('connectionrefused'));
  await open(page);
  await page.getByLabel('本機助手連線碼').fill(bridge.pairingCode);
  await page.getByRole('button', { name: '連接本機助手', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('無法連到本機助手');
  await expect(page.locator('.settings-message')).toContainText('本機網路權限');
  expect(calls).toHaveLength(0);
});
