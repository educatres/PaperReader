import JSZip from 'jszip';
import { z } from 'zod';
import { db } from './db';
import { sha256, resetPdfCache } from './pdf';
import { flushSave, useApp, toast } from '../store';
import { now, reasoningEfforts, relations, type Workspace, type ImageAsset, type Screenshot } from '../types';
import { maxImageBytes, validateImageHeader } from './screenshots';

const str = z.string().max(2_000_000); const id = z.string().min(1).max(100).regex(/^[\w-]+$/);
const color = z.enum(['yellow', 'green', 'pink', 'blue']); const provider = z.enum(['openai', 'gemini', 'cgu', 'mercuryapi']);
const reasoningEffort = z.enum(reasoningEfforts).optional();
const point = z.object({ x: z.number().finite().min(-1e7).max(1e7), y: z.number().finite().min(-1e7).max(1e7) });
const ai = z.object({ text: str, provider, model: z.string().max(200), reasoningEffort, createdAt: z.string().max(100), usage: z.number().nonnegative().optional() });
const groupSummary = z.object({ capturedAt: z.string().max(100), sources: z.array(z.object({ noteId: id, title: z.string().max(1000) })).min(2).max(10000),
  relations: z.array(z.object({ id, source: id, target: id, relationType: z.enum(relations), label: z.string().max(1000), directed: z.boolean() })).min(1).max(30000) });
const screenshot = z.object({ assetId: id, sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(33).max(maxImageBytes),
  width: z.number().int().min(1).max(12000), height: z.number().int().min(1).max(12000), pageIndex: z.number().int().nonnegative(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) })
    .refine(q => q.x + q.width <= 1.000001 && q.y + q.height <= 1.000001) });
