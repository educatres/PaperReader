import { openProject } from './projectHelpers';
import { expect, test } from '@playwright/test';

test('old CGU settings use direct HTTPS for normalized key verification and generation', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('PaperReader.preferences')) localStorage.setItem('PaperReader.preferences', JSON.stringify({
      provider: 'cgu', cguConnection: 'localhost', models: { cgu: 'gpt-5.6-luna' }, reasoningEffort: 'high',
    }));
  });
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const loopback: string[] = [];
  page.on('request', request => { if (new URL(request.url()).port === '43127') loopback.push(request.url()); });
  await page.route('https://air.cgu.edu.tw/cgullmapi/v1/**', route => {
    const request = route.request();
    calls.push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    return request.url().endsWith('/models')
      ? route.fulfill({ json: { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-5.6-luna' }] } })
      : route.fulfill({ json: { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'OK' }] }] } });
  });
  await openProject(page);
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('瀏覽器直接連線至 CGU API');
  await expect(dialog).not.toContainText('本機助手');
  await expect(page.getByLabel('CGU 連線方式')).toHaveCount(0);
  await expect(page.getByLabel('選擇模型')).toHaveValue('gpt-5.6-luna');
  await expect(page.getByLabel('推理程度')).toHaveValue('high');
  for (const key of ['test-cgu-session-secret', 'Bearer test-cgu-session-secret', 'Authorization: Bearer test-cgu-session-secret']) {
    await page.getByLabel('你的 API key').fill(key);
    await page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
    await expect(page.locator('.settings-message')).toContainText('CGU 金鑰已通過驗證');
    await expect(page.getByLabel('你的 API key')).toHaveValue('');
  }
  expect(calls).toHaveLength(3);
  expect(calls.every(call => call.url.endsWith('/models'))).toBe(true);
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('連線成功');
  expect(calls.at(-1)).toMatchObject({ url: 'https://air.cgu.edu.tw/cgullmapi/v1/responses', body: { model: 'gpt-5.6-luna', store: false, reasoning: { effort: 'high' } } });
  expect(calls.every(call => call.headers.authorization === 'Bearer test-cgu-session-secret' && !call.headers['x-paperreader-token'])).toBe(true);
  expect(loopback).toEqual([]);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).not.toContain('43127');
  await page.getByLabel('推理程度').selectOption('low');
  const stored = await page.evaluate(() => localStorage.getItem('PaperReader.preferences'));
  expect(stored).not.toContain('cguConnection');
  expect(stored).not.toContain('test-cgu-session-secret');
  await page.reload();
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await expect(page.getByLabel('選擇模型')).toHaveValue('gpt-5.6-luna');
  await expect(page.getByLabel('推理程度')).toHaveValue('low');
  await expect(page.getByLabel('你的 API key')).not.toHaveAccessibleName(/本分頁已設定/);
  await expect(page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true })).toBeDisabled();
});

test('CGU direct verification handles invalid keys, status errors and unavailable models before generation', async ({ page }) => {
  let status = 200;
  const requests: string[] = [];
  await page.route('https://air.cgu.edu.tw/cgullmapi/v1/**', route => {
    requests.push(route.request().url());
    return route.fulfill({ status, json: status === 200 ? { data: [{ id: 'gpt-6-luna' }] } : { error: { message: 'private-provider-error' } } });
  });
  await openProject(page);
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByRole('button', { name: 'CGU API', exact: true }).click();
  await page.getByLabel('你的 API key').fill('invalid key with spaces');
  await page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
  await expect(page.locator('.settings-message')).toContainText('格式不正確');
  expect(requests).toHaveLength(0);
  await page.getByLabel('你的 API key').fill('test-cgu-session-secret');
  for (const [code, message] of [[401, '金鑰驗證失敗'], [403, 'Token 額度'], [404, 'Responses API']] as const) {
    status = code;
    await page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
    await expect(page.locator('.settings-message')).toContainText(message);
    await expect(page.locator('.settings-message')).not.toContainText('private-provider-error');
  }
  status = 200;
  await page.getByLabel('選擇模型').fill('unavailable-model');
  await page.getByRole('button', { name: /測試連線/ }).click();
  await expect(page.locator('.settings-message')).toContainText('目前模型不在帳戶可用清單中');
  expect(requests.every(url => url.endsWith('/models'))).toBe(true);
  await page.getByRole('button', { name: '清除本機 API Key', exact: true }).click();
  await expect(page.getByRole('button', { name: '驗證 CGU 金鑰', exact: true })).toBeDisabled();
});
