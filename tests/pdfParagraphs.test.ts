import { describe, expect, it } from 'vitest';
import { groupPageParagraphs, splitTranslationText, type TextRun } from '../src/lib/pdfParagraphs';

const run = (text: string, x: number, y: number, width = 220, height = 12, itemIndex = y): TextRun => ({ text, x, y, width, height, itemIndex });
describe('PDF spatial paragraphs', () => {
  it('groups lines within a column, preserves paragraph gaps and never interleaves columns', () => {
    const groups = groupPageParagraphs([
      run('Left first line', 50, 100), run('Right first line', 330, 100),
      run('Left second line.', 50, 116), run('Right second line.', 330, 116),
      run('Another left paragraph', 50, 150), run('Another right paragraph', 330, 150),
      run('Left continuation.', 50, 166), run('Right continuation.', 330, 166),
    ], 612);
    expect(groups).toHaveLength(4);
    expect(groups.map(g => g.columnId)).toEqual([0, 0, 1, 1]);
    expect(groups[0].lines.map(l => l.text)).toEqual(['Left first line', 'Left second line.']);
    expect(groups[2].lines.map(l => l.text)).toEqual(['Right first line', 'Right second line.']);
  });
  it('separates full-width titles from body columns and keeps body reading order', () => {
    const groups = groupPageParagraphs([
      run('Full width title', 50, 40, 500, 20),
      run('Left one', 50, 100), run('Left two', 50, 116),
      run('Right one', 330, 100), run('Right two', 330, 116),
    ], 612);
    expect(groups).toHaveLength(3);
    expect(groups[0].regionId).toContain('wide');
    expect(groups.slice(1).map(g => g.columnId)).toEqual([0, 1]);
  });
  it('retains distinct pages by requiring per-page input; duplicate printed items are de-duplicated', () => {
    const page = [run('Continued text', 50, 100), run('Continued text', 50, 100)];
    expect(groupPageParagraphs(page, 612)[0].lines).toHaveLength(1);
    expect(groupPageParagraphs(page, 612)).toHaveLength(1);
    expect(groupPageParagraphs([run('Next page fragment', 50, 40)], 612)).toHaveLength(1);
  });
  it('reassembles a line split into PDF text items without merging wide gaps', () => {
    const groups = groupPageParagraphs([run('First', 50, 100, 30), run('word.', 84, 100, 32), run('Next line.', 50, 116, 66)], 612);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines[0].text).toBe('First word.');
    expect(groups[0].lines[0].items).toHaveLength(2);
  });
  it('flags disconnected table cells and rotated text for review; excludes page numbers', () => {
    const groups = groupPageParagraphs([
      run('A', 50, 100, 20), run('B', 140, 100, 20), run('C', 230, 100, 20),
      { ...run('Rotated label', 50, 200), review: true }, run('12', 300, 750, 12),
    ], 612);
    expect(groups.filter(g => g.role === 'review')).toHaveLength(4);
    expect(groups.at(-1)?.role).toBe('excluded');
  });
});
describe('long translation splitting', () => {
  it('covers the entire source without gaps, overlap or broken Unicode pairs', () => {
    const text = ('A long sentence. Another sentence with emoji 😀 and evidence. ').repeat(300);
    const parts = splitTranslationText(text, 113);
    expect(parts.map(p => text.slice(p.start, p.end)).join('')).toBe(text);
    expect(parts.every(p => p.end - p.start <= 113 && p.end > p.start)).toBe(true);
    expect(parts.slice(0, -1).every(p => !/[\uD800-\uDBFF]/.test(text[p.end - 1]))).toBe(true);
  });
});
