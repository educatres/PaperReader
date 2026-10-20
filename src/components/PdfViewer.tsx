import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction, type PointerEvent as ReactPointerEvent } from 'react';
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Hand, Highlighter, MousePointer2, Search, X, ZoomIn, ZoomOut, Maximize, RotateCw, FileUp, ScanText, LoaderCircle, Scan, ExternalLink, PanelLeftClose, Eraser } from 'lucide-react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { useApp, addHighlight, deletePdfHighlight, toast, savePdfPreference } from '../store';
import { projectStorageKey, registerEditor } from '../lib/projectContext';
import { openPaper, sha256 } from '../lib/pdf';
import { rangeQuads, resolveAnchor, selectionOffsets, normalizeText } from '../lib/anchors';
import { colors, uid, now, type Color, type Highlight, type Screenshot } from '../types';
import { ScreenshotSelection } from './ScreenshotSelection';
import { rotateRegion } from '../lib/screenshots';
import { focusSharedNote, readerWindow } from '../lib/windows';
import { Languages } from 'lucide-react';
import { PdfTranslationDialog } from './PdfTranslationDialog';
import { PdfTranslationMarkers } from './PdfTranslationMarkers';
import { usePdfTranslation } from '../lib/pdfTranslation';

function useDocumentSetting<T extends string | number>(documentId: string, name: string, fallback: T, valid: (value: unknown) => boolean): [T, (action: SetStateAction<T>) => void] {
  const [cache, setCache] = useState<Record<string, T>>({});
  let value = cache[documentId] ?? fallback;
  if (!(documentId in cache)) { try { const saved = JSON.parse(sessionStorage.getItem(projectStorageKey(`pdf.${documentId}.${name}`)) || 'null'); if (valid(saved)) value = saved as T; } catch { /* Use the default view. */ } }
  return [value, action => {
    const next = typeof action === 'function' ? action(value) : action;
    setCache(current => ({ ...current, [documentId]: next }));
    try { sessionStorage.setItem(projectStorageKey(`pdf.${documentId}.${name}`), JSON.stringify(next)); savePdfPreference(); } catch { /* The view still works in memory. */ }
  }];
}

