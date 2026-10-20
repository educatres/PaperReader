import { openProject } from './projectHelpers';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('mercuryapi detects models on key save, tests the selected model, translates and preserves portable results without keys', async ({ page }) => {
  const requests: { url: string; auth?: string; body: any }[] = [];
  await page.route('https://air.cgu.edu.tw/mercuryapi/v1/**', route => {
    const request = route.request();
    requests.push({ url: request.url(), auth: request.headers().authorization, body: request.postDataJSON() });
    return request.url().endsWith('/models')
      ? route.fulfill({ json: { data: [{ id: 'research/reading-v2' }, { id: 'gpt-text' }] } })
      : route.fulfill({ json: { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'Mercury 翻譯結果。' }] }], usage: { total_tokens: 18 } } });
  });
  await openProject(page);
  await page.getByRole('button', { name: '新增便條', exact: true }).click();
  await page.getByRole('button', { name: '編輯便條', exact: true }).click();
  await page.getByLabel('參考文字（選填）').fill('Source text for the Mercury provider.');
  await page.getByRole('button', { name: '儲存便條' }).click();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByLabel('你的 API key').fill('openai-mercury-isolation-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await page.getByRole('button', { name: 'mercuryapi', exact: true }).click();
  await expect(page.locator('.api-endpoint')).toHaveText('Base URLhttps://air.cgu.edu.tw/mercuryapi/v1');
  await expect(page.getByLabel('你的 API key')).toHaveValue('');
  await expect(page.getByRole('button', { name: '自動偵測模型', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
  await page.getByLabel('你的 API key').fill('sk-mercury-session-only-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await expect(page.locator('.settings-message')).toContainText('已取得 2 個模型');
  await expect(page.getByLabel('模型選項')).toHaveValue('gpt-text');
  expect(requests).toEqual([{ url: 'https://air.cgu.edu.tw/mercuryapi/v1/models', auth: 'Bearer sk-mercury-session-only-secret', body: null }]);
  await expect(page.getByLabel('你的 API key')).toHaveValue('');
  await expect(page.getByLabel('你的 API key')).toHaveAttribute('placeholder', '***');
  await page.getByLabel('模型選項').selectOption('research/reading-v2');
  await page.getByLabel('推理程度').selectOption('high');
  await page.getByRole('button', { name: '自動偵測模型', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('已取得 2 個模型');
  await expect(page.getByLabel('模型選項')).toHaveValue('research/reading-v2');
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(requests.at(-1)).toMatchObject({ url: 'https://air.cgu.edu.tw/mercuryapi/v1/responses', body: { model: 'research/reading-v2', store: false, reasoning: { effort: 'high' }, input: expect.stringContaining('connection test') } });
  await page.getByRole('dialog').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('dialog').screenshot({ path: 'test-results/mercuryapi-settings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('dialog').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('dialog').screenshot({ path: 'test-results/mercuryapi-settings-mobile.png' });
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const button of await page.locator('.provider-tabs > button').all()) await expect(button).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click();
  await expect(page.getByLabel('你的 API key')).toHaveAccessibleName(/本分頁已設定/);
  await page.getByRole('button', { name: 'mercuryapi', exact: true }).click();
  await expect(page.getByLabel('你的 API key')).toHaveAccessibleName(/本分頁已設定/);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true }).click();
  await expect(page.locator('.note-content')).toContainText('Mercury 翻譯結果。');
  expect(requests.at(-1)!.body.input).toContain('Source text for the Mercury provider.');
  expect(requests.every(r => r.auth === 'Bearer sk-mercury-session-only-secret')).toBe(true);
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON 註記資料/ }).click();
  const exported = await readFile((await (await downloading).path())!, 'utf8');
  expect(JSON.parse(exported).notes[0].translation).toMatchObject({ provider: 'mercuryapi', model: 'research/reading-v2', reasoningEffort: 'high', usage: 18 });
  expect(exported).not.toContain('secret');
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain('secret');
  await page.reload();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'mercuryapi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('選擇模型')).toHaveValue('research/reading-v2');
  await expect(page.getByLabel('你的 API key')).not.toHaveAccessibleName(/本分頁已設定/);
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
});

test('mercuryapi handles unavailable model lists and manual IDs without losing choices or exposing provider errors', async ({ page }) => {
  let mode: 'models' | 'empty' | 'invalid' | 'unauthorized' | 'network' = 'models';
  let testStatus = 200;
  const generated: any[] = [];
  await page.route('https://air.cgu.edu.tw/mercuryapi/v1/**', route => {
    if (route.request().method() === 'POST') {
      generated.push(route.request().postDataJSON());
      return testStatus === 200
        ? route.fulfill({ json: { output: [{ content: [{ type: 'output_text', text: 'OK' }] }] } })
        : route.fulfill({ status: testStatus, json: { error: { message: 'private-provider-error-with-secret' } } });
    }
    if (mode === 'network') return route.abort('failed');
    if (mode === 'unauthorized') return route.fulfill({ status: 401, json: { error: { message: 'private-provider-error-with-secret' } } });
    return route.fulfill({ json: mode === 'invalid' ? { data: [{ id: 42 }] } : { data: mode === 'empty' ? [] : [{ id: 'available-text' }] } });
  });
  await openProject(page);
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByRole('button', { name: 'mercuryapi', exact: true }).click();
  await page.getByLabel('你的 API key').fill('sk-mercury-error-test-secret');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await expect(page.getByLabel('模型選項')).toHaveValue('available-text');
  const detect = page.getByRole('button', { name: '自動偵測模型', exact: true });
  for (const failure of ['unauthorized', 'invalid', 'network'] as const) {
    mode = failure;
    await detect.click();
    await expect(page.locator('.settings-message.error')).toBeVisible();
    await expect(page.locator('.settings-message')).not.toContainText('private-provider-error');
    await expect(page.getByLabel('模型選項')).toHaveValue('available-text');
  }
  mode = 'empty';
  await detect.click();
  await expect(page.locator('.settings-message')).toContainText('目前沒有可用模型');
  await expect(page.getByLabel('模型選項')).toHaveValue('');
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
  await page.getByLabel('選擇模型').fill('manual/text-v3');
  await expect(page.getByLabel('模型選項')).toHaveValue('manual/text-v3');
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(generated[0]).toMatchObject({ model: 'manual/text-v3' });
  testStatus = 429;
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message.error')).toContainText('429');
  await expect(page.locator('.settings-message')).not.toContainText('private-provider-error');
  await expect(page.getByLabel('選擇模型')).toHaveValue('manual/text-v3');
  await page.getByRole('button', { name: '清除本機 API Key', exact: true }).click();
  await expect(detect).toBeDisabled();
  await expect(page.getByRole('button', { name: /測試連線/ })).toBeDisabled();
});
