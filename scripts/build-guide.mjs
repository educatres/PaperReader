// Editable guide built with the Codex bundled presentation runtime.
// First run capture-guide.mjs against a current preview. No runtime dependency
// is added to the PaperReader web application.
// Optional paths: PAPERREADER_ARTIFACT_MODULES, PAPERREADER_PRESENTATIONS_SKILL,
// PAPERREADER_PYTHON. --final=<path> chooses a new output for a later revision.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const workspaceDir = process.cwd();
const build = path.join(workspaceDir, '.guide-build');
const runtime = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');
const modules = process.env.PAPERREADER_ARTIFACT_MODULES || path.join(runtime, 'node/node_modules');
process.env.RUNTIME_NODE_MODULES = modules;
const skill = process.env.PAPERREADER_PRESENTATIONS_SKILL || path.join(os.homedir(), '.codex/plugins/cache/openai-primary-runtime/presentations/26.1015.12040/skills/presentations');
const python = process.env.PAPERREADER_PYTHON || path.join(runtime, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python');
const { Presentation, PresentationFile } = await import(pathToFileURL(path.join(modules, '@oai/artifact-tool/dist/artifact_tool.mjs')).href);
const { finalizePresentation } = await import(pathToFileURL(path.join(skill, 'container_tools/artifact_tool_utils.mjs')).href);
const finalArg = process.argv.find(a => a.startsWith('--final='));
const finalPath = path.resolve(finalArg?.slice('--final='.length) || 'docs/PaperReader_使用指引.pptx');
const tag = new Date().toISOString().replace(/[:.]/g, '-');
const revision = path.join(build, `deck-${tag}`);
await fs.mkdir(revision, { recursive: true });
await fs.mkdir(path.dirname(finalPath), { recursive: true });

const FONT = 'Microsoft JhengHei';
const C = { bg: '#F6F7F3', green: '#355C4B', ink: '#33433A', muted: '#687868', purple: '#756298' };
const p = Presentation.create({ slideSize: { width: 1600, height: 900 } });
let objectId = 0;

function text(slide, value, x, y, width, height, size = 28, color = C.ink, bold = false) {
  const shape = slide.shapes.add({
    geometry: 'textbox', name: `text-${++objectId}`,
    position: { left: x, top: y, width, height },
    fill: 'none', line: { fill: 'none', width: 0 },
  });
  shape.text = value;
  shape.text.style = { typeface: FONT, fontSize: size, color, bold, insets: 0, wrap: 'square', autoFit: 'none', verticalAlignment: 'top' };
  return shape;
}
function slide(title, source) {
  const s = p.slides.add(); s.background.fill = C.bg;
  text(s, title, 76, 58, 1440, 82, 48, C.green, true);
  text(s, 'PaperReader 使用指引', 76, 846, 700, 28, 19, C.muted);
  text(s, String(p.slides.items.length).padStart(2, '0'), 1472, 846, 55, 28, 19, C.muted);
  s.speakerNotes.text = `PaperReader 操作說明，已更新 CGU 瀏覽器直接連線流程（2026-10-19）。\n來源：${source}\n範例：public/sample.pdf，Reading as a Research Practice，原創三頁教學文件，非科學研究論文。\n畫面來自獨立的教學瀏覽器環境，不含私人憑證。AI 回應與模型清單為預先設定的教學示例，未向真實供應商發出生成請求。`;
  return s;
}
function step(s, number, heading, detail, top) {
  text(s, `${number}. ${heading}`, 76, top, 445, 45, 29, C.green, true);
  text(s, detail, 76, top + 51, 445, 112, 27);
}
async function screenshot(s, name, x, y, width, height, region, alt = name) {
  const bytes = await fs.readFile(path.join(build, 'screenshots', `${name}.png`));
  const iw = bytes.readUInt32BE(16), ih = bytes.readUInt32BE(20);
  const r = region || [0, 0, iw, ih];
  if (r[0] < 0 || r[1] < 0 || r[0] + r[2] > iw || r[1] + r[3] > ih) throw new Error(`Invalid screenshot region: ${name}`);
  const ratio = Math.min(width / r[2], height / r[3]);
  s.images.add({
    blob: bytes, contentType: 'image/png', alt,
    fit: 'contain',
    crop: { left: r[0] / iw, top: r[1] / ih, right: (iw - r[0] - r[2]) / iw, bottom: (ih - r[1] - r[3]) / ih },
    position: { left: x + (width - r[2] * ratio) / 2, top: y + (height - r[3] * ratio) / 2, width: r[2] * ratio, height: r[3] * ratio },
  });
}

// 01. Text-only cover keeps the opening focused on the tool and the guide.
{
  const s = p.slides.add(); s.background.fill = C.bg;
  text(s, 'PaperReader', 108, 160, 1380, 130, 96, C.green, true);
  text(s, '使用指引', 108, 313, 1300, 96, 64, C.green);
  text(s, '用內建範例練習 PDF 標記、研究便條與 AI 摘要', 112, 465, 1360, 70, 34);
  text(s, 'https://educatres.github.io/PaperReader/', 112, 663, 1360, 50, 30, C.green);
  text(s, '繁體中文桌面操作示範　2026.10', 112, 790, 1300, 40, 23, C.muted);
  s.speakerNotes.text = 'PaperReader 線上網站：https://educatres.github.io/PaperReader/。本指引使用內建的原創教學 PDF。已更新 CGU 瀏覽器直接連線流程（2026-10-19）。';
}
// 02. Overview.
{
  const s = slide('範例與閱讀介面', 'src/App.tsx、src/components/PdfViewer.tsx、01-overview.png');
  step(s, 1, '開啟範例', '初次開啟網站時，點\n「先試讀一篇範例」。\n也可使用「開啟 PDF」。', 202);
  step(s, 2, '左側閱讀，右側記錄', '左邊是 PDF，右邊是白板。\n拖曳中間分隔線調整比例。', 410);
  step(s, 3, '調整閱讀空間', '文件列右側可隱藏工具列，\n再按「展開工具列」恢復。', 600);
  await screenshot(s, '01-overview', 564, 190, 960, 600, null, '內建教學 PDF 的左右分割閱讀介面');
  text(s, '範例為原創三頁教學 PDF，供功能練習使用。', 564, 800, 960, 32, 21, C.muted);
}
// 03. Two disjoint crops from the same screenshot make both ends readable.
{
  const s = slide('選字標記與來源便條', 'src/components/PdfViewer.tsx、src/components/NoteNode.tsx、02-highlight.png');
  text(s, '選「螢光筆」與顏色，在同一頁拖曳選字，放開後會自動建立便條。', 76, 153, 1450, 70, 29);
  text(s, 'PDF 選字段落', 116, 238, 630, 42, 27, C.green, true);
  text(s, '自動建立的來源便條', 912, 238, 590, 42, 27, C.green, true);
  await screenshot(s, '02-highlight', 98, 295, 680, 438, [220, 530, 660, 440], 'PDF 摘要段落的黃色螢光標記');
  await screenshot(s, '02-highlight', 904, 289, 612, 510, [2180, 640, 600, 550], '由選取文字建立的來源便條與原文分頁');
  text(s, '跨頁請分開標記。\n選取完整語意，保留限制與前提。', 116, 737, 670, 76, 27);
  text(s, '點標記可找便條；便條右下角箭頭可回原文。', 76, 805, 1420, 35, 25, C.green);
}
// 04. Screenshot note, with no OCR or automatic image analysis.
{
  const s = slide('PDF 截圖便條', 'src/components/ScreenshotSelection.tsx、src/components/NoteNode.tsx、src/lib/noteText.ts、03-screenshot-note.png');
  step(s, 1, '框選單頁內容', 'PDF 工具列選「截圖模式」，\n拖曳框出需要的範圍。\n按 Esc 可取消或結束。', 198);
  step(s, 2, '自行補充文字', '新便條預設沒有文字。\n點「輸入或貼上文字」，\n或用鉛筆編輯內容。', 407);
  step(s, 3, '圖片與 AI', '點圖片可放大查看。\nAI 只讀便條文字與筆記，\n圖片不作分析。', 617);
  await screenshot(s, '03-screenshot-note', 702, 175, 740, 650, [920, 590, 480, 690], '含 PDF 原始版面與空白文字欄位的截圖便條');
}
// 05. Human relationships.
{
  const s = slide('便條連線與關係', 'src/components/ResearchCanvas.tsx、04-relationship.png');
  step(s, 1, '建立連線', '從一張便條四邊的連接點，\n拖到另一張便條。\n雙擊連線可再編輯。', 208);
  step(s, 2, '設定關係', '選擇關係類型，補上說明。\n需要時勾選方向箭頭，\n再按「儲存關係」。', 420);
  text(s, '這裡示範「待驗證」：\n用原文檢查摘要是否遺漏限制。\n人工連線保留你的研究判斷。', 76, 665, 480, 120, 27, C.purple);
  await screenshot(s, '04-relationship', 602, 200, 925, 603, null, '編輯便條關係：待驗證、補充說明與方向箭頭');
}
// 06. Credentials and Gemini rule, including a visible teaching disclosure.
{
  const s = slide('AI 設定與 API Key', 'src/components/Settings.tsx、src/lib/ai.ts、05-gemini.png');
  step(s, 1, '連接自己的 AI', '點「連接你的 AI」，選供應商，\n貼上金鑰並選模型。\n「測試連線」會使用少量額度。', 190);
  step(s, 2, '辨識暫存金鑰', '已設定時顯示 ***。\n「清除本機 API Key」會清除\n目前供應商的分頁金鑰。', 391);
  text(s, 'Gemini 取得清單後，若包含\ngemini-flash-lite-latest 就預選它；\n沒有時，需由你選擇模型。', 76, 610, 480, 122, 25);
  text(s, '重新整理或關閉分頁後，需重填金鑰。', 76, 770, 1450, 38, 26, C.green, true);
  text(s, 'OpenAI／CGU 可選 gpt-6-luna、gpt-5.6-luna 或自訂模型；推理預設為中。', 76, 809, 1450, 33, 23);
  await screenshot(s, '05-gemini', 622, 175, 865, 565, null, 'Gemini 設定、遮罩金鑰、清除按鈕及預設模型');
  text(s, '模型清單為教學示例，實際可用模型依帳戶而定。', 622, 738, 865, 35, 21, C.muted);
}
// 07. CGU direct browser connection.
{
  const s = slide('CGU 瀏覽器直接連線', 'README.md CGU 連線、src/components/Settings.tsx、06-cgu.png');
  text(s, '在「連接你的 AI」選 CGU API，即可由瀏覽器直接連線。', 76, 153, 1450, 50, 29);
  step(s, 1, '貼上並驗證金鑰', '貼上自己的 CGU API key，\n按「驗證 CGU 金鑰」。\n這一步只查詢模型清單。', 227);
  step(s, 2, '選擇模型並測試', '選擇模型與推理程度，\n按「測試連線」確認文字生成。\n測試會使用少量額度。', 477);
  text(s, '金鑰與文字以 HTTPS 直接傳給 CGU。', 76, 746, 1450, 43, 28, C.green, true);
  text(s, '模型清單為教學示例；實際可用模型依帳戶而定。', 76, 798, 1450, 37, 25);
  await screenshot(s, '06-cgu', 609, 213, 916, 520, null, 'CGU 金鑰遮罩、驗證按鈕與模型選擇');
}
// 08. Single note AI operations.
{
  const s = slide('便條翻譯與摘要', 'src/components/NoteNode.tsx、src/lib/ai.ts、07-note-ai.png');
  step(s, 1, '便條下方的 AI 按鈕', '連接 AI 後，點「翻譯」或\n「摘要」，結果會出現在\n對應的分頁。', 208);
  step(s, 2, '保留自己的解讀', '可編輯翻譯或摘要。\n用「筆記」記下疑問，\n再回原文核對。', 420);
  text(s, '「全文摘要」是另一項功能，\n會先確認傳送目前 PDF 的分塊文字。', 76, 660, 488, 112, 26);
  await screenshot(s, '07-note-ai', 687, 207, 755, 555, null, '來源便條的繁體中文翻譯分頁');
  text(s, 'AI 回應為教學示例，使用時請回查原文。', 638, 785, 880, 35, 22, C.muted);
}
// 09. Group consent and boundaries, with preserved relation details.
{
  const s = slide('關聯摘要的確認範圍', 'src/components/GroupSummaryDialog.tsx、src/lib/groupSummary.ts、08-group-preview.png');
  step(s, 1, '選取相連的便條', '至少兩張便條相連後，\n選取其中一張，點白板上方\n「關聯摘要」。', 208);
  step(s, 2, '檢查預覽', '納入直接與間接相連的便條，\n排除隱藏項目。\n連線類型、說明與方向也會傳送。', 420);
  text(s, '確認後按「同意傳送並整合」。\n截圖只使用你填入的文字，\n圖片不會傳給 AI。', 76, 668, 482, 118, 26, C.purple);
  await screenshot(s, '08-group-preview', 605, 198, 920, 552, [30, 230, 1260, 740], '預覽兩張便條及待驗證連線的摘要輸入範圍');
  await screenshot(s, '08-group-preview', 605, 756, 920, 70, [30, 1395, 1260, 110], '同意傳送並整合與取消按鈕');
}
// 10. Result style and source snapshot.
{
  const s = slide('紫色整合便條', 'src/components/NoteNode.tsx、src/lib/groupSummary.ts、09-group-result.png');
  step(s, 1, '閱讀整合結果', '摘要會成為一張紫色便條，\n分析便條內容與連線關係。\n結果仍需自行核對。', 208);
  step(s, 2, '回查來源', '點 N1、N2 可找回來源便條。\n「來源快照」保留生成時的內容\n與連線，方便對照。', 422);
  text(s, '來源修改後不會自動更新摘要。\n可按「再次整合」產生新的結果。', 76, 671, 490, 100, 27, C.purple);
  await screenshot(s, '09-group-result', 704, 176, 706, 628, null, '具有來源按鈕、內容快照與再次整合功能的紫色摘要便條');
  text(s, 'AI 回應為教學示例。', 704, 805, 706, 33, 21, C.muted);
}
// 11. Export choices.
{
  const s = slide('匯出與備份', 'src/App.tsx、src/lib/transfer.ts、10-export.png');
  step(s, 1, '完整備份', '點「匯出研究」，選\n「完整研究封裝」。\n下載的副檔名為 .researchpack。', 207);
  step(s, 2, '包含 PDF 與截圖', '封裝保存 PDF、圖片、標記、\n便條與連線，可換電腦還原。\n匯出檔不包含 API Key。', 419);
  text(s, 'Markdown 適合閱讀與寫作。\nJSON 保留註記資料與附件資訊，\n完整圖片請使用研究封裝備份。', 76, 659, 490, 120, 27);
  await screenshot(s, '10-export', 674, 177, 795, 631, null, '匯出對話框的完整研究封裝、Markdown 與 JSON 選項');
}
// 12. Restore and storage.
{
  const s = slide('還原與資料保存', 'src/App.tsx、src/lib/db.ts、README.md 隱私與本機儲存、11-restore.png');
  step(s, 1, '還原研究封裝', '開啟左上「文獻庫」，點下方\n「還原研究封裝 / JSON」，\n選擇先前下載的 .researchpack。', 208);
  step(s, 2, '取代前先備份', '還原可能取代目前工作區。\n請先備份目前研究，再依\n確認視窗繼續。', 422);
  text(s, '研究資料保存在目前瀏覽器。\n清除網站資料、換瀏覽器或換網址，\n都可能需要用封裝還原。', 76, 666, 505, 118, 26);
  await screenshot(s, '11-restore', 655, 225, 840, 485, [0, 1340, 456, 330], '文獻庫下方的還原、備份與清除本機資料按鈕');
  text(s, '文獻庫下方操作區', 655, 740, 840, 40, 24, C.muted);
  text(s, '定期下載備份。API Key 目前只暫存在分頁記憶體。', 76, 800, 1450, 36, 26, C.green, true);
}

for (const [i, s] of p.slides.items.entries()) {
  const png = await p.export({ slide: s, format: 'png', scale: 1 });
  await fs.writeFile(path.join(revision, `slide-${String(i + 1).padStart(2, '0')}.png`), new Uint8Array(await png.arrayBuffer()));
}
const candidatePath = path.join(revision, 'candidate.pptx');
await (await PresentationFile.exportPptx(p)).save(candidatePath);
const result = await finalizePresentation({
  workspaceDir, candidatePath, finalPath, pythonExecutable: python,
  integrityValidatorPath: path.join(skill, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skill, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '15240000,8572500', '--validate-bullet-geometry', '--validate-heading-fit'],
  fontPolicy: { basis: 'design', families: [FONT] },
  requiredNativeTableOwnerSlides: [], requiredNativeChartOwnerSlides: [],
  verifyArtifactToolImport: true,
  receiptPath: path.join(revision, 'guide.validation.json'),
});
await fs.writeFile(path.join(build, 'latest-deck.json'), JSON.stringify({ revision, finalPath, slides: p.slides.items.length }, null, 2));
console.log(JSON.stringify({ revision, finalPath, slides: p.slides.items.length, result }, null, 2));