// Explicit allowlists also strip accidental secret fields from untrusted imports/exports.
export const workspaceSchema = z.object({
  schemaVersion: z.literal(1), id, title: z.string().max(500), activeDocumentId: id.optional(), updatedAt: z.string().max(100),
  viewport: point.extend({ zoom: z.number().min(0.1).max(5) }),
  documents: z.array(z.object({ id, name: z.string().max(500), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().nonnegative().max(150 * 1024 * 1024), pageCount: z.number().int().min(1).max(20000), pages: z.array(str).max(20000), createdAt: z.string().max(100) })).max(50),
  highlights: z.array(z.object({ id, documentId: id, noteId: id, pageIndex: z.number().int().nonnegative(), displayPage: z.number().int().min(1), selectedText: str, normalizedText: str, prefix: str, suffix: str,
    rawText: str.optional(), textQuoteHash: z.string().max(100), textRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
    quads: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) })).max(10000),
    coordinateSystem: z.literal('normalized'), rotation: z.number(), color, status: z.enum(['resolved', 'unresolved']), schemaVersion: z.literal(1), createdAt: z.string().max(100), updatedAt: z.string().max(100) })).max(10000),
  notes: z.array(z.object({ id, documentId: id.optional(), highlightId: id.optional(), type: z.enum(['highlight-note', 'manual-note', 'document-summary', 'group-summary', 'screenshot-note']), title: z.string().max(1000), originalText: str,
    translation: ai.optional(), summary: ai.optional(), groupSummary: groupSummary.optional(), screenshot: screenshot.optional(), userNotes: str, tags: z.array(z.string().max(200)).max(100), position: point, width: z.number().min(200).max(1200), collapsed: z.boolean(), hidden: z.boolean(), color, updatedAt: z.string().max(100) })).max(10000),
  edges: z.array(z.object({ id, source: id, target: id, sourceHandle: z.string().max(100).optional(), targetHandle: z.string().max(100).optional(), relationType: z.enum(['相關', '支持', '對比', '延伸', '待驗證']), label: z.string().max(1000), directed: z.boolean(), createdBy: z.literal('user'), createdAt: z.string().max(100), updatedAt: z.string().max(100) })).max(30000),
  jobs: z.array(z.object({ id, documentId: id, provider, model: z.string().max(200), reasoningEffort, chunks: z.array(z.object({ text: str, startPage: z.number().int().min(1), endPage: z.number().int().min(1) })), results: z.array(ai.nullable()), status: z.enum(['paused', 'running', 'failed', 'complete']), error: str.optional(), resultNoteId: id.optional(), createdAt: z.string().max(100) })).max(1000),
});
export function validateWorkspace(value: unknown): Workspace {
  const w = workspaceSchema.parse(value);
  const docs = new Map(w.documents.map(d => [d.id, d])); const notes = new Map(w.notes.map(n => [n.id, n])); const highlights = new Map(w.highlights.map(h => [h.id, h]));
  if (docs.size !== w.documents.length || notes.size !== w.notes.length || highlights.size !== w.highlights.length || new Set(w.edges.map(e => e.id)).size !== w.edges.length) throw new Error('封裝包含重複 ID。');
  if (w.activeDocumentId && !docs.has(w.activeDocumentId)) throw new Error('封裝的目前文件不存在。');
  for (const d of docs.values()) if (d.pages.length !== d.pageCount) throw new Error('PDF 頁數與文字索引不一致。');
  for (const h of w.highlights) {
    const doc = docs.get(h.documentId); const n = notes.get(h.noteId);
    if (!doc || !n || n.highlightId !== h.id || n.documentId !== doc.id || h.pageIndex >= doc.pageCount || h.displayPage !== h.pageIndex + 1 || h.textRange.start >= h.textRange.end) throw new Error('標記與來源文件／便條的關係不完整。');
  }
  for (const n of w.notes) if ((n.documentId && !docs.has(n.documentId)) || (n.highlightId && !highlights.has(n.highlightId))) throw new Error('便條來源不存在。');
  const imageRefs = new Map<string, Screenshot>();
  for (const n of w.notes) {
    if (n.type === 'screenshot-note' ? !n.screenshot || !n.documentId || n.highlightId || n.screenshot.pageIndex >= docs.get(n.documentId)!.pageCount : !!n.screenshot) throw new Error('截圖便條的來源或圖片資料無效。');
    if (!n.screenshot) continue;
    const prior = imageRefs.get(n.screenshot.assetId);
    if (prior && ['sha256', 'size', 'width', 'height'].some(key => prior[key as keyof Screenshot] !== n.screenshot![key as keyof Screenshot])) throw new Error('同一截圖附件的資料不一致。');
    imageRefs.set(n.screenshot.assetId, n.screenshot);
  }
  for (const n of w.notes) {
    if (n.type === 'group-summary' && !n.groupSummary) throw new Error('關聯摘要缺少來源快照。');
    if (!n.groupSummary) continue;
    const sourceIds = new Set(n.groupSummary.sources.map(s => s.noteId));
    // Historical references remain valid when the user later deletes a source note/edge.
    if (sourceIds.size !== n.groupSummary.sources.length || sourceIds.has(n.id) || new Set(n.groupSummary.relations.map(e => e.id)).size !== n.groupSummary.relations.length
      || n.groupSummary.relations.some(e => e.source === e.target || !sourceIds.has(e.source) || !sourceIds.has(e.target))) throw new Error('關聯摘要的來源快照關係無效。');
  }
  for (const e of w.edges) if (!notes.has(e.source) || !notes.has(e.target)) throw new Error('關係連線指向不存在的便條。');
  for (const j of w.jobs) {
    const doc = docs.get(j.documentId);
    if (!doc || j.chunks.length !== j.results.length || j.chunks.some(c => c.startPage > c.endPage || c.endPage > doc.pageCount)) throw new Error('摘要任務的來源範圍或分塊數無效。');
  }
  return w;
}
function safeName(name: string) { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'PaperReader'; }
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function exportJSON() {
  const w = validateWorkspace(useApp.getState().workspace);
  download(new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' }), `${safeName(w.title)}.json`);
}
export function exportMarkdown() {
  const w = useApp.getState().workspace;
  const lines = [`# ${w.title}`, '', `匯出時間：${new Date().toLocaleString('zh-TW')}`, ''];
  for (const n of w.notes) {
    const paper = w.documents.find(d => d.id === n.documentId); const h = w.highlights.find(h => h.id === n.highlightId);
    lines.push(`## ${n.title}`, '', `便條 ID：${n.id}`, ...(paper ? [`來源：${paper.name}${n.screenshot ? ` · p. ${n.screenshot.pageIndex + 1}` : h ? ` · p. ${h.displayPage}` : ' · 全文'}`] : []), ...(n.tags.length ? [`標籤：${n.tags.join('、')}`] : []), '');
    if (n.screenshot) lines.push('類型：PDF 截圖（圖片請使用完整研究封裝備份）', `附件 ID：${n.screenshot.assetId}`, `來源區域（未旋轉頁面正規化座標）：${JSON.stringify(n.screenshot.region)}`, '');
    if (n.groupSummary) lines.push('類型：AI 關聯整合', `來源快照時間：${n.groupSummary.capturedAt}`, ...n.groupSummary.sources.map((s, i) => `- [N${i + 1}] ${s.title}（便條 ID：${s.noteId}）`), '');
    if (n.originalText) lines.push(n.type === 'group-summary' ? '### 整合來源快照（含連線屬性）' : '### 原文', '', ...n.originalText.split('\n').map(l => `> ${l}`), '');
    if (n.translation) lines.push('### 翻譯', '', n.translation.text, '', `模型：${n.translation.provider} / ${n.translation.model}${n.translation.reasoningEffort ? ` · reasoning: ${n.translation.reasoningEffort}` : ''} · ${n.translation.createdAt}`, '');
    if (n.summary) lines.push('### AI 摘要（需核對原文）', '', n.summary.text, '', `模型：${n.summary.provider} / ${n.summary.model}${n.summary.reasoningEffort ? ` · reasoning: ${n.summary.reasoningEffort}` : ''} · ${n.summary.createdAt}`, '');
    if (n.userNotes) lines.push('### 我的筆記', '', n.userNotes, '');
  }
  lines.push('## 人工建立的研究關係', '');
  for (const e of w.edges) lines.push(`- ${w.notes.find(n => n.id === e.source)?.title} [${e.source}] ${e.directed ? '→' : '↔'} ${w.notes.find(n => n.id === e.target)?.title} [${e.target}]：${e.relationType}${e.label ? `（${e.label}）` : ''}`);
  download(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `${safeName(w.title)}.md`);
}
export async function exportPack() {
  await flushSave(); const w = validateWorkspace(useApp.getState().workspace); const zip = new JSZip();
  const images = [...new Map(w.notes.flatMap(n => n.screenshot ? [[n.screenshot.assetId, n.screenshot] as const] : [])).values()];
  if (w.documents.reduce((sum, d) => sum + d.size, 0) + images.reduce((sum, image) => sum + image.size, 0) + new Blob([JSON.stringify(w)]).size > 300 * 1024 * 1024) throw new Error('完整研究封裝超過 300 MB 上限，請先減少文獻或截圖。');
  zip.file('manifest.json', JSON.stringify({ schemaVersion: 1, app: 'PaperReader', workspace: w.title, exportedAt: now(), documents: w.documents.map(d => ({ id: d.id, name: d.name, sha256: d.sha256, file: `documents/${d.id}.pdf` })), images: images.map(image => ({ id: image.assetId, sha256: image.sha256, size: image.size, width: image.width, height: image.height, file: `images/${image.assetId}.png` })) }, null, 2));
  zip.file('annotations.json', JSON.stringify(w));
  for (const d of w.documents) {
    const stored = await db.documents.get(d.id); if (!stored) throw new Error(`缺少 ${d.name} 的 PDF 檔案，請重新匯入 PDF 後再備份。`);
    zip.file(`documents/${d.id}.pdf`, await stored.blob.arrayBuffer());
  }
  for (const image of images) {
    const stored = await db.assets.get(image.assetId);
    if (!stored || stored.sha256 !== image.sha256) throw new Error('缺少截圖圖片，請匯入含圖片的完整研究封裝後再備份。');
    const buffer = await stored.blob.arrayBuffer(); validateImageHeader(buffer, image);
    if (await sha256(buffer) !== image.sha256) throw new Error('截圖校驗碼不符，請還原完整研究封裝。');
    zip.file(`images/${image.assetId}.png`, buffer);
  }
  zip.file('README.txt', 'PaperReader 研究封裝 v1\n包含 PDF、截圖圖片、原文、便條與人工關係。沒有 API key。\n請妥善保管研究資料；使用 PaperReader 匯入以還原。\n來源頁碼與 AI 摘要仍需自行核對。');
  download(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${safeName(w.title)}.researchpack`);
}
export interface ImportedPack { workspace: Workspace; documents: { id: string; blob: Blob }[]; assets: ImageAsset[] }
export async function readImport(file: File): Promise<ImportedPack> {
  if (file.size > 200 * 1024 * 1024) throw new Error('匯入檔上限為 200 MB。');
  if (file.name.toLowerCase().endsWith('.json')) {
    if (file.size > 30 * 1024 * 1024) throw new Error('JSON 檔超過 30 MB 上限。');
    return { workspace: validateWorkspace(JSON.parse(await file.text())), documents: [], assets: [] };
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    const unsafe = (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName || entry.name;
    if (unsafe.includes('..') || unsafe.includes('\\') || unsafe.startsWith('/') || /^[A-Za-z]:/.test(unsafe)) throw new Error('封裝檔包含不安全路徑。');
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0;
    total += size; if (total > 300 * 1024 * 1024 || Object.keys(zip.files).length > 10200) throw new Error('封裝解壓縮大小或檔案數超出限制。');
  }
  const manifestFile = zip.file('manifest.json'); const annotations = zip.file('annotations.json');
  if (!manifestFile || !annotations) throw new Error('缺少 manifest.json 或 annotations.json。');
  const manifest = JSON.parse(await manifestFile.async('string'));
  if (manifest.schemaVersion !== 1 || manifest.app !== 'PaperReader') throw new Error('這個研究封裝版本不受支援。');
  const workspace = validateWorkspace(JSON.parse(await annotations.async('string')));
  const documents: ImportedPack['documents'] = [];
  for (const d of workspace.documents) {
    const file = zip.file(`documents/${d.id}.pdf`); if (!file) throw new Error(`封裝缺少 PDF：${d.name}`);
    const buffer = await file.async('arraybuffer');
    if (buffer.byteLength !== d.size || await sha256(buffer) !== d.sha256) throw new Error(`${d.name} 的校驗碼或檔案大小不符。`);
    documents.push({ id: d.id, blob: new Blob([buffer], { type: 'application/pdf' }) });
  }
  const assets: ImageAsset[] = [];
  const images = new Map(workspace.notes.flatMap(n => n.screenshot ? [[n.screenshot.assetId, n.screenshot] as const] : []));
  for (const image of images.values()) {
    const entry = zip.file(`images/${image.assetId}.png`); if (!entry) throw new Error('封裝缺少截圖圖片。');
    const buffer = await entry.async('arraybuffer'); validateImageHeader(buffer, image);
    if (await sha256(buffer) !== image.sha256) throw new Error('截圖校驗碼不符。');
    assets.push({ id: image.assetId, blob: new Blob([buffer], { type: 'image/png' }), sha256: image.sha256 });
  }
  return { workspace, documents, assets };
}
export async function restoreImport(pack: ImportedPack) {
  // Invalidate captures that were still encoding an image when restore began.
  useApp.setState(s => ({ documentEpoch: s.documentEpoch + 1 }));
  await flushSave();
  const w = { ...pack.workspace, id: 'default', jobs: pack.workspace.jobs.map(j => ({ ...j, status: j.status === 'running' ? 'paused' as const : j.status })), updatedAt: now() };
  await db.transaction('rw', db.documents, db.workspaces, db.assets, async () => {
    if (pack.documents.length) await db.documents.bulkPut(pack.documents);
    if (pack.assets.length) await db.assets.bulkPut(pack.assets);
    await db.workspaces.put(w);
  });
  resetPdfCache();
  useApp.setState(s => ({ workspace: w, documentEpoch: s.documentEpoch + 1, history: [], future: [], selectedNoteId: undefined, focusNoteId: undefined, focusHighlightId: undefined, focusScreenshotNoteId: undefined, saveStatus: 'saved' }));
  toast(pack.documents.length ? '研究空間已完整還原' : '筆記已匯入。JSON 不含 PDF 與截圖圖片，完整圖片請還原研究封裝。');
}
