import { useRef, useState, type PointerEvent } from 'react';
import { addScreenshot, toast, useApp } from '../store';
import { uid, type Point, type Quad } from '../types';
import { cropPage, rotateRegion, selectionRect } from '../lib/screenshots';
import { sha256 } from '../lib/pdf';

export function ScreenshotSelection({ canvas, documentId, pageIndex, rotation }: {
  canvas: HTMLCanvasElement; documentId: string; pageIndex: number; rotation: number;
}) {
  const drag = useRef<{ start: Point; pointerId: number } | undefined>(undefined);
  const [rect, setRect] = useState<Quad>(); const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  function point(e: PointerEvent<HTMLDivElement>): Point {
    const bounds = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - bounds.left) / bounds.width, y: (e.clientY - bounds.top) / bounds.height };
  }
  async function finish(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    const selected = selectionRect(drag.current.start, point(e));
    const bounds = e.currentTarget.getBoundingClientRect(); drag.current = undefined; setRect(undefined);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (selected.width * bounds.width < 8 || selected.height * bounds.height < 8) return;
    const epoch = useApp.getState().documentEpoch;
    savingRef.current = true; setSaving(true);
    try {
      const cropped = cropPage(canvas, selected); const blob = await cropped.blob;
      const assetId = uid(); const hash = await sha256(await blob.arrayBuffer());
      await addScreenshot(documentId, { assetId, sha256: hash, size: blob.size, width: cropped.width, height: cropped.height,
        pageIndex, region: rotateRegion(selected, -rotation), rotation }, { id: assetId, blob, sha256: hash }, epoch);
    } catch { toast('截圖或本機儲存失敗，請縮小框選區域並確認儲存空間後重試。', 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <div className="screenshot-selection" data-testid={`screenshot-selection-${pageIndex}`} aria-label={`框選第 ${pageIndex + 1} 頁截圖`} aria-busy={saving}
    onPointerDown={e => {
      if (e.button !== 0 || !e.isPrimary || savingRef.current || drag.current) return;
      e.preventDefault(); window.getSelection()?.removeAllRanges();
      drag.current = { start: point(e), pointerId: e.pointerId }; setRect(undefined); e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => { if (drag.current?.pointerId === e.pointerId) setRect(selectionRect(drag.current.start, point(e))); }}
    onPointerUp={e => { e.stopPropagation(); void finish(e); }}
    onPointerCancel={() => { drag.current = undefined; setRect(undefined); }}
    onLostPointerCapture={() => { drag.current = undefined; setRect(undefined); }}>
    {rect && <div className="screenshot-rectangle" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />}
    {saving && <span className="screenshot-saving" role="status">正在儲存截圖…</span>}
  </div>;
}
