import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useApp, addPaper, toast, notifyDocumentFiles } from '../store';
import { db } from './db';
import { uid, now } from '../types';
import { requireProjectId, captureContext, isCurrentContext, beginBusyOperation } from './projectContext';

GlobalWorkerOptions.workerSrc = workerUrl;
const cache = new Map<string, Promise<PDFDocumentProxy>>();
export function resetPdfCache() {
  const previous = [...cache.values()]; cache.clear();
  for (const doc of previous) void doc.then(pdf => pdf.loadingTask.destroy()).catch(() => {});
}
window.addEventListener('paperreader-reset', resetPdfCache);
window.addEventListener('paperreader-files', resetPdfCache);
export const pdfOptions = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`, cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`, isEvalSupported: false,
};
export async function sha256(buffer: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function openPaper(id: string) {
  const projectId = requireProjectId();
  const cacheKey = `${projectId}:${id}:${useApp.getState().workspace.documents.find(d => d.id === id)?.sha256 || ''}`;
  if (!cache.has(cacheKey)) {
    const task = (async () => {
    const stored = await db.documents.get([projectId, id]);
    if (!stored) throw new Error('找不到這篇 PDF 的本機檔案，請重新匯入 PDF 或研究封裝。');
    return getDocument({ ...pdfOptions, data: new Uint8Array(await stored.blob.arrayBuffer()) }).promise;
    })().catch(e => { if (cache.get(cacheKey) === task) cache.delete(cacheKey); throw e; });
    cache.set(cacheKey, task);
  }
  return cache.get(cacheKey)!;
}
export async function importPdf(file: File, onProgress?: (message: string) => void) {
  const finish = beginBusyOperation();
  try { return await importPdfTask(file, onProgress); } finally { finish(); }
}
async function importPdfTask(file: File, onProgress?: (message: string) => void) {
  const projectId = requireProjectId(); const context = captureContext();
  const check = () => { if (!isCurrentContext(context)) throw new Error('專案已變更，已停止匯入。'); };
  if (file.size > 150 * 1024 * 1024) throw new Error('單份 PDF 上限為 150 MB，請先壓縮或分割。');
  if (!file.size) throw new Error('這個檔案是空的。');
  onProgress?.('正在讀取 PDF…');
  const data = await file.arrayBuffer();
  if (!new TextDecoder().decode(data.slice(0, 1024)).includes('%PDF-')) throw new Error('檔案不是有效 PDF。請選擇 .pdf 檔。');
  const hash = await sha256(data);
  check();
  const existing = useApp.getState().workspace.documents.find(d => d.sha256 === hash);
  if (existing) {
    if (!await db.documents.get([projectId, existing.id])) {
      check();
      await db.transaction('rw', db.documents, db.sync, async () => {
        if ((await db.sync.get(projectId))?.state !== 'active') throw new Error('此專案已刪除。');
        await db.documents.put({ projectId, id: existing.id, blob: file });
      });
      check(); cache.delete(`${projectId}:${existing.id}:${existing.sha256}`);
      useApp.setState(s => ({ documentEpoch: s.documentEpoch + 1 }));
      notifyDocumentFiles();
    }
    useApp.getState().edit(w => { w.activeDocumentId = existing.id; }, false);
    toast('這篇文獻已在研究空間，已為你開啟'); return existing;
  }
  if (useApp.getState().workspace.documents.length >= 50) throw new Error('每個研究空間最多 50 篇 PDF。請先匯出備份，再整理文獻庫。');
  let pdf: PDFDocumentProxy;
  try { pdf = await getDocument({ ...pdfOptions, data: new Uint8Array(data) }).promise; }
  catch (e) { throw new Error((e as Error).name === 'PasswordException' ? '這份 PDF 有密碼保護。請先解除密碼，再匯入。' : '無法讀取這份 PDF，檔案可能已損壞或格式不受支援。'); }
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      check();
      onProgress?.(`正在建立本機文字索引 ${i} / ${pdf.numPages}`);
      const page = await pdf.getPage(i); const content = await page.getTextContent();
      pages.push(content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('').trim());
      page.cleanup();
    }
    const paper = { id: uid(), name: file.name, sha256: hash, size: file.size, pageCount: pdf.numPages, pages, createdAt: now() };
    check(); await addPaper(paper, file); check(); cache.set(`${projectId}:${paper.id}:${paper.sha256}`, Promise.resolve(pdf));
    if (!pages.some(p => p.trim().length > 10)) toast('此文件需要 OCR 才能文字標註；仍可閱讀 PDF。', 'error');
    else toast('PDF 已保存在本機，可以開始閱讀了');
    return paper;
  } catch (e) { await pdf.cleanup(); throw e; }
}
