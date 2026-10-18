import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('top toolbar collapses, persists, and remains recoverable on narrow screens', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '先試讀一篇範例' }).click();
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  const initial = await page.locator('.pdf-pane').boundingBox();
  await page.getByRole('button', { name: '隱藏工具列', exact: true }).click();
  await expect(page.locator('#top-toolbar')).toBeHidden();
  await expect(page.getByRole('button', { name: '展開工具列', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect((await page.locator('.pdf-pane').boundingBox())!.height - initial!.height).toBe(86);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await page.reload();
  await expect(page.locator('#top-toolbar')).toBeHidden();
  await expect(page.locator('.pdf-page .textLayer span').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/collapsed-desktop.png' });
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '文獻庫', exact: true }).click();
    const library = await page.locator('.library').boundingBox();
    const nav = await page.getByRole('navigation', { name: '文獻管理' }).boundingBox();
    expect(library!.y).toBe(nav!.y + nav!.height);
    await page.getByRole('button', { name: '關閉文獻庫', exact: true }).click();
  }
  await page.screenshot({ path: 'test-results/collapsed-mobile.png' });
  await page.getByRole('button', { name: '展開工具列', exact: true }).click();
  await expect(page.locator('#top-toolbar')).toBeVisible();
  await expect(page.getByRole('button', { name: '隱藏工具列', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByRole('button', { name: 'CGU API', exact: true }).click();
  await expect(page.getByLabel('模型選項')).toBeVisible();
  await expect(page.getByLabel('推理程度')).toBeVisible();
  await page.getByRole('dialog').screenshot({ path: 'test-results/cgu-settings-mobile.png' });
});

test('CGU presets, custom models and reasoning use direct Responses with isolated session keys', async ({ page }) => {
  const requests: { url: string; auth?: string; body: any }[] = [];
  await page.route('https://air.cgu.edu.tw/cgullmapi/v1/**', route => {
    const request = route.request();
    requests.push({ url: request.url(), auth: request.headers().authorization, body: request.postDataJSON() });
    return request.url().endsWith('/models')
      ? route.fulfill({ json: { data: [{ id: 'department/research-v2' }, { id: 'gpt-6-luna' }, { id: 'gpt-5.6-luna' }] } })
      : route.fulfill({ json: { status: 'completed', output: [{ type: 'reasoning', content: [] }, { content: [{ type: 'output_text', text: 'CGU 測試翻譯。' }] }], usage: { total_tokens: 30 } } });
  });
  await page.goto('./');
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '編輯便條', exact: true }).click();
  await page.getByLabel('參考文字（選填）').fill('Research source for translation.');
  await page.getByRole('button', { name: '儲存便條' }).click();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByLabel('你的 API key').fill('openai-secret-never-persist');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await page.getByRole('button', { name: 'CGU API', exact: true }).click();
  await expect(page.locator('.api-endpoint')).toContainText('https://air.cgu.edu.tw/cgullmapi/v1');
  await page.getByLabel('CGU 連線方式').selectOption('direct');
  await expect(page.getByLabel('你的 API key')).toHaveValue('');
  await expect(page.getByLabel('你的 API key')).not.toHaveAccessibleName(/本分頁已設定/);
  await expect(page.getByLabel('模型選項')).toHaveValue('gpt-6-luna');
  await expect(page.getByLabel('推理程度')).toHaveValue('medium');
  await page.getByLabel('你的 API key').fill('cgu-secret-never-persist');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(requests.at(-1)!.body).toMatchObject({ model: 'gpt-6-luna', store: false, reasoning: { effort: 'medium' } });
  await page.getByLabel('模型選項').selectOption('gpt-5.6-luna');
  await page.getByLabel('推理程度').selectOption('high');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true }).click();
  await expect(page.locator('.note-content')).toContainText('CGU 測試翻譯。');
  expect(requests.at(-1)!.body).toMatchObject({ model: 'gpt-5.6-luna', reasoning: { effort: 'high' } });
  expect(requests.at(-1)!.body.input).toContain('Research source for translation.');
  await page.getByRole('button', { name: 'CGU API', exact: true }).click();
  await page.getByRole('button', { name: '取得模型清單' }).click();
  await expect(page.locator('.settings-message')).toContainText('已取得 3 個模型');
  await page.getByLabel('模型選項').selectOption('custom');
  await page.getByLabel('選擇模型').fill('department/research-v2');
  await page.getByLabel('推理程度').selectOption('low');
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(requests.at(-1)!.body).toMatchObject({ model: 'department/research-v2', reasoning: { effort: 'low' } });
  expect(requests.every(r => r.auth === 'Bearer cgu-secret-never-persist')).toBe(true);
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click();
  await expect(page.getByLabel('你的 API key')).toHaveAccessibleName(/本分頁已設定/);
  await page.getByRole('button', { name: 'Google Gemini', exact: true }).click();
  await expect(page.getByLabel('推理程度')).toBeDisabled();
  await page.getByRole('button', { name: 'CGU API', exact: true }).click();
  await page.getByRole('dialog').screenshot({ path: 'test-results/cgu-settings-desktop.png' });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.route('https://air.cgu.edu.tw/cgullmapi/v1/responses', route => route.abort('failed'));
  await page.locator('.note-footer').getByRole('button', { name: '摘要', exact: true }).click();
  await expect(page.locator('.note-card .inline-error')).toContainText('CORS');
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  const persisted = await page.evaluate(async () => {
    const open = indexedDB.open('PaperReader');
    const db: IDBDatabase = await new Promise(resolve => { open.onsuccess = () => resolve(open.result); });
    const read = db.transaction('workspaces').objectStore('workspaces').getAll();
    const data = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
    db.close();
    return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, data });
  });
  expect(persisted).not.toContain('secret-never-persist');
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON 註記資料/ }).click();
  const exported = await readFile((await (await downloading).path())!, 'utf8');
  expect(exported).not.toContain('secret-never-persist');
  expect(JSON.parse(exported).notes[0].translation).toMatchObject({ provider: 'cgu', model: 'gpt-5.6-luna', reasoningEffort: 'high' });
  await page.reload();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await expect(page.getByLabel('選擇模型')).toHaveValue('department/research-v2');
  await expect(page.getByLabel('推理程度')).toHaveValue('low');
  await expect(page.getByLabel('你的 API key')).not.toHaveAccessibleName(/本分頁已設定/);
});

test('older preferences retain custom models and adopt medium reasoning', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('PaperReader.preferences', JSON.stringify({ provider: 'openai', models: { openai: 'my-existing-model', gemini: 'my-gemini' }, split: 60, lastPage: {} }));
  });
  await page.goto('./');
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await expect(page.getByLabel('選擇模型')).toHaveValue('my-existing-model');
  await expect(page.getByLabel('模型選項')).toHaveValue('custom');
  await expect(page.getByLabel('推理程度')).toHaveValue('medium');
  await page.getByRole('button', { name: 'CGU API', exact: true }).click();
  await expect(page.getByLabel('選擇模型')).toHaveValue('gpt-6-luna');
  await page.getByRole('button', { name: 'Google Gemini', exact: true }).click();
  await expect(page.getByLabel('選擇模型')).toHaveValue('my-gemini');
});
