import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Paper, PdfLayout, PdfParagraph, Quad } from '../types';

export const PDF_LAYOUT_VERSION = 1;
export interface TextRun { text: string; x: number; y: number; width: number; height: number; itemIndex: number; review?: boolean }
interface Line extends TextRun { items: number[]; table?: boolean }
export interface ParagraphGroup {
  regionId: string; columnId: number; lines: Line[]; left: number; right: number;
  role: PdfParagraph['role']; reason?: string;
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 1;
const normalize = (text: string) => text.replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1').replace(/\s+/g, ' ').trim();
export async function textHash(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Operates on one unrotated page only. A region/column is a hard grouping boundary.
export function groupPageParagraphs(runs: TextRun[], pageWidth: number): ParagraphGroup[] {
  const sorted = runs.filter(r => r.text.trim() && r.width > 0 && r.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextRun[][] = [];
  for (const run of sorted) {
    const row = [...rows].reverse().find(r => Math.abs(r[0].y - run.y) < Math.min(r[0].height, run.height) * .4);
    if (row) {
      if (!row.some(r => r.text === run.text && Math.abs(r.x - run.x) < 1 && Math.abs(r.y - run.y) < 1)) row.push(run);
    } else rows.push([run]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const segments: Line[] = [];
    for (const run of row) {
      const last = segments.at(-1);
      const gap = last ? run.x - last.x - last.width : Infinity;
      if (last && gap < Math.max(run.height, last.height) * 2.2 && !run.review && !last.review) {
        last.text += (gap > run.height * .15 && !last.text.endsWith(' ') ? ' ' : '') + run.text;
        last.width = Math.max(last.width, run.x + run.width - last.x);
        last.height = Math.max(last.height, run.height); last.items.push(run.itemIndex);
      } else segments.push({ ...run, items: [run.itemIndex] });
    }
    if (segments.length > 2) segments.forEach(s => { s.table = true; });
    lines.push(...segments);
  }
  // A persistent whitespace gap needs multiple rows of support.
  const gaps: { x: number; left: number; right: number; row: number }[] = [];
  for (const left of lines) for (const right of lines) {
    if (left === right || left.table || right.table || Math.abs(left.y - right.y) > Math.max(left.height, right.height) * 1.5) continue;
    const end = left.x + left.width;
    if (left.width < pageWidth * .12 || right.width < pageWidth * .12 || right.x - end < Math.max(left.height, right.height) * 2) continue;
    const x = (end + right.x) / 2;
    if (x < pageWidth * .2 || x > pageWidth * .8) continue;
    gaps.push({ x, left: end, right: right.x, row: Math.round(left.y) });
  }
  const candidates = [...new Set(gaps.map(g => Math.round(g.x)))].map(x => ({
    x, support: new Set(gaps.filter(g => g.left < x && g.right > x).map(g => g.row)).size,
  }));
  const best = candidates.sort((a, b) => b.support - a.support)[0];
  const gutter = best?.support >= 2 ? best.x : undefined;
  if (gutter === undefined) for (const line of lines) {
    if (lines.some(other => other !== line && Math.abs(other.y - line.y) < Math.min(other.height, line.height) * .4
      && (other.x > line.x + line.width || line.x > other.x + other.width))) line.table = true;
  }
  const fullWidth = gutter === undefined ? [] : lines.filter(l => l.x < gutter && l.x + l.width > gutter);
  const buckets = new Map<string, { lines: Line[]; regionId: string; columnId: number }>();
  for (const line of lines) {
    const spanning = fullWidth.includes(line);
    const band = fullWidth.filter(l => l.y + l.height * .5 < line.y).length;
    const regionId = spanning ? 'wide-' + fullWidth.indexOf(line) : 'body-' + band;
    const columnId = gutter === undefined || spanning || line.x + line.width / 2 < gutter ? 0 : 1;
    const key = regionId + '-' + columnId;
    const bucket = buckets.get(key) || { lines: [], regionId, columnId }; bucket.lines.push(line); buckets.set(key, bucket);
  }
  const groups: ParagraphGroup[] = [];
  for (const bucket of buckets.values()) {
    bucket.lines.sort((a, b) => a.y - b.y || a.x - b.x);
    const left = Math.min(...bucket.lines.map(l => l.x));
    const right = Math.max(...bucket.lines.map(l => l.x + l.width));
    const fontHeight = median(bucket.lines.map(l => l.height));
    let current: ParagraphGroup | undefined;
    for (const line of bucket.lines) {
      const previous = current?.lines.at(-1);
      const newIndent = line.x - left > fontHeight * .8;
      const listStart = /^\s*(?:[•●▪]|\d+[.)]\s|[a-z][.)]\s)/i.test(line.text);
      const shortEnding = previous && previous.x + previous.width < right - fontHeight * 2 && /[.!?:;]\s*$/.test(previous.text);
      const breakBefore = !previous || line.y - previous.y > Math.max(previous.height, line.height) * 1.65
        || Math.abs(previous.height - line.height) > fontHeight * .25 || newIndent || listStart || shortEnding
        || line.table || previous.table || line.review || previous.review;
      if (breakBefore) {
        const excluded = /^[\d\s\-–—]+$/.test(line.text) || /^[\d\s=+×÷<>()[\]{}.,:;^_*\/\\−≤≥∑∫]+$/u.test(line.text);
        const review = line.review || line.table;
        current = { regionId: bucket.regionId, columnId: bucket.columnId, lines: [], left, right,
          role: review ? 'review' : excluded ? 'excluded' : /^(fig(?:ure)?|table)\s*\d/i.test(line.text) ? 'caption' : line.height > fontHeight * 1.2 ? 'heading' : 'text',
          ...(review ? { reason: '文字方向或儲存格順序需要檢查' } : excluded ? { reason: '頁碼或純公式' } : {}) };
        groups.push(current);
      }
      current!.lines.push(line);
    }
  }
  // Region order, then the entire left column, then the right column.
  return groups.sort((a, b) => {
    if (a.regionId === b.regionId) return a.columnId - b.columnId || a.lines[0].y - b.lines[0].y;
    const top = (g: ParagraphGroup) => Math.min(...groups.filter(p => p.regionId === g.regionId).map(p => p.lines[0].y));
    return top(a) - top(b);
  });
}

export async function extractPdfParagraphs(pdf: PDFDocumentProxy, paper: Paper, signal: AbortSignal, progress: (page: number) => void) {
  const layouts: PdfLayout[] = []; const paragraphs: PdfParagraph[] = [];
  for (let index = 0; index < pdf.numPages; index++) {
    signal.throwIfAborted(); progress(index + 1);
    const page = await pdf.getPage(index + 1); const viewport = page.getViewport({ scale: 1, rotation: 0 });
    const layout: PdfLayout = { id: paper.id + '-layout-' + index, documentId: paper.id, documentHash: paper.sha256, layoutVersion: PDF_LAYOUT_VERSION,
      pageIndex: index, width: viewport.width, height: viewport.height, rotation: page.rotate, viewBox: [...page.view], warnings: [] };
    layouts.push(layout);
    try {
      const content = await page.getTextContent();
      const runs: TextRun[] = content.items.flatMap((item, itemIndex) => {
        if (!('str' in item) || !item.str.trim()) return [];
        const [x, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const height = Math.max(1, Math.hypot(item.transform[2], item.transform[3]) * viewport.scale);
        const ascent = content.styles[item.fontName]?.ascent ?? .8;
        const y = baseline - height * ascent; const width = item.width * viewport.scale;
        if (x + width <= 0 || x >= viewport.width || y + height <= 0 || y >= viewport.height) return [];
        return [{ text: item.str, x, y, width, height, itemIndex,
          review: item.dir !== 'ltr' || Math.abs(item.transform[1]) > .05 * Math.abs(item.transform[0]) }];
      });
      if (!runs.length) layout.warnings.push('沒有可用文字，需要 OCR。');
      for (const [order, group] of groupPageParagraphs(runs, viewport.width).entries()) {
        const rawText = group.lines.map(l => l.text.trim()).join('\n'); const normalizedText = normalize(rawText);
        const itemIndices = group.lines.flatMap(l => l.items);
        const lines: Quad[] = group.lines.map(l => {
          const x = Math.max(0, Math.min(.99999, l.x / viewport.width)); const y = Math.max(0, Math.min(.99999, l.y / viewport.height));
          return { x, y, width: Math.max(.00001, Math.min(1 - x, l.width / viewport.width)), height: Math.max(.00001, Math.min(1 - y, l.height / viewport.height)) };
        });
        paragraphs.push({ id: paper.id + '-v' + PDF_LAYOUT_VERSION + '-p' + index + '-' + itemIndices[0] + '-' + itemIndices.at(-1), documentId: paper.id, layoutId: layout.id,
          layoutVersion: PDF_LAYOUT_VERSION, pageIndex: index, regionId: group.regionId, columnId: group.columnId, order,
          rawText, normalizedText, sourceHash: await textHash(normalizedText), itemIndices, lines,
          columnBounds: { left: Math.max(0, group.left / viewport.width), right: Math.min(1, group.right / viewport.width) },
          role: group.role, ...(group.reason ? { reason: group.reason } : {}) });
      }
    } catch {
      signal.throwIfAborted();
      layout.warnings.push('這一頁的文字擷取失敗，請回查 PDF。');
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const margins = paragraphs.filter(p => p.lines[0].y < .08 || p.lines.at(-1)!.y > .92);
  const repetitions = new Map<string, Set<number>>();
  for (const p of margins) { const pages = repetitions.get(p.normalizedText) || new Set<number>(); pages.add(p.pageIndex); repetitions.set(p.normalizedText, pages); }
  for (const p of margins) if ((repetitions.get(p.normalizedText)?.size || 0) >= 2) { p.role = 'excluded'; p.reason = '重複頁首頁尾'; }
  signal.throwIfAborted();
  return { layouts, paragraphs };
}

export function splitTranslationText(text: string, limit = 6000) {
  if (limit < 2) throw new Error('翻譯片段上限至少為 2 字元。');
  const parts: { start: number; end: number }[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end); const boundaries = [...slice.matchAll(/[.!?。！？]\s+/g)];
      const last = boundaries.at(-1); if (last && last.index! > limit / 2) end = start + last.index! + last[0].length;
      if (end > start && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    parts.push({ start, end }); start = end;
  }
  return parts;
}
