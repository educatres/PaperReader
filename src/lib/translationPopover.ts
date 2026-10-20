export interface PopoverBounds { left: number; top: number; right: number; bottom: number }
interface PopoverSize { width: number; height: number }

// Keep the window attached to its icon instead of searching distant page gaps.
// The selected paragraph remains clear; nearby whitespace can shorten the
// window, but surrounding paragraphs must not push it away from its anchor.
export function placeTranslationPopover(anchor: PopoverBounds, source: PopoverBounds, size: PopoverSize, viewport: PopoverBounds, text: PopoverBounds[]) {
  const gap = 8; const minimumHeight = Math.min(40, size.height);
  const x = Math.max(viewport.left, Math.min(viewport.right - size.width, anchor.left));
  const above = Math.min(anchor.top, source.top) - gap;
  const below = Math.max(anchor.bottom, source.bottom) + gap;
  const side = above - viewport.top >= minimumHeight ? 'above' as const : 'below' as const;
  const edge = side === 'above' ? above : below;
  const available = side === 'above' ? edge - viewport.top : viewport.bottom - edge;
  if (available < minimumHeight) return;
  let maxHeight = Math.min(size.height, available);
  // Use adjacent whitespace when it fits at least one readable line. Never
  // jump over a neighboring paragraph just to find a taller empty region.
  const adjacent = text.filter(r => r.right > x - gap && r.left < x + size.width + gap);
  const clearHeight = side === 'above'
    ? edge - Math.max(viewport.top, ...adjacent.filter(r => r.top < edge).map(r => r.bottom + gap))
    : Math.min(viewport.bottom, ...adjacent.filter(r => r.bottom > edge).map(r => r.top - gap)) - edge;
  if (clearHeight >= minimumHeight) maxHeight = Math.min(maxHeight, clearHeight);
  return { x, y: side === 'above' ? edge - maxHeight : edge, maxHeight, side };
}
