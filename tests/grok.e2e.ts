import { openProject } from './projectHelpers';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyWorkspace, now, type Note } from '../src/types';

const textModel = (id: string) => ({ id, input_modalities: ['text', 'image'], output_modalities: ['text'] });
const response = (text = 'Grok 研究結果。') => ({ status: 'completed', output: [
  { type: 'reasoning', encrypted_content: 'private-reasoning' },
  { type: 'message', content: [{ type: 'output_text', text }] },
], usage: { total_tokens: 42 } });

test('Grok detects language models, generates note results, and retains settings without persisting keys', async ({ page }) => {
  const requests: { url: string; auth?: string; body: any }[] = [];
  await page.route('https://api.x.ai/v1/**', route => {
    const request = route.request();
    requests.push({ url: request.url(), auth: request.headers().authorization, body: request.postDataJSON() });
    return request.url().endsWith('/language-models')
      ? route.fulfill({ json: { models: [textModel('grok-text-b'), textModel('grok-text-a'), { id: 'grok-image', input_modalities: ['text'], output_modalities: ['image'] }] } })
      : route.fulfill({ json: response() });
  });
  await openProject(page);
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '編輯便條', exact: true }).click();
  await page.getByLabel('參考文字（選填）').fill('Source text for Grok translation and summary.');
  await page.getByRole('button', { name: '儲存便條' }).click();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByLabel('你的 API key').fill('openai-grok-isolation-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await page.getByLabel('推理程度').selectOption('high');
  await page.getByRole('button', { name: 'Grok（xAI）', exact: true }).click();
  await expect(page.locator('.api-endpoint')).toHaveText('Base URLhttps://api.x.ai/v1');
  await expect(page.getByLabel('你的 API key')).toHaveAttribute('placeholder', 'xai-…');
  await expect(page.getByLabel('推理程度')).toBeDisabled();
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
  await expect(page.getByRole('link', { name: /取得 Grok/ })).toHaveAttribute('href', 'https://console.x.ai/');
  await page.getByLabel('你的 API key').fill('xai-session-only-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await expect(page.locator('.settings-message')).toContainText('已取得 2 個模型');
  await expect(page.getByLabel('模型選項')).toHaveValue('grok-text-a');
  expect(requests).toEqual([{ url: 'https://api.x.ai/v1/language-models', auth: 'Bearer xai-session-only-secret', body: null }]);
  await expect(page.getByLabel('你的 API key')).toHaveValue('');
  await expect(page.getByLabel('你的 API key')).toHaveAttribute('placeholder', '***');
  await page.getByLabel('模型選項').selectOption('grok-text-b');
  await page.getByRole('button', { name: '自動偵測模型', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('已取得 2 個模型');
  await expect(page.getByLabel('模型選項')).toHaveValue('grok-text-b');
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(requests.at(-1)).toMatchObject({ url: 'https://api.x.ai/v1/responses', body: { model: 'grok-text-b', store: false, instructions: expect.stringContaining('繁體中文'), input: expect.stringContaining('connection test') } });
  await page.getByRole('dialog').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('dialog').screenshot({ path: 'test-results/grok-settings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('dialog').evaluate(el => { el.scrollTop = 0; });
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const button of await page.locator('.provider-tabs > button').all()) await expect(button).toBeInViewport();
  await page.getByRole('dialog').screenshot({ path: 'test-results/grok-settings-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click();
  await expect(page.getByLabel('你的 API key')).toHaveAccessibleName(/本分頁已設定/);
  await expect(page.getByLabel('推理程度')).toHaveValue('high');
  await page.getByRole('button', { name: 'Grok（xAI）', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  for (const action of ['翻譯', '摘要']) {
    await page.locator('.note-footer').getByRole('button', { name: action, exact: true }).click();
    await expect(page.locator('.note-tabs .active')).toHaveText(action);
    await expect(page.locator('.note-content')).toContainText('Grok 研究結果。');
    await expect.poll(() => requests.filter(r => r.body).length).toBe(action === '翻譯' ? 2 : 3);
    expect(requests.at(-1)!.body.input).toContain('Source text for Grok translation and summary.');
  }
  for (const request of requests) {
    expect(request.auth).toBe('Bearer xai-session-only-secret');
    if (request.body) { expect(request.body).not.toHaveProperty('reasoning'); expect(request.body).not.toHaveProperty('reasoning_effort'); }
  }
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON 註記資料/ }).click();
  const exported = await readFile((await (await downloading).path())!, 'utf8');
  const saved = JSON.parse(exported).notes[0];
  for (const result of [saved.translation, saved.summary]) {
    expect(result).toMatchObject({ provider: 'grok', model: 'grok-text-b', usage: 42 });
    expect(result).not.toHaveProperty('reasoningEffort');
  }
  expect(exported).not.toContain('secret');
  expect(exported).not.toContain('private-reasoning');
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('secret');
  await page.reload();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grok（xAI）', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('選擇模型')).toHaveValue('grok-text-b');
  await expect(page.getByLabel('你的 API key')).not.toHaveAccessibleName(/本分頁已設定/);
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
});

test('Grok preserves selections and prior results when model discovery or generation fails', async ({ page }) => {
  let mode: 'models' | 'empty' | 'invalid' | 'unauthorized' | 'network' = 'models';
  let generation: number | 'incomplete' | 'empty' = 200;
  const generated: any[] = [];
  await page.route('https://api.x.ai/v1/**', route => {
    if (route.request().method() === 'POST') {
      generated.push(route.request().postDataJSON());
      if (typeof generation === 'number' && generation !== 200) return route.fulfill({ status: generation, json: { error: { message: 'private-error-with-secret' } } });
      return route.fulfill({ json: generation === 'empty' ? response('') : { ...response(), ...(generation === 'incomplete' ? { status: 'incomplete' } : {}) } });
    }
    if (mode === 'network') return route.abort('failed');
    if (mode === 'unauthorized') return route.fulfill({ status: 401, json: { error: { message: 'private-error-with-secret' } } });
    return route.fulfill({ json: mode === 'invalid' ? { models: [{ id: 42 }] } : { models: mode === 'empty' ? [] : [textModel('grok-text')] } });
  });
  await openProject(page);
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '編輯便條', exact: true }).click();
  await page.getByLabel('參考文字（選填）').fill('Evidence to preserve.');
  await page.getByRole('button', { name: '儲存便條' }).click();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByRole('button', { name: 'Grok（xAI）', exact: true }).click();
  await page.getByLabel('你的 API key').fill('xai-failure-test-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await expect(page.getByLabel('模型選項')).toHaveValue('grok-text');
  const detect = page.getByRole('button', { name: '自動偵測模型', exact: true });
  for (const failure of ['unauthorized', 'invalid', 'network'] as const) {
    mode = failure; await detect.click();
    await expect(page.locator('.settings-message.error')).toBeVisible();
    await expect(page.locator('.settings-message')).not.toContainText('private-error');
    await expect(page.getByLabel('選擇模型')).toHaveValue('grok-text');
  }
  mode = 'empty'; await detect.click();
  await expect(page.locator('.settings-message')).toContainText('目前沒有可用模型');
  await expect(page.getByLabel('選擇模型')).toHaveValue('');
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
  await page.getByLabel('選擇模型').fill('grok-custom-model');
  for (const failure of [401, 403, 404, 429, 500, 'incomplete', 'empty'] as const) {
    generation = failure;
    await page.getByRole('button', { name: /測試連線/ }).click();
    await expect(page.locator('.settings-message.error')).toBeVisible();
    await expect(page.locator('.settings-message')).not.toContainText('private-error');
    await expect(page.getByLabel('選擇模型')).toHaveValue('grok-custom-model');
  }
  generation = 200;
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(generated.at(-1)).toMatchObject({ model: 'grok-custom-model' });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true }).click();
  await expect(page.locator('.note-content')).toContainText('Grok 研究結果。');
  generation = 'incomplete';
  await page.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true }).click();
  await expect(page.locator('.note-card .inline-error')).toContainText('模型未能完成回應');
  await expect(page.locator('.note-content')).toContainText('Grok 研究結果。');
  await page.getByRole('button', { name: 'Grok（xAI）', exact: true }).click();
  await page.getByRole('button', { name: '清除本機 API Key', exact: true }).click();
  await expect(detect).toBeDisabled();
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
});

