import { describe, expect, it } from 'vitest';
import { placeTranslationPopover } from '../src/lib/translationPopover';

const viewport = { left: 12, top: 100, right: 788, bottom: 688 };
const source = { left: 60, top: 320, right: 340, bottom: 380 };
const anchor = { left: 34, top: 314, right: 58, bottom: 338 };
const size = { width: 320, height: 120 };
describe('translation popover stays beside its icon', () => {
  it('aligns with the actual icon and attaches immediately above it', () => {
    const p = placeTranslationPopover(anchor, source, size, viewport, [source])!;
    expect(p.side).toBe('above'); expect(p.x).toBe(anchor.left);
    expect(p.y + p.maxHeight).toBe(anchor.top - 8); expect(p.maxHeight).toBe(120);
  });
  it('moves just below the paragraph when there is no readable space above', () => {
    const top = { ...source, top: 115, bottom: 175 };
    const icon = { ...anchor, top: 109, bottom: 133 };
    const p = placeTranslationPopover(icon, top, size, viewport, [top])!;
    expect(p.side).toBe('below'); expect(p.y).toBe(top.bottom + 8);
  });
  it('does not jump to remote whitespace when nearby paragraphs are tightly packed', () => {
    const text = [{ ...source, top: 100, bottom: 305 }, source, { left: 360, right: 650, top: 385, bottom: 480 }];
    const p = placeTranslationPopover(anchor, source, size, viewport, text)!;
    expect(p.side).toBe('above'); expect(p.y + p.maxHeight).toBe(anchor.top - 8);
    expect(p.y + p.maxHeight).toBeLessThan(source.top);
  });
  it('uses compact adjacent whitespace rather than moving to a larger distant gap', () => {
    const p = placeTranslationPopover(anchor, source, size, viewport, [{ ...source, top: 180, bottom: 242 }, source])!;
    expect(p.side).toBe('above'); expect(p.y).toBe(250); expect(p.maxHeight).toBe(56);
    expect(p.y + p.maxHeight).toBe(anchor.top - 8);
  });
  it('shrinks for a tall source while staying attached to the icon', () => {
    const tall = { ...source, top: 180, bottom: 650 };
    const icon = { ...anchor, top: 174, bottom: 198 };
    const p = placeTranslationPopover(icon, tall, size, viewport, [tall])!;
    expect(p.side).toBe('above'); expect(p.maxHeight).toBe(66); expect(p.y).toBe(100);
    expect(p.y + p.maxHeight).toBe(icon.top - 8);
    const compact = placeTranslationPopover(icon, tall, size, { ...viewport, top: 126 }, [tall])!;
    expect(compact.side).toBe('above'); expect(compact.y).toBe(126); expect(compact.maxHeight).toBe(40);
  });
  it('keeps collision-adjusted icons and rotated source bounds clear', () => {
    const icon = { ...anchor, top: 355, bottom: 379 };
    const p = placeTranslationPopover(icon, source, size, viewport, [source])!;
    expect(p.y + p.maxHeight).toBe(source.top - 8);
    const rotated = { ...source, top: 300, bottom: 600 };
    const q = placeTranslationPopover(anchor, rotated, size, viewport, [rotated])!;
    expect(q.y + q.maxHeight).toBe(rotated.top - 8);
  });
  it('clamps horizontally on narrow screens and refuses to cover the selected paragraph', () => {
    const mobile = { left: 12, top: 100, right: 378, bottom: 720 };
    const p = placeTranslationPopover({ ...anchor, left: 300 }, source, size, mobile, [source])!;
    expect(p.x).toBe(58); expect(p.x + size.width).toBe(mobile.right);
    expect(placeTranslationPopover(anchor, { ...source, top: 100, bottom: 720 }, size, mobile, [])).toBeUndefined();
  });
});
