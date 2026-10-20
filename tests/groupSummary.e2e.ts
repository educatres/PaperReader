import { openProject } from './projectHelpers';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyWorkspace, now, type Note, type Relation } from '../src/types';

function fixture() {
  const w = emptyWorkspace(); w.viewport = { x: 0, y: 0, zoom: 0.6 };
  const note = (id: string, title: string, x: number, y: number, extra: Partial<Note> = {}): Note => ({ id, title, type: 'manual-note', originalText: '', userNotes: '', tags: [], position: { x, y }, width: 320, hidden: false, collapsed: false, color: 'yellow', updatedAt: now(), ...extra });
  w.notes = [
    note('source-a', 'Evidence A', 40, 40, { originalText: 'Trial A reports a positive effect in adults.', userNotes: 'Check the study population.', tags: ['evidence'] }),
    note('source-b', 'Interpretation B', 420, 40, { userNotes: 'The evidence supports a limited application.', summary: { text: 'Prior AI summary B', provider: 'openai', model: 'gpt-6-luna', createdAt: now() } }),
    note('source-c', 'Counterpoint C', 40, 450, { originalText: 'Trial C reports no effect in children.', translation: { text: '兒童試驗未發現效果。', provider: 'openai', model: 'gpt-6-luna', createdAt: now() } }),
    note('outside', 'Unrelated note', 420, 450, { userNotes: 'OUTSIDE_DO_NOT_SEND' }),
    note('hidden', 'Hidden note', 800, 40, { hidden: true, userNotes: 'HIDDEN_DO_NOT_SEND' }),
  ];
  const relation = (id: string, source: string, target: string, relationType: Relation['relationType'], label: string, directed: boolean): Relation => ({ id, source, target, relationType, label, directed, createdBy: 'user', createdAt: now(), updatedAt: now() });
  w.edges = [relation('support', 'source-a', 'source-b', '支持', 'Adult evidence supports a restricted interpretation', true),
    relation('contrast', 'source-b', 'source-c', '對比', 'Different populations may explain the discrepancy', false), relation('hidden-link', 'source-b', 'hidden', '待驗證', 'Hidden speculation', true)];
  return w;
}
async function load(page: Page) {
  page.on('dialog', d => d.accept());
  await openProject(page);
  await page.getByTestId('restore-input').setInputFiles({ name: 'connected-notes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture())) });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect(page.locator('.note-card')).toHaveCount(4);
}
async function configure(page: Page) {
  await page.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await page.getByLabel('你的 API key').fill('group-secret-never-persist');
  await page.getByRole('button', { name: '使用此金鑰' }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
async function preview(page: Page) {
  await page.locator('[data-note-id="source-a"] .note-title').click();
  await page.getByRole('button', { name: '關聯摘要', exact: true }).click();
  return page.getByRole('dialog', { name: '整合這組關聯便條' });
}
const response = { status: 'completed', output: [{ content: [{ type: 'output_text', text: '綜合摘要\n成人研究支持有限度的應用 [N1][N2][R1]。\n關係分析\n不同族群可能影響結果 [N2][N3][R2]。\n分歧與待驗證\n兒童結果不可直接套用成人結論。\n後續思考\n需核對各研究的適用條件。' }] }], usage: { total_tokens: 120 } };

test('connected-note synthesis respects relationships, creates a distinct card, and roundtrips provenance', async ({ page }) => {
  await load(page); await configure(page);
  let body: any;
  await page.route('https://api.openai.com/v1/responses', route => { body = route.request().postDataJSON(); return route.fulfill({ json: response }); });
  const dialog = await preview(page);
  await expect(dialog).toContainText('3 張便條 · 2 條關係');
  await expect(dialog.getByRole('list', { name: '將摘要的便條' }).locator('li')).toHaveCount(3);
  await expect(dialog.getByRole('list', { name: '將參考的連線' })).toContainText('N1 → N2');
  await expect(dialog.getByRole('list', { name: '將參考的連線' })).toContainText('N2 ↔ N3');
  await expect(dialog).toContainText('支持'); await expect(dialog).toContainText('對比');
  await expect(dialog).not.toContainText('Hidden note'); await expect(dialog).not.toContainText('Unrelated note');
  await dialog.screenshot({ path: 'test-results/group-summary-preview.png' });
  await dialog.getByRole('button', { name: '同意傳送並整合' }).click();
  const group = page.locator('.group-summary-note');
  await expect(group).toHaveCount(1); await expect(group.locator('.note-content')).toContainText('不同族群可能影響結果');
  expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, reasoning: { effort: 'medium' } });
  expect(body.input).toContain('"relationType": "支持"'); expect(body.input).toContain('"relationType": "對比"');
  expect(body.input).toContain('Adult evidence supports a restricted interpretation');
  expect(body.input).toContain('"directed": true'); expect(body.input).toContain('"directed": false');
  expect(body.input).toContain('Prior AI summary B'); expect(body.input).toContain('兒童試驗未發現效果。');
  expect(body.input).not.toContain('DO_NOT_SEND'); expect(body.input).not.toContain('group-secret');
  await expect(group).toContainText('AI 關聯整合');
  await expect(group.getByRole('button', { name: /定位來源 N/ })).toHaveCount(3);
  await expect(group).toBeInViewport();
  await page.screenshot({ path: 'test-results/group-summary-card.png' });
  await group.getByRole('button', { name: '來源快照', exact: true }).click();
  await expect(group.locator('.note-content')).toContainText('[R1] [N1] → [N2] · 支持');
  await group.getByRole('button', { name: /定位來源 N2/ }).click();
  await expect(page.locator('[data-note-id="source-b"]')).toHaveClass(/selected/);
  await page.getByRole('button', { name: '復原', exact: true }).click(); await expect(group).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(group).toHaveCount(1);
  await expect(page.locator('.save-status')).toContainText('已存於本機');
  await page.getByRole('button', { name: '匯出研究', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON 註記資料/ }).click();
  const exported = await readFile((await (await downloading).path())!);
  expect(exported.toString()).not.toContain('group-secret');
  const savedGroup = JSON.parse(exported.toString()).notes.find((n: Note) => n.type === 'group-summary');
  expect(savedGroup.groupSummary.sources).toHaveLength(3); expect(savedGroup.groupSummary.relations).toHaveLength(2);
  expect(savedGroup.groupSummary.relations[0]).toMatchObject({ source: 'source-a', target: 'source-b', relationType: '支持', directed: true });
  await page.reload(); await expect(group).toHaveCount(1); await expect(group.locator('.note-content')).toContainText('綜合摘要');
  await page.getByTestId('restore-input').setInputFiles({ name: 'saved-group.json', mimeType: 'application/json', buffer: exported });
  await page.getByRole('button', { name: '確認還原', exact: true }).click();
  await expect(group.getByRole('button', { name: /定位來源 N/ })).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /知識白板/ }).click();
  await expect(page.getByRole('button', { name: '關聯摘要', exact: true })).toBeVisible();
});