test('Grok uses model-default reasoning in document and connected-note summaries', async ({ page }) => {
  const generated: any[] = [];
  await page.route('https://api.x.ai/v1/**', route => {
    if (route.request().url().endsWith('/language-models')) return route.fulfill({ json: { models: [textModel('grok-text')] } });
    generated.push(route.request().postDataJSON());
    return route.fulfill({ json: response('Grok 整合結果 [N1][N2]。') });
  });
  await openProject(page);
  await page.getByRole('button', { name: '先試讀一篇範例' }).click();
  await expect(page.locator('.pdf-page').first()).toBeVisible();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByRole('button', { name: 'Grok（xAI）', exact: true }).click();
  await page.getByLabel('你的 API key').fill('xai-summary-test-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await expect(page.getByLabel('選擇模型')).toHaveValue('grok-text');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '全文摘要', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('grok-text · 依模型預設推理');
  await page.getByRole('button', { name: '同意傳送並生成' }).click();
  await expect(page.locator('.note-card')).toContainText('全文總覽');
  await expect(page.locator('.note-content')).toContainText('Grok 整合結果');
  expect(generated.length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON 註記資料/ }).click();
  const exported = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(exported.jobs[0]).toMatchObject({ provider: 'grok', model: 'grok-text', status: 'complete' });
  expect(exported.jobs[0]).not.toHaveProperty('reasoningEffort');

  const w = emptyWorkspace();
  const note = (id: string, x: number): Note => ({ id, type: 'manual-note', title: id, originalText: `Evidence from ${id}.`, userNotes: '', tags: [], position: { x, y: 0 }, width: 320, collapsed: false, hidden: false, color: 'yellow', updatedAt: now() });
  w.notes = [note('source-a', 0), note('source-b', 380)];
  w.edges = [{ id: 'support', source: 'source-a', target: 'source-b', relationType: '支持', label: 'Related evidence', directed: true, createdBy: 'user', createdAt: now(), updatedAt: now() }];
  page.on('dialog', d => d.accept());
  await page.getByTestId('restore-input').setInputFiles({ name: 'grok-group.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(w)) });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(2);
  await page.locator('[data-note-id="source-a"] .note-title').click();
  await page.getByRole('button', { name: '關聯摘要', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('grok-text · 依模型預設推理');
  await page.getByRole('button', { name: '同意傳送並整合' }).click();
  await expect(page.locator('.group-summary-note')).toContainText('Grok 整合結果');
  expect(generated.at(-1).input).toContain('Related evidence');
  for (const body of generated) {
    expect(body).toMatchObject({ model: 'grok-text', store: false });
    expect(body).not.toHaveProperty('reasoning');
  }
});
