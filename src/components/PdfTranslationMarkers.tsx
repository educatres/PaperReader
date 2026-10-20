import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquareText } from 'lucide-react';
import { deletePdfTranslation, useApp } from '../store';
import { rotateRegion } from '../lib/screenshots';

// Pages share a single popover within this window, including pinned state.
let activePopover: { owner: string; pinned: boolean; close: () => void } | undefined;

export function PdfTranslationMarkers({ documentId, pageIndex, width, height, rotation, scrollRoot, blocked, deleting }: {
  documentId: string; pageIndex: number; width: number; height: number; rotation: number; scrollRoot: HTMLElement | null; blocked: boolean; deleting: boolean;
}) {
  const workspace = useApp(s => s.workspace);
  const translations = useApp(s => s.persistedPdfTranslations);
  const entries = workspace.pdfParagraphs.filter(p => p.documentId === documentId && p.pageIndex === pageIndex).flatMap(p => {
    const t = translations.find(t => t.paragraphId === p.id && t.sourceHash === p.sourceHash && t.layoutVersion === p.layoutVersion);
    return t?.text.trim() && workspace.pdfTranslations.some(live => live.id === t.id) ? [{ paragraph: p, translation: t }] : [];
  });
  const [open, setOpen] = useState<{ id: string; button: HTMLButtonElement; pinned: boolean }>();
  const openRef = useRef(open); openRef.current = open;
  const popupRef = useRef<HTMLDivElement>(null); const markersRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suppress = useRef(0); const dragging = useRef(false);
  const returningFocus = useRef(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const popupId = useId();
  const clearTimer = () => { clearTimeout(timer.current); };
  const close = () => { clearTimer(); if (activePopover?.owner === popupId) activePopover = undefined; openRef.current = undefined; setOpen(undefined); };
  const show = (id: string, button: HTMLButtonElement, pinned: boolean) => {
    if (!pinned && activePopover?.pinned) return;
    if (activePopover?.owner !== popupId) activePopover?.close();
    activePopover = { owner: popupId, pinned, close };
    const next = { id, button, pinned }; openRef.current = next; setOpen(next);
  };
  const requestOpen = (id: string, button: HTMLButtonElement, focused = false) => {
    clearTimer();
    if (blocked || deleting || dragging.current || (!focused && performance.now() < suppress.current) || openRef.current?.pinned) return;
    timer.current = setTimeout(() => show(id, button, false), 180);
  };
  const requestClose = () => {
    clearTimer(); if (!openRef.current?.pinned) timer.current = setTimeout(close, 180);
  };
  useEffect(() => { close(); return () => { clearTimer(); if (activePopover?.owner === popupId) activePopover = undefined; }; }, [width, height, rotation, blocked, deleting, documentId]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (markersRef.current?.contains(e.target as Node) || popupRef.current?.contains(e.target as Node)) return;
      dragging.current = true; close();
    };
    const up = () => { dragging.current = false; };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !openRef.current) return;
      const button = openRef.current.button; suppress.current = performance.now() + 400; close(); returningFocus.current = true; button.focus(); returningFocus.current = false; e.stopPropagation();
    };
    document.addEventListener('pointerdown', down, true); document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true); document.addEventListener('keydown', key);
    return () => { clearTimer(); document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true); document.removeEventListener('keydown', key); };
  }, []);
  const selected = entries.find(e => e.paragraph.id === open?.id);
  useEffect(() => { if (open && !selected) close(); }, [open, !!selected]);
  useLayoutEffect(() => {
    if (!open || !selected) return;
    const place = () => {
      const anchor = open.button.getBoundingClientRect(); const root = scrollRoot?.getBoundingClientRect();
      if (!open.button.isConnected || (root && (anchor.bottom < root.top || anchor.top > root.bottom || anchor.right < root.left || anchor.left > root.right))) { close(); return; }
      const popup = popupRef.current?.getBoundingClientRect(); const w = popup?.width || 320; const h = popup?.height || 100;
      const x = Math.max(12, Math.min(window.innerWidth - w - 12, anchor.right + 8 + w <= window.innerWidth - 12 ? anchor.right + 8 : anchor.left - w - 8));
      const y = Math.max(12, Math.min(window.innerHeight - h - 12, anchor.top));
      setPosition(prev => prev.x === x && prev.y === y ? prev : { x, y });
    };
    place(); const observer = new ResizeObserver(place); if (popupRef.current) observer.observe(popupRef.current);
    scrollRoot?.addEventListener('scroll', place); window.addEventListener('resize', place);
    return () => { observer.disconnect(); scrollRoot?.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }, [open, selected?.translation.text, scrollRoot]);
  const placed: { x: number; y: number }[] = [];
  const hitSize = window.matchMedia('(pointer: coarse)').matches ? 44 : 24;
  const half = hitSize / 2;
  return <div className={'pdf-translation-layer' + (blocked ? ' blocked' : '')} ref={markersRef} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
    {entries.map(({ paragraph }) => {
      const first = paragraph.lines[0]; const baseWidth = rotation % 180 ? height : width;
      const marker = rotateRegion({ x: Math.max(0, paragraph.columnBounds.left - 14 / baseWidth), y: first.y, width: .00001, height: first.height }, rotation);
      const x = Math.max(half, Math.min(width - half, marker.x * width)); let y = Math.max(half, marker.y * height + marker.height * height / 2);
      for (const p of placed) if (Math.abs(x - p.x) < hitSize && Math.abs(y - p.y) < hitSize) y = p.y + hitSize;
      y = Math.min(height - half, y); placed.push({ x, y });
      return <button key={paragraph.id} type="button" className="pdf-translation-marker" style={{ left: x, top: y }}
        data-paragraph-id={paragraph.id} aria-label={(deleting ? '刪除第 ' : '查看第 ') + (pageIndex + 1) + ' 頁第 ' + (paragraph.order + 1) + ' 段翻譯'}
        aria-expanded={open?.id === paragraph.id} aria-controls={open?.id === paragraph.id ? popupId : undefined}
        onPointerEnter={e => requestOpen(paragraph.id, e.currentTarget)} onPointerLeave={requestClose}
        onFocus={e => { if (!returningFocus.current) requestOpen(paragraph.id, e.currentTarget, true); }} onBlur={requestClose}
        onClick={e => {
          clearTimer();
          if (deleting) { close(); deletePdfTranslation(paragraph.id); return; }
          if (openRef.current?.id === paragraph.id && openRef.current.pinned) { suppress.current = performance.now() + 400; close(); }
          else show(paragraph.id, e.currentTarget, true);
        }} onKeyDown={e => {
          if (!deleting && e.key === 'Tab' && !e.shiftKey && openRef.current?.id === paragraph.id) {
            e.preventDefault(); clearTimer(); popupRef.current?.focus();
          }
        }}><MessageSquareText size={15} /></button>;
    })}
    {selected && !blocked && !deleting && selected.paragraph.lines.map((line, i) => {
      const q = rotateRegion(line, rotation);
      return <span className="translation-source-outline" key={i} style={{ left: q.x * width, top: q.y * height, width: q.width * width, height: q.height * height }} />;
    })}
    {selected && !blocked && !deleting && createPortal(<div ref={popupRef} id={popupId} className="translation-popover" role="region" aria-label="中文譯文" tabIndex={0}
      style={{ left: position.x, top: position.y }} onPointerEnter={clearTimer} onPointerLeave={requestClose} onFocus={clearTimer} onBlur={requestClose}
      onPointerDown={e => e.stopPropagation()}>{selected.translation.text}</div>, document.body)}
  </div>;
}
