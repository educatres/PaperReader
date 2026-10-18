import type { Highlight, Quad } from '../types';

export const normalizeText = (text: string) => text.replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2').replace(/\s+/g, ' ').trim();
function rangeForOffsets(root: HTMLElement, start: number, end: number): Range | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null; let count = 0; const range = document.createRange(); let foundStart = false;
  while ((current = walker.nextNode())) {
    const len = current.textContent?.length || 0;
    if (!foundStart && start < count + len) { range.setStart(current, start - count); foundStart = true; }
    if (foundStart && end <= count + len) { range.setEnd(current, end - count); return range; }
    count += len;
  }
  return undefined;
}
export function selectionOffsets(root: HTMLElement, range: Range) {
  const pre = document.createRange(); pre.selectNodeContents(root); pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}
export function rangeQuads(range: Range, page: HTMLElement): Quad[] {
  const bounds = page.getBoundingClientRect();
  const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
  const seen = new Set<string>(); const quads: Quad[] = [];
  for (const rect of rects) {
    const x = Math.max(0, (rect.left - bounds.left) / bounds.width), y = Math.max(0, (rect.top - bounds.top) / bounds.height);
    const width = Math.min(1 - x, rect.width / bounds.width), height = Math.min(1 - y, rect.height / bounds.height);
    const key = [x, y, width, height].map(v => v.toFixed(4)).join(':');
    if (!seen.has(key) && width > 0 && height > 0) { seen.add(key); quads.push({ x, y, width, height }); }
  }
  return quads;
}
export function resolveAnchor(layer: HTMLElement, page: HTMLElement, highlight: Highlight): Quad[] | undefined {
  const text = layer.textContent || ''; const quote = highlight.selectedText;
  const { start, end } = highlight.textRange;
  if (text.slice(start, end) === quote) {
    const range = rangeForOffsets(layer, start, end);
    if (range) return rangeQuads(range, page);
  }
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const index = text.indexOf(quote, cursor); if (index < 0) break;
    if ((!highlight.prefix || text.slice(Math.max(0, index - highlight.prefix.length), index) === highlight.prefix)
      && (!highlight.suffix || text.slice(index + quote.length, index + quote.length + highlight.suffix.length) === highlight.suffix)) matches.push(index);
    cursor = index + Math.max(1, quote.length);
  }
  if (matches.length === 1) {
    const range = rangeForOffsets(layer, matches[0], matches[0] + quote.length);
    if (range) return rangeQuads(range, page);
  }
  // Saved document-relative rectangles remain a fallback, never a guessed nearby quote.
  return undefined;
}