function PdfPage({ pdf, documentId, pageIndex, width, rotation, mode, highlights, focused, focusedScreenshot, focusSerial, scrollRoot, onActivate, onFocusNote, onUnresolved, showTranslations }: {
  pdf: PDFDocumentProxy; pageIndex: number; width: number; rotation: number; mode: string;
  documentId: string; focusedScreenshot?: Screenshot;
  highlights: Highlight[]; focused?: string; focusSerial: number; scrollRoot: HTMLElement | null;
  onActivate: (page: number) => void; onFocusNote: (id: string) => void; onUnresolved: (id: string) => void;
  showTranslations: boolean;
}) {
  const pageRef = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false); const [ratio, setRatio] = useState(Math.SQRT2);
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const [resolved, setResolved] = useState<Record<string, ReturnType<typeof rangeQuads>>>({});
  useEffect(() => {
    const element = pageRef.current!;
    const observer = new IntersectionObserver(entries => { setVisible(entries[0].isIntersecting); }, { root: scrollRoot, rootMargin: '650px 0px' });
    const active = new IntersectionObserver(entries => { if (entries[0].isIntersecting) onActivate(pageIndex + 1); }, { root: scrollRoot, rootMargin: '-15% 0px -65% 0px' });
    observer.observe(element); active.observe(element); return () => { observer.disconnect(); active.disconnect(); };
  }, [scrollRoot, pageIndex, onActivate]);
  useEffect(() => {
    if (!visible) { setReady(false); return; }
    let cancelled = false; let render: { cancel: () => void } | undefined; let textLayer: TextLayer | undefined;
    setReady(false); setError('');
    (async () => {
      const page = await pdf.getPage(pageIndex + 1); if (cancelled) return;
      const rotate = (page.rotate + rotation) % 360;
      const base = page.getViewport({ scale: 1, rotation: rotate });
      const viewport = page.getViewport({ scale: width / base.width, rotation: rotate });
      setRatio(viewport.height / viewport.width);
      const container = pageRef.current!;
      container.style.setProperty('--scale-factor', String(viewport.scale));
      container.style.setProperty('--total-scale-factor', String(viewport.scale));
      container.dataset.rotation = String(rotate);
      const canvas = canvasRef.current!; const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
      const task = page.render({ canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }); render = task;
      // Cancellation can reject before getTextContent finishes. Attach a handler
      // immediately; Promise.all below still observes the original render error.
      void task.promise.catch(() => {});
      const content = await page.getTextContent(); if (cancelled) return;
      const layer = layerRef.current!; layer.replaceChildren();
      textLayer = new TextLayer({ textContentSource: content, container: layer, viewport });
      await Promise.all([task.promise, textLayer.render()]);
      if (!cancelled) setReady(true);
    })().catch(e => { if (!cancelled && e?.name !== 'RenderingCancelledException' && e?.name !== 'AbortException') setError('這一頁載入失敗，請重新開啟 PDF。'); });
    return () => { cancelled = true; render?.cancel(); textLayer?.cancel(); };
  }, [pdf, pageIndex, width, rotation, visible]);
  useLayoutEffect(() => {
    if (!ready || !layerRef.current || !pageRef.current) return;
    const result: Record<string, ReturnType<typeof rangeQuads>> = {};
    for (const h of highlights) {
      const quads = resolveAnchor(layerRef.current, pageRef.current, h);
      if (quads?.length) result[h.id] = quads;
      else {
        const rotate = Number(pageRef.current.dataset.rotation || 0);
        if (rotate === h.rotation) result[h.id] = h.quads;
        else onUnresolved(h.id);
      }
    }
    setResolved(result);
  }, [ready, highlights, onUnresolved]);
  useEffect(() => {
    if (!ready || !focused) return;
    const element = pageRef.current?.querySelector(`[data-highlight-id="${focused}"]`);
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [ready, focused, focusSerial]);
  const sourceRegion = focusedScreenshot && rotateRegion(focusedScreenshot.region, Number(pageRef.current?.dataset.rotation || 0));
  useEffect(() => {
    if (ready && focusedScreenshot) pageRef.current?.querySelector('.screenshot-source-region')?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [ready, !!focusedScreenshot, focusSerial]);
  return <div className={`pdf-page ${mode}`} ref={pageRef} style={{ width, height: width * ratio }} data-page-index={pageIndex} aria-label={`第 ${pageIndex + 1} 頁`}>
    {visible ? <><canvas ref={canvasRef} /><div ref={layerRef} className="textLayer" />
      <div className="highlight-layer">{highlights.flatMap(h => (resolved[h.id] || (rotation === 0 && h.rotation === 0 ? h.quads : [])).map((q, i) =>
        <button key={`${h.id}-${i}`} data-highlight-id={h.id} title={`${mode === 'erase' ? '刪除螢光標註（保留便條）' : '定位便條'}：${h.selectedText.slice(0, 50)}`} aria-label={`${mode === 'erase' ? '刪除螢光標註（保留便條）' : '定位便條'}：${h.selectedText.slice(0, 30)}`}
          className={`pdf-highlight ${focused === h.id ? 'focused' : ''}`} style={{ left: `${q.x * 100}%`, top: `${q.y * 100}%`, width: `${q.width * 100}%`, height: `${q.height * 100}%`, backgroundColor: colors[h.color] }}
          onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={() => mode === 'erase' ? deletePdfHighlight(h.id) : onFocusNote(h.noteId)} />))}</div>
      {ready && showTranslations && <PdfTranslationMarkers documentId={documentId} pageIndex={pageIndex} width={width} height={width * ratio} rotation={Number(pageRef.current?.dataset.rotation || 0)} scrollRoot={scrollRoot} blocked={mode === 'screenshot'} deleting={mode === 'erase'} />}
      {ready && mode === 'screenshot' && canvasRef.current && <ScreenshotSelection key={`${width}-${rotation}`} canvas={canvasRef.current} documentId={documentId} pageIndex={pageIndex} rotation={Number(pageRef.current?.dataset.rotation || 0)} />}
      {ready && sourceRegion && <div className="screenshot-source-region" aria-label="截圖來源區域" style={{ left: `${sourceRegion.x * 100}%`, top: `${sourceRegion.y * 100}%`, width: `${sourceRegion.width * 100}%`, height: `${sourceRegion.height * 100}%` }} />}
      {!ready && !error && <span className="page-loading"><LoaderCircle className="spin" size={22} /></span>}
      {error && <span className="page-error">{error}</span>}</> : <span className="page-placeholder">{pageIndex + 1}</span>}
    <span className="page-number-label">{pageIndex + 1}</span>
  </div>;
}

export function PdfViewer({ onImport, busy, onCollapse, onPopout }: { onImport: () => void; busy?: string; onCollapse?: () => void; onPopout?: () => void }) {
  const { workspace, preferences, focusHighlightId, focusScreenshotNoteId, sourceFocusSerial, documentEpoch } = useApp();
  const paper = workspace.documents.find(d => d.id === workspace.activeDocumentId);
  const [pdf, setPdf] = useState<PDFDocumentProxy>(); const [error, setError] = useState('');
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationVisibility, setTranslationVisibility] = useDocumentSetting<'yes' | 'no'>(paper?.id || '', 'translations', 'yes', v => v === 'yes' || v === 'no');
  const translationActive = usePdfTranslation(s => s.active);
  useEffect(() => { setTranslationOpen(false); }, [paper?.id]);
  const [mode, setMode] = useDocumentSetting<'highlight' | 'select' | 'pan' | 'screenshot' | 'erase'>(paper?.id || '', 'mode', 'highlight', value => ['highlight', 'select', 'pan', 'screenshot', 'erase'].includes(String(value))); const [color, setColor] = useState<Color>('yellow');
  const [zoom, setZoom] = useDocumentSetting<number>(paper?.id || '', 'zoom', 1, value => typeof value === 'number' && value >= .5 && value <= 2.5);
  const [rotation, setRotation] = useDocumentSetting<number>(paper?.id || '', 'rotation', 0, value => typeof value === 'number' && [0, 90, 180, 270].includes(value));
  const [paneWidth, setPaneWidth] = useState(600); const [page, setPage] = useState(preferences.lastPage[paper?.id || ''] || 1); const [pageInput, setPageInput] = useState(String(page));
  const readingPosition = useRef({ documentId: paper?.id, page, loaded: !!pdf }); readingPosition.current = { documentId: paper?.id, page, loaded: !!pdf };
  useEffect(() => registerEditor(() => {
    const current = readingPosition.current; if (!current.documentId || !current.loaded) return;
    const p = useApp.getState().preferences;
    useApp.getState().pref({ lastPage: { ...p.lastPage, [current.documentId]: current.page } });
  }, () => readingPosition.current), []);
  const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState(''); const [hit, setHit] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null); const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const attachRoot = useCallback((element: HTMLDivElement | null) => { scrollRef.current = element; setRoot(element); }, []);
  const pan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const lastSelection = useRef('');
  const screenshotSource = workspace.notes.find(n => n.id === focusScreenshotNoteId && n.documentId === paper?.id)?.screenshot;
  useEffect(() => {
    if (mode !== 'screenshot' && mode !== 'erase') return;
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') setMode('select'); };
    window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel);
  }, [mode]);
  useEffect(() => { setPdf(undefined); setError(''); setQuery(''); const saved = useApp.getState().preferences.lastPage[paper?.id || ''] || 1; setPage(saved); setPageInput(String(saved)); let cancelled = false;
    if (paper) openPaper(paper.id).then(doc => { if (!cancelled) setPdf(doc); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [paper?.id, paper?.sha256, documentEpoch]);
  useEffect(() => {
    if (!root) return;
    const resize = new ResizeObserver(e => setPaneWidth(e[0].contentRect.width)); resize.observe(root); return () => resize.disconnect();
  }, [root]);
  const goToPage = useCallback((n: number) => {
    if (!paper || !pdf) return;
    const target = Math.max(1, Math.min(paper.pageCount, n));
    scrollRef.current?.querySelector(`[data-page-index="${target - 1}"]`)?.scrollIntoView({ behavior: 'instant', block: 'start' });
    setPage(target); setPageInput(String(target));
  }, [paper, pdf]);
  useEffect(() => { if (pdf && paper) { const h = useApp.getState().workspace.highlights.find(h => h.id === useApp.getState().focusHighlightId && h.documentId === paper.id); const timer = setTimeout(() => goToPage(screenshotSource ? screenshotSource.pageIndex + 1 : h?.displayPage || preferences.lastPage[paper.id] || 1), 100); return () => clearTimeout(timer); } }, [pdf]); // saved reading position
  const activate = useCallback((n: number) => { setPage(n); setPageInput(String(n)); }, []);
  useEffect(() => {
    if (!paper || !pdf) return;
    const timer = setTimeout(() => { const p = useApp.getState().preferences; useApp.getState().pref({ lastPage: { ...p.lastPage, [paper.id]: page } }); }, 350);
    return () => clearTimeout(timer);
  }, [page, paper?.id, pdf]);
  useEffect(() => {
    const h = workspace.highlights.find(h => h.id === focusHighlightId);
    if (h && h.documentId === paper?.id && pdf) goToPage(h.displayPage);
    else if (screenshotSource && pdf) goToPage(screenshotSource.pageIndex + 1);
    else if (!focusHighlightId && sourceFocusSerial && pdf) goToPage(1);
  }, [focusHighlightId, focusScreenshotNoteId, sourceFocusSerial, paper?.id, pdf]);
  const focusNote = useCallback((id: string) => {
    const note = useApp.getState().workspace.notes.find(n => n.id === id);
    if (note?.hidden) useApp.getState().edit(w => { const n = w.notes.find(n => n.id === id); if (n) n.hidden = false; });
    const externalBoard = readerWindow || useApp.getState().preferences.boardCollapsed;
    useApp.setState({ selectedNoteId: id, focusNoteId: externalBoard ? undefined : id });
    if (externalBoard) focusSharedNote(id);
  }, []);
  const unresolved = useCallback((id: string) => {
    const h = useApp.getState().workspace.highlights.find(h => h.id === id);
    if (h?.status !== 'unresolved') { useApp.getState().edit(w => { const h = w.highlights.find(h => h.id === id); if (h) h.status = 'unresolved'; }, false); toast('部分標記無法還原，請回到原頁重新標註。', 'error'); }
  }, []);
  async function captureSelection() {
    if (mode !== 'highlight' || !paper) return;
    const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0); const raw = range.toString(); if (!raw.trim()) return;
    const start = range.startContainer.parentElement?.closest<HTMLElement>('.pdf-page');
    const end = range.endContainer.parentElement?.closest<HTMLElement>('.pdf-page');
    if (!start || !scrollRef.current?.contains(start)) return;
    if (start !== end) { selection.removeAllRanges(); toast('跨頁選取請分頁標記，確保每個來源都能正確定位。', 'error'); return; }
    const layer = start.querySelector<HTMLElement>('.textLayer');
    if (!layer?.contains(range.startContainer) || !layer.contains(range.endContainer)) return;
    const pageIndex = Number(start.dataset.pageIndex); const offsets = selectionOffsets(layer, range);
    const key = `${paper.id}:${pageIndex}:${offsets.start}:${offsets.end}:${selection.toString()}`;
    if (lastSelection.current === key) return;
    const quads = rangeQuads(range, start); if (!quads.length) return;
    lastSelection.current = key; setTimeout(() => { lastSelection.current = ''; }, 500);
    const content = layer.textContent || ''; const timestamp = now();
    const epoch = useApp.getState().documentEpoch;
    const highlight: Highlight = { id: uid(), documentId: paper.id, noteId: uid(), pageIndex, displayPage: pageIndex + 1,
      selectedText: raw, rawText: selection.toString() || raw, normalizedText: normalizeText(selection.toString() || raw), textRange: offsets, prefix: content.slice(Math.max(0, offsets.start - 48), offsets.start),
      suffix: content.slice(offsets.end, offsets.end + 48), textQuoteHash: '', quads, coordinateSystem: 'normalized',
      rotation: Number(start.dataset.rotation || 0), color, status: 'resolved', schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp };
    selection.removeAllRanges();
    highlight.textQuoteHash = await sha256(new TextEncoder().encode(raw).buffer);
    if (epoch !== useApp.getState().documentEpoch || !useApp.getState().workspace.documents.some(d => d.id === highlight.documentId)) return;
    addHighlight(highlight);
  }
  function startPan(e: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== 'pan' || e.button !== 0 || !e.isPrimary) return;
    e.preventDefault(); window.getSelection()?.removeAllRanges();
    pan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId); setPanning(true);
  }
  function movePan(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = pan.current; if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.scrollLeft = drag.left + drag.x - e.clientX;
    e.currentTarget.scrollTop = drag.top + drag.y - e.clientY;
  }
  function stopPan(e: ReactPointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId !== e.pointerId) return;
    pan.current = null; setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const hits = query.trim() && paper ? paper.pages.flatMap((text, i) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()) ? [i + 1] : []) : [];
  function jumpSearch(direction: number) { if (!hits.length) return; const next = (hit + direction + hits.length) % hits.length; setHit(next); goToPage(hits[next]); }
  useEffect(() => { setHit(0); if (hits.length) goToPage(hits[0]); }, [query]);
  const noText = paper && !paper.pages[page - 1]?.trim();
  return <section className="pdf-pane" aria-label="PDF 閱讀器">
    {paper ? <>
      <div className="pdf-toolbar"><div className="pdf-tools">
        <div className="segmented"><button title="螢光筆：選字後自動新增便條" aria-label="螢光筆模式" aria-pressed={mode === 'highlight'} className={mode === 'highlight' ? 'active' : ''} onClick={() => setMode('highlight')}><Highlighter size={16} /></button>
          <button title="選取與複製文字" aria-label="選字模式" aria-pressed={mode === 'select'} className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')}><MousePointer2 size={16} /></button>
          <button title="手掌：拖曳移動 PDF" aria-label="手掌模式" aria-pressed={mode === 'pan'} className={mode === 'pan' ? 'active' : ''} onClick={() => { window.getSelection()?.removeAllRanges(); setMode('pan'); }}><Hand size={16} /></button>
          <button title="拖曳框選 PDF 截圖，Esc 取消" aria-label="截圖模式" aria-pressed={mode === 'screenshot'} className={mode === 'screenshot' ? 'active' : ''} onClick={() => { window.getSelection()?.removeAllRanges(); setMode(mode === 'screenshot' ? 'select' : 'screenshot'); }}><Scan size={16} /></button>
          <button title="點選螢光標註或翻譯圖示刪除；便條保留，Esc 結束" aria-label="刪除 PDF 標註" aria-pressed={mode === 'erase'} className={mode === 'erase' ? 'active' : ''} onClick={() => { window.getSelection()?.removeAllRanges(); setMode(mode === 'erase' ? 'select' : 'erase'); }}><Eraser size={16} /></button></div>
        <div className="color-palette">{(Object.keys(colors) as Color[]).map(c => <button key={c} className={`color-dot ${color === c ? 'active' : ''}`} style={{ background: colors[c] }} title={`${({ yellow: '黃色', green: '綠色', pink: '粉色', blue: '藍色' })[c]}標記`} aria-label={`${c} highlight`} onClick={() => { setColor(c); setMode('highlight'); }} />)}</div>
        <div className="toolbar-divider" />
        <button className="icon-button" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} aria-label="縮小 PDF"><ZoomOut size={16} /></button>
        <span className="zoom-value">{Math.round(zoom * 100)}%</span>
        <button className="icon-button" onClick={() => setZoom(z => Math.min(2.5, z + 0.25))} aria-label="放大 PDF"><ZoomIn size={16} /></button>
        <button className="icon-button optional-tool" onClick={() => setZoom(1)} aria-label="適合寬度" title="適合寬度"><Maximize size={15} /></button>
        <button className="icon-button optional-tool" onClick={() => setRotation(r => (r + 90) % 360)} aria-label="旋轉 PDF" title="旋轉頁面"><RotateCw size={15} /></button>
        <button className="icon-button" title="搜尋 PDF" aria-label="搜尋 PDF" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={17} /></button>
      </div><div className="page-controls" role="group" aria-label="PDF 翻頁">
        <button className="icon-button" onClick={() => goToPage(page - 1)} disabled={page <= 1} aria-label="上一頁" title="上一頁"><ChevronLeft size={15} /></button>
        <input value={pageInput} aria-label="頁碼" inputMode="numeric" onChange={e => setPageInput(e.target.value)} onBlur={() => goToPage(Number(pageInput) || 1)} onKeyDown={e => { if (e.key === 'Enter') goToPage(Number(pageInput) || 1); }} /><span>/ {paper.pageCount}</span>
        <button className="icon-button" onClick={() => goToPage(page + 1)} disabled={page >= paper.pageCount} aria-label="下一頁" title="下一頁"><ChevronRight size={15} /></button>
      </div><div className="pdf-pane-tools"><button className="icon-button" title="逐段翻譯" aria-label="逐段翻譯" onClick={() => setTranslationOpen(true)}>{translationActive ? <LoaderCircle size={16} className="spin" /> : <Languages size={16} />}</button>{onPopout && <button className="icon-button" title="在新視窗閱讀" aria-label="在新視窗閱讀" onClick={onPopout}><ExternalLink size={16} /></button>}{onCollapse && <button className="icon-button" title="隱藏 PDF 面板" aria-label="隱藏 PDF 面板" onClick={onCollapse}><PanelLeftClose size={17} /></button>}</div></div>
      {searchOpen && <div className="pdf-search"><Search size={15} /><input autoFocus placeholder="搜尋文獻中的文字…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') jumpSearch(e.shiftKey ? -1 : 1); }} aria-label="PDF 搜尋文字" />
        <span>{hits.length ? `${hit + 1} / ${hits.length} 頁` : query ? '找不到文字' : ''}</span><button className="icon-button" onClick={() => jumpSearch(-1)} aria-label="上一個搜尋結果"><ChevronLeft size={16} /></button><button className="icon-button" onClick={() => jumpSearch(1)} aria-label="下一個搜尋結果"><ChevronRight size={16} /></button><button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="關閉搜尋"><X size={16} /></button></div>}
      {noText && <div className="ocr-notice"><ScanText size={15} />這一頁需要 OCR 才能文字標註；可使用截圖模式留存。</div>}
      {mode === 'screenshot' && <div className="screenshot-notice"><Scan size={15} /><span>在單頁內拖曳框選，放開即新增截圖便條。文字留白，AI 只讀取自行輸入的文字。</span><button onClick={() => setMode('select')}>結束截圖 · Esc</button></div>}
      {mode === 'erase' && <div className="pdf-erase-notice" role="status"><Eraser size={15} /><span>點選螢光標註或翻譯圖示即可刪除；白板便條保留。可使用復原恢復。</span><button onClick={() => setMode('select')}>結束刪除 · Esc</button></div>}
      <div className={`pdf-scroll mode-${mode}${panning ? ' is-panning' : ''}`} ref={attachRoot}
        onPointerDown={startPan} onPointerMove={movePan} onPointerCancel={stopPan} onLostPointerCapture={stopPan}
        onPointerUp={e => { if (pan.current) stopPan(e); else setTimeout(() => { void captureSelection(); }, 0); }} onKeyUp={e => { if (e.shiftKey) void captureSelection(); }}>
        {error ? <div className="empty-panel"><ScanText size={35} /><h3>無法開啟 PDF</h3><p>{error}</p><button className="primary-button" onClick={onImport}>重新匯入 PDF</button></div> : pdf ?
          Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={`${paper.id}-${documentEpoch}-${i}`} pdf={pdf} documentId={paper.id} pageIndex={i} width={Math.max(1, paneWidth) * zoom} rotation={rotation} mode={mode}
            showTranslations={translationVisibility === 'yes'}
            focusedScreenshot={screenshotSource?.pageIndex === i ? screenshotSource : undefined}
            highlights={workspace.highlights.filter(h => h.documentId === paper.id && h.pageIndex === i && !h.deletedAt)} focused={focusHighlightId} focusSerial={sourceFocusSerial} scrollRoot={root} onActivate={activate} onFocusNote={focusNote} onUnresolved={unresolved} />)
          : <div className="loading-state"><LoaderCircle className="spin" />正在開啟文獻…</div>}
      </div>
    </> : <>{onCollapse && <button className="icon-button empty-pdf-collapse" title="隱藏 PDF 面板" aria-label="隱藏 PDF 面板" onClick={onCollapse}><PanelLeftClose size={17} /></button>}<div className="reader-empty"><div className="paper-illustration"><div /><div /><Highlighter size={29} /></div><span className="eyebrow">你的下一個發現，從這裡開始</span><h2>留住值得思考的每一句。</h2><p>放入一篇論文，標記觸動你的段落，<br />把零散的想法串成自己的知識。</p><button className="primary-button" onClick={onImport}><FileUp size={17} />匯入你的第一篇 PDF</button><span className="empty-hint">也可以將 PDF 直接拖進視窗</span></div></>}
    {busy && <div className="busy-overlay"><LoaderCircle className="spin" size={25} /><p>{busy}</p></div>}
    {translationOpen && paper && <PdfTranslationDialog documentId={paper.id} close={() => setTranslationOpen(false)} shown={translationVisibility === 'yes'} setShown={shown => setTranslationVisibility(shown ? 'yes' : 'no')} />}
  </section>;
}
