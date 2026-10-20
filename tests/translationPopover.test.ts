import { describe, expect, it } from 'vitest';
import { placeTranslationPopover, type PopoverBounds } from '../src/lib/translationPopover';

const viewport = { left: 12, top: 100, right: 788, bottom: 688 };
const source = { left: 60, top: 320, right: 340, bottom: 380 };
const size = { width: 320, height: 120 };
const overlaps = (a: PopoverBounds, b: PopoverBounds) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
describe('translation popover avoids PDF text', () => {
  it('places the complete window above the whole paragraph with a gap', () => {
    const p = placeTranslationPopover(source, size, viewport, [source])!;
    expect(p.side).toBe('above'); expect(p.y + p.maxHeight).toBeLessThanOrEqual(source.top - 8);
    expect(p.maxHeight).toBe(120);
  });
  it('moves below when the paragraph is near the top of the reading viewport', () => {
    const top = { ...source, top: 115, bottom: 175 };
    const p = placeTranslationPopover(top, size, viewport, [top])!;
    expect(p.side).toBe('below'); expect(p.y).toBeGreaterThanOrEqual(top.bottom + 8);
  });
  it('does not cover preceding or following paragraphs in either column', () => {
    const text = [{ ...source, top: 100, bottom: 305 }, source, { left: 360, right: 650, top: 385, bottom: 480 }];
    const p = placeTranslationPopover(source, size, viewport, text)!;
    expect(p.side).toBe('below'); expect(p.y).toBe(488);
    const bounds = { left: p.x, right: p.x + size.width, top: p.y, bottom: p.y + p.maxHeight };
    expect(text.some(t => overlaps(bounds, t))).toBe(false);
  });
  it('reduces height for a tall paragraph, keeping the entire original unobscured', () => {
    const tall = { ...source, top: 180, bottom: 650 };
    const p = placeTranslationPopover(tall, size, viewport, [tall])!;
    expect(p.side).toBe('above'); expect(p.maxHeight).toBe(72); expect(p.y).toBe(100);
  });
  it('clamps horizontally on narrow screens and refuses an area filled with source text', () => {
    const mobile = { left: 12, top: 100, right: 378, bottom: 720 };
    const p = placeTranslationPopover({ ...source, left: 300 }, size, mobile, [source])!;
    expect(p.x).toBe(58); expect(p.x + size.width).toBe(mobile.right);
    expect(placeTranslationPopover({ ...source, top: 100, bottom: 720 }, size, mobile, [])).toBeUndefined();
  });
});
