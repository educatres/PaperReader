// Documentation screenshots in a fresh browser profile. No private API keys.
// Run after npm run build and npm run preview; optional GUIDE_BASE_URL override.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('.guide-build/screenshots');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [];
const base = process.env.GUIDE_BASE_URL || 'http://127.0.0.1:4173/';
const translation = '閱讀論文不只是收集句子。當讀者連結主張、檢視證據並回查來源時，理解才會逐步形成。這份教學文件介紹閱讀、標記、反思與連結的工作流程。';
const groupText = '綜合摘要\n保留完整語意與回查來源，有助於檢查閱讀摘要是否遺漏限制 [N1][N2]。\n關係分析\n「待驗證」連線保留研究問題，尚未證明摘要品質改善 [R1]。\n後續思考\n回到原文，核對摘要是否保留前提與限制。';
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 }); contexts.push(context);
  const page = await context.newPage();
  // Mock every AI destination before entering a clearly fake teaching credential.
  await page.route(/https:\/\/(api\.openai\.com|generativelanguage\.googleapis\.com|air\.cgu\.edu\.tw)\//, route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: req.url().includes('/cgullmapi/')
      ? { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-5.6-luna' }] }
      : { models: [{ name: 'models/gemini-flash-lite-latest', displayName: 'Gemini Flash Lite Latest', supportedGenerationMethods: ['generateContent'] }] } });
    const body = req.postDataJSON(); const input = body.contents?.[0]?.parts?.[0]?.text || '';
    const text = input.includes('整合這組已連通') ? groupText : input.includes('忠實翻譯') ? translation : '這份教學文件建議讀者保留上下文，將閱讀問題連回來源，並區分原文與自己的解讀。';
    return route.fulfill({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { totalTokenCount: 80 } } });
  });
  await page.goto(base); return page;
}
async function sample(page) {
  await page.getByRole('button', { name: '先試讀一篇範例', exact: true }).click();
  await page.locator('.pdf-page[data-page-index="0"] .textLayer span').first().waitFor();
  await page.getByRole('button', { name: '適合寬度', exact: true }).click();
}
async function highlight(page) {
  await page.evaluate(() => {
    const layer = document.querySelector('.pdf-page[data-page-index="0"] .textLayer');
    const spans = [...layer.querySelectorAll('span')].filter(s => s.firstChild?.nodeType === Node.TEXT_NODE);
    const i = spans.findIndex(s => s.textContent?.includes('Reading a paper'));
    const range = document.createRange(); range.setStart(spans[i].firstChild, 0); range.setEnd(spans[i + 2].firstChild, spans[i + 2].firstChild.textContent.length);
    getSelection().removeAllRanges(); getSelection().addRange(range); layer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  const card = page.locator('.note-card').first(); await card.waitFor();
  await card.getByRole('button', { name: '編輯便條', exact: true }).click();
  await page.getByLabel('便條標題', { exact: true }).fill('閱讀重點：保留完整語意');
  await page.getByLabel('我的筆記', { exact: true }).fill('保留上下文，並區分原文、AI 整理與自己的解讀。');
  await page.getByRole('button', { name: '儲存便條', exact: true }).click(); return card;
}
async function settle(page) {
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(800); // PDF/React Flow animations only, no external calls.
}
async function shot(page, name, locator) {
  await settle(page);
  const file = path.join(out, `${name}.png`);
  if (locator) await locator.screenshot({ path: file, animations: 'disabled' }); else await page.screenshot({ path: file, animations: 'disabled' });
  console.log(name);
}
try {
  const a = await fresh(); await sample(a);
  await shot(a, '01-overview');
  await highlight(a); await shot(a, '02-highlight', a.locator('.split-area'));
  await a.getByRole('button', { name: '截圖模式', exact: true }).click();
  const overlay = a.getByTestId('screenshot-selection-0'); await overlay.waitFor();
  const box = await overlay.boundingBox();
  await a.mouse.move(box.x + box.width * .07, box.y + box.height * .18); await a.mouse.down();
  await a.mouse.move(box.x + box.width * .51, box.y + box.height * .40, { steps: 12 }); await a.mouse.up();
  const imageNote = a.locator('.screenshot-note'); await imageNote.waitFor();
  await a.getByRole('button', { name: '結束截圖 · Esc', exact: true }).click();
  await imageNote.getByRole('button', { name: '編輯便條', exact: true }).click();
  await a.getByLabel('截圖便條文字（自行輸入或貼上）').fill('這張截圖保留了摘要段落的原始版面。');
  await a.getByLabel('我的筆記', { exact: true }).fill('教學筆記：AI 只會讀取我輸入的文字，不分析圖片。');
  await a.getByRole('button', { name: '儲存便條', exact: true }).click();
  await a.getByRole('button', { name: '白板全貌', exact: true }).click();
  await shot(a, '03-screenshot-note', a.locator('.board-pane'));

  const b = await fresh(); await sample(b); const source = await highlight(b);
  await b.getByRole('button', { name: '新增便條', exact: true }).click();
  const manual = b.locator('.note-card').last();
  await manual.getByRole('button', { name: '編輯便條', exact: true }).click();
  await b.getByLabel('便條標題', { exact: true }).fill('我的研究問題');
  await b.getByLabel('我的筆記', { exact: true }).fill('如何判斷閱讀摘要是否保留重要限制？回到原文逐句核對。');
  await b.getByRole('button', { name: '儲存便條', exact: true }).click();
  await b.getByRole('button', { name: '白板全貌', exact: true }).click(); await settle(b);
  const from = await source.locator('.react-flow__handle-right').boundingBox(); const to = await manual.locator('.react-flow__handle-left').boundingBox();
  await b.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await b.mouse.down();
  await b.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 }); await b.mouse.up();
  const relation = b.getByRole('dialog', { name: '編輯便條關係' }); await relation.waitFor();
  await relation.getByLabel('關係類型').selectOption('待驗證'); await relation.getByLabel('說明').fill('用原文檢查摘要有沒有遺漏前提與限制');
  await shot(b, '04-relationship', relation);
  await relation.getByRole('button', { name: '儲存關係', exact: true }).click();

  await b.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await b.getByRole('button', { name: 'Google Gemini', exact: true }).click();
  await b.getByLabel('你的 API key').fill('DEMO_ONLY_NOT_A_VALID_KEY');
  await b.getByRole('button', { name: '取得模型清單', exact: true }).click();
  await b.getByText('已預設選擇 gemini-flash-lite-latest', { exact: false }).waitFor();
  await b.setViewportSize({ width: 1600, height: 1400 }); await settle(b);
  const first = await b.locator('.settings-body .privacy-card').boundingBox(); const last = await b.locator('#model-id').boundingBox();
  await b.screenshot({ path: path.join(out, '05-gemini.png'), clip: { x: first.x - 10, y: first.y - 10, width: first.width + 20, height: last.y + last.height - first.y + 20 } }); console.log('05-gemini');
  await b.getByRole('button', { name: '完成', exact: true }).click(); await b.setViewportSize({ width: 1600, height: 1000 });
  await source.locator('.note-footer').getByRole('button', { name: '翻譯', exact: true }).click();
  await b.getByText(translation, { exact: true }).waitFor();
  await shot(b, '07-note-ai', source);
  await source.locator('.note-title').click();
  await b.getByRole('button', { name: '關聯摘要', exact: true }).click();
  const preview = b.getByRole('dialog', { name: '整合這組關聯便條' }); await preview.waitFor();
  await shot(b, '08-group-preview', preview);
  await preview.getByRole('button', { name: '同意傳送並整合', exact: true }).click();
  const group = b.locator('.group-summary-note'); await group.waitFor();
  await shot(b, '09-group-result', group);
  await b.getByRole('button', { name: '匯出研究', exact: true }).click();
  await shot(b, '10-export', b.getByRole('dialog', { name: '帶走你的研究', exact: true }));
  const downloading = b.waitForEvent('download'); await b.getByRole('button', { name: /完整研究封裝/ }).click();
  const download = await downloading; const pack = path.resolve('.guide-build/tutorial.researchpack'); await download.saveAs(pack);
  // Export dialog may close itself or remain open, depending on the interaction.
  if (await b.getByRole('dialog').count()) await b.keyboard.press('Escape');
  const c = await fresh(); c.on('dialog', d => d.accept());
  await c.getByTestId('restore-input').setInputFiles(pack); await c.locator('.note-card').first().waitFor();
  await c.getByRole('button', { name: '文獻庫', exact: true }).click();
  await shot(c, '11-restore', c.locator('.library'));
  const d = await fresh(); await d.getByRole('button', { name: '連接你的 AI', exact: true }).click();
  await d.getByRole('button', { name: 'CGU API', exact: true }).click();
  await d.setViewportSize({ width: 1600, height: 1400 });
  await d.getByLabel('你的 API key').fill('teaching-cgu-key-not-valid');
  await d.getByRole('button', { name: '驗證 CGU 金鑰', exact: true }).click();
  await d.locator('.settings-message.success').waitFor();
  const body = await d.locator('.settings-body').boundingBox();
  const key = await d.getByLabel('你的 API key').boundingBox();
  const model = await d.getByLabel('模型選項').boundingBox();
  await d.screenshot({ path: path.join(out, '06-cgu.png'), clip: { x: body.x, y: key.y - 40, width: body.width, height: model.y + model.height - key.y + 60 } });
  await writeFile(path.resolve('.guide-build/capture-info.json'), JSON.stringify({ capturedAt: new Date().toISOString(), base, source: 'public/sample.pdf', ai: 'Mocked teaching responses, no valid API key and no paid API calls.' }, null, 2));
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