test('isolated notes are rejected; failure, cancellation and retry preserve the original graph', async ({ page }) => {
  await load(page); await configure(page);
  let calls = 0; let mode: 'fail' | 'wait' | 'ok' = 'fail'; let release: () => void = () => {};
  await page.route('https://api.openai.com/v1/responses', async route => {
    calls++;
    if (mode === 'fail') return route.fulfill({ status: 429, json: { error: { message: 'quota' } } });
    if (mode === 'wait') await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: response }).catch(() => {});
  });
  const outside = page.locator('[data-note-id="outside"]');
  await outside.locator('.note-title').click();
  await expect(page.getByRole('button', { name: '關聯摘要', exact: true })).toBeDisabled();
  await outside.getByRole('button', { name: '更多便條選項' }).click();
  await outside.getByRole('button', { name: '摘要這組關聯' }).click();
  await expect(page.getByRole('dialog')).toContainText('至少需要兩張');
  await expect(page.getByRole('button', { name: '同意傳送並整合' })).toBeDisabled();
  await page.getByRole('button', { name: '取消', exact: true }).click(); expect(calls).toBe(0);
  await (await preview(page)).getByRole('button', { name: '同意傳送並整合' }).click();
  await expect(page.getByRole('alert')).toContainText('429'); await expect(page.locator('.group-summary-note')).toHaveCount(0);
  mode = 'wait';
  await (await preview(page)).getByRole('button', { name: '同意傳送並整合' }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.locator('.group-ai-progress')).toContainText('3 張關聯便條');
  await page.getByRole('button', { name: '取消整合' }).click();
  await expect(page.locator('.group-ai-progress')).toHaveCount(0); release();
  await expect(page.locator('.note-card')).toHaveCount(4); await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  mode = 'ok';
  await (await preview(page)).getByRole('button', { name: '同意傳送並整合' }).click();
  await expect(page.locator('.group-summary-note')).toHaveCount(1);
  expect(calls).toBe(3); await expect(page.locator('.note-card')).toHaveCount(5);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});
