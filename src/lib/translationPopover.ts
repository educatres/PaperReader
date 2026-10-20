export interface PopoverBounds { left: number; top: number; right: number; bottom: number }
interface PopoverSize { width: number; height: number }

// Find a vertical gap outside the complete source paragraph. Other visible PDF
// text also occupies space, so moving up cannot cover the preceding paragraph.
export function placeTranslationPopover(source: PopoverBounds, size: PopoverSize, viewport: PopoverBounds, text: PopoverBounds[]) {
  const gap = 8; const minimumHeight = Math.min(48, size.height);
  const x = Math.max(viewport.left, Math.min(viewport.right - size.width, source.left));
  const occupied = text.filter(r => r.right > x - gap && r.left < x + size.width + gap)
    .map(r => ({ top: Math.max(viewport.top, r.top - gap), bottom: Math.min(viewport.bottom, r.bottom + gap) }))
    .filter(r => r.bottom > r.top).sort((a, b) => a.top - b.top);
  const free: { top: number; bottom: number }[] = [];
  let top = viewport.top;
  for (const r of occupied) {
    if (r.top > top) free.push({ top, bottom: r.top });
    top = Math.max(top, r.bottom);
  }
  if (top < viewport.bottom) free.push({ top, bottom: viewport.bottom });
  const candidates = free.flatMap(r => {
    const above = { top: r.top, bottom: Math.min(r.bottom, source.top - gap), side: 'above' as const };
    const below = { top: Math.max(r.top, source.bottom + gap), bottom: r.bottom, side: 'below' as const };
    return [above, below].filter(r => r.bottom - r.top >= minimumHeight);
  });
  // Prefer a full-height window above the text, then below; shrink only when
  // neither side fits. Nearest gaps win within each category.
  candidates.sort((a, b) => {
    const fullA = a.bottom - a.top >= size.height; const fullB = b.bottom - b.top >= size.height;
    if (fullA !== fullB) return fullA ? -1 : 1;
    if (a.side !== b.side) return a.side === 'above' ? -1 : 1;
    return a.side === 'above' ? b.bottom - a.bottom : a.top - b.top;
  });
  const chosen = candidates[0];
  if (!chosen) return;
  const maxHeight = Math.min(size.height, chosen.bottom - chosen.top);
  return { x, y: chosen.side === 'above' ? chosen.bottom - maxHeight : chosen.top, maxHeight, side: chosen.side };
}
