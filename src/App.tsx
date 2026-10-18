import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ChevronUp, CircleHelp, FilePlus2, FolderOpen, Download, KeyRound, ShieldCheck, Sparkles, Check, LoaderCircle, PanelLeft, X, FileText, ArrowUpRight, LockKeyhole, Trash2, HardDrive, Plus, Upload, CheckCircle2, AlertCircle, WifiOff, FileArchive, Braces, NotebookPen } from 'lucide-react';
import { PdfViewer } from './components/PdfViewer';
import { ResearchCanvas } from './components/ResearchCanvas';
import { Settings } from './components/Settings';
import { SummaryDialog } from './components/SummaryDialog';
import { Modal } from './components/Modal';
import { useApp, initialize, toast, createNote, flushSave } from './store';
import { hasKey, useCredentials, useAI, cancelTask, clearAllKeys, providerName } from './lib/ai';
import { importPdf, resetPdfCache } from './lib/pdf';
import { exportJSON, exportMarkdown, exportPack, readImport, restoreImport } from './lib/transfer';
import { db } from './lib/db';
import { emptyWorkspace } from './types';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Do not log research data or credential-bearing state. */ }
  render() { return this.state.error ? <div className="fatal-error"><BookOpen size={40} /><h1>PaperReader 遇到顯示問題</h1><p>已儲存的研究資料仍在這台裝置，請重新整理後再試。</p><button className="primary-button" onClick={() => location.reload()}>重新整理</button></div> : this.props.children; }
}
function ExportDialog({ close }: { close: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title="帶走你的研究" description="定期下載備份，讓研究成果多一份保障。" onClose={close}>
    <div className="export-options"><button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await exportPack(); toast('研究封裝已下載'); close(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <span className="export-icon primary">{busy ? <LoaderCircle className="spin" /> : <FileArchive size={24} />}</span><div><strong>完整研究封裝<span className="recommended">建議備份</span></strong><p>PDF、標記、便條與連線，完整還原到另一台電腦。</p><small>.researchpack · 可重新匯入</small></div><ArrowUpRight size={18} /></button>
      <button disabled={busy} onClick={() => { exportMarkdown(); close(); }}><span className="export-icon"><NotebookPen size={24} /></span><div><strong>Markdown 研究筆記</strong><p>保留原文、頁碼、翻譯、筆記與人工關係。</p><small>.md · 適合寫作與整理</small></div><ArrowUpRight size={18} /></button>
      <button disabled={busy} onClick={() => { exportJSON(); close(); }}><span className="export-icon"><Braces size={24} /></span><div><strong>JSON 註記資料</strong><p>結構化的筆記資料，不含 PDF 原檔。</p><small>.json · 可匯入，PDF 需另行附加</small></div><ArrowUpRight size={18} /></button>
    </div>{error && <div className="inline-error export-error">{error}</div>}<div className="export-footnote"><LockKeyhole size={14} />所有匯出檔都不包含 API key。</div>
  </Modal>;
}
function HelpDialog({ close }: { close: () => void }) {
  return <Modal title="把閱讀變成自己的知識" description="PaperReader 使用指南" onClose={close} wide>
    <div className="help-content">{[
      ['01', '帶入你的文獻', '匯入或拖放 PDF。所有原檔、文字索引與研究筆記只保存在此瀏覽器的 IndexedDB。可在文件列切換多篇論文。'],
      ['02', '標記值得留下的話', '螢光筆模式下直接選字，鬆開滑鼠就會產生一張來源便條。跨行屬於同一張；跨頁請分開標記。選字模式可複製文字。'],
      ['03', '在白板上連結想法', '拖曳便條標題整理位置，從四周的連接點拖曳至另一張便條。雙擊關係線可設定支持、對比或延伸等關係。Shift 可多選。'],
      ['04', '需要時，邀請 AI 協助', '貼上你自己的 OpenAI、CGU 或 Gemini key，選擇模型並測試。OpenAI／CGU 提供 gpt-6-luna、gpt-5.6-luna、自訂模型與低／中／高推理（預設中）。點翻譯／摘要才會傳送該便條原文；全文摘要需再次確認。'],
      ['05', '回查原文，定期備份', '便條右下箭頭可回到 PDF；點 PDF 標記可聚焦便條。JSON 不含 PDF，完整備份請使用研究封裝。AI 的來源範圍需人工核對。'],
      ['06', '留更多空間給閱讀', '文件列右側可隱藏最上方工具列，再按「展開工具列」即可叫回 AI 設定、全文摘要與匯出。收合狀態會保存在這個瀏覽器。'],
      ['07', '整合一組相連的想法', '點選已連線的便條，再按白板上方「關聯摘要」，或便條選單的「摘要這組關聯」。會整理直接與間接連通、未隱藏的便條，參考關係類型、說明與箭頭方向。確認預覽後，產生一張紫色整合便條；N1 等來源按鈕可回查便條。來源變動後可按「再次整合」產生新摘要。'],
    ].map(([n, title, text]) => <div className="help-step" key={n}><b>{n}</b><div><h3>{title}</h3><p>{text}</p></div></div>)}
      <div className="shortcut-row"><span><kbd>Ctrl / ⌘</kbd> + <kbd>O</kbd> 開啟 PDF</span><span><kbd>Ctrl / ⌘</kbd> + <kbd>Z</kbd> 復原</span><span><kbd>N</kbd> 新便條</span><span><kbd>?</kbd> 使用指南</span></div>
      <div className="data-disclosure"><strong>關於本機資料與金鑰</strong><p>GitHub Pages 版本的資料屬於目前網站來源，與 localhost 版本各自獨立。金鑰只存在分頁記憶體，重新整理後會清除，並直接用於向所選供應商驗證。網站沒有帳號、雲端同步或分析追蹤。清除瀏覽器網站資料會刪除研究內容；請定期匯出。掃描 PDF 的 OCR、原生 PDF 圖像理解尚未提供。</p></div>
    </div>
  </Modal>;
}
function AppContent() {
  const { workspace, preferences, ready, saveStatus, settingsOpen, helpOpen, exportOpen } = useApp();
  useCredentials(); const { full } = useAI();
  const currentToast = useApp(s => s.toast);
  const [libraryOpen, setLibraryOpen] = useState(false); const [summaryOpen, setSummaryOpen] = useState(false);
  const [busy, setBusy] = useState(''); const [dragging, setDragging] = useState(false); const [offline, setOffline] = useState(!navigator.onLine);
  const [split, setSplit] = useState(preferences.split); const [mobileView, setMobileView] = useState('read');
  const [storage, setStorage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null); const restoreRef = useRef<HTMLInputElement>(null); const splitRef = useRef<HTMLDivElement>(null);
  const fileBusy = useRef(false); const dragDepth = useRef(0);
  useEffect(() => { void initialize(); const listener = () => setOffline(!navigator.onLine); window.addEventListener('online', listener); window.addEventListener('offline', listener); return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener); }; }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (e.target as HTMLElement).isContentEditable || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); fileRef.current?.click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) useApp.getState().redo(); else useApp.getState().undo(); }
      else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') createNote();
      else if (e.key === '?') useApp.setState({ helpOpen: true });
      else if (e.key === 'Escape') window.getSelection()?.removeAllRanges();
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => { if (libraryOpen) navigator.storage?.estimate().then(s => setStorage(`${((s.usage || 0) / 1024 / 1024).toFixed(1)} MB`)).catch(() => {}); }, [libraryOpen, workspace.documents.length]);
  async function handleFiles(files: File[]) {
    if (fileBusy.current) return; fileBusy.current = true;
    try { for (const file of files) await importPdf(file, setBusy); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { fileBusy.current = false; setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function sample() {
    try { const r = await fetch(`${import.meta.env.BASE_URL}sample.pdf`); if (!r.ok) throw new Error('範例載入失敗，請匯入自己的 PDF。'); await handleFiles([new File([await r.blob()], 'Reading as a Research Practice.pdf', { type: 'application/pdf' })]); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  async function restore(file: File) {
    if (full || Object.keys(useAI.getState().running).length) { toast('請先完成或取消 AI 任務，再還原研究空間。', 'error'); return; }
    setBusy('正在驗證研究封裝…');
    try { const pack = await readImport(file);
      if (confirm(`將還原「${pack.workspace.title}」：${pack.workspace.documents.length} 篇文獻、${pack.workspace.notes.length} 張便條。這會取代目前的研究空間；請先確認已下載備份。是否繼續？`)) await restoreImport(pack);
    } catch { toast('匯入失敗：檔案格式、版本、校驗碼或關聯資料無效。原有研究空間未變更。', 'error'); }
    finally { setBusy(''); if (restoreRef.current) restoreRef.current.value = ''; }
  }
  function removePaper(id: string) {
    const count = workspace.notes.filter(n => n.documentId === id).length;
    if (!confirm(`移除此 PDF 與其 ${count} 張便條、標記及連線？可用復原恢復。`)) return;
    workspace.jobs.filter(j => j.documentId === id && j.status === 'running').forEach(j => cancelTask(j.id));
    useApp.getState().edit(w => { const ids = w.notes.filter(n => n.documentId === id).map(n => n.id); w.documents = w.documents.filter(d => d.id !== id); w.notes = w.notes.filter(n => !ids.includes(n.id)); w.highlights = w.highlights.filter(h => h.documentId !== id); w.edges = w.edges.filter(e => !ids.includes(e.source) && !ids.includes(e.target)); w.jobs = w.jobs.filter(j => j.documentId !== id); if (w.activeDocumentId === id) w.activeDocumentId = w.documents[0]?.id; });
  }
  async function clearWorkspace() {
    if (full || Object.keys(useAI.getState().running).length) { toast('請先取消執行中的 AI 任務。', 'error'); return; }
    if (!confirm('永久清除此網站在本機的所有 PDF、便條、連線與 API key？這無法復原，請先下載研究封裝備份。')) return;
    await flushSave(); clearAllKeys();
    const next = emptyWorkspace();
    await db.transaction('rw', db.workspaces, db.documents, async () => { await db.workspaces.clear(); await db.documents.clear(); await db.workspaces.put(next); });
    resetPdfCache();
    useApp.setState(s => ({ workspace: next, documentEpoch: s.documentEpoch + 1, history: [], future: [], selectedNoteId: undefined, focusNoteId: undefined, focusHighlightId: undefined })); setLibraryOpen(false); toast('本機研究資料與金鑰已清除');
  }
  if (!ready) return <div className="app-loading"><BookOpen size={35} /><span>PaperReader</span><LoaderCircle className="spin" size={20} /></div>;
  return <div className={`app-shell${preferences.toolbarCollapsed ? ' toolbar-collapsed' : ''}`} onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragLeave={e => { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer.files.length) void handleFiles([...e.dataTransfer.files]); }}>
    <header id="top-toolbar" className="app-header" hidden={preferences.toolbarCollapsed}><div className="brand"><span className="brand-symbol"><BookOpen size={22} strokeWidth={1.7} /></span><div><h1>PaperReader<span className="version-tag">BETA</span></h1><span className="brand-tagline">READ. THINK. CONNECT.</span></div></div>
      <div className="header-project"><span>PRIVATE WORKSPACE</span><input aria-label="研究空間名稱" value={workspace.title} onChange={e => useApp.getState().edit(w => { w.title = e.target.value; })} onBlur={() => { if (!workspace.title.trim()) useApp.getState().edit(w => { w.title = '我的研究空間'; }); void flushSave(); }} maxLength={100} /></div>
      <div className="header-actions">
        <button className={`ai-settings-button ${hasKey(preferences.provider) ? 'connected' : ''}`} aria-label={hasKey(preferences.provider) ? providerName(preferences.provider) : '連接你的 AI'} onClick={() => useApp.setState({ settingsOpen: true })}><KeyRound size={15} /><span>{hasKey(preferences.provider) ? providerName(preferences.provider) : '連接你的 AI'}</span><ChevronDown size={13} /></button>
        <button className="secondary-button summary-button" aria-label="全文摘要" disabled={!workspace.documents.length || !!full} onClick={() => setSummaryOpen(true)}><Sparkles size={15} /><span>全文摘要</span></button>
        <button className="export-button" aria-label="匯出研究" onClick={() => useApp.setState({ exportOpen: true })}><Download size={16} /><span>匯出研究</span></button>
        <button className="icon-button help-button" title="使用指南 ?" aria-label="使用指南" onClick={() => useApp.setState({ helpOpen: true })}><CircleHelp size={19} /></button>
      </div>
    </header>
    <nav className="workspace-bar" aria-label="文獻管理">
      <button className={`library-toggle ${libraryOpen ? 'active' : ''}`} onClick={() => setLibraryOpen(!libraryOpen)} title="文獻庫" aria-label="文獻庫"><PanelLeft size={17} /></button>
      <div className="document-tabs">{workspace.documents.length ? workspace.documents.map(d => <button key={d.id} className={workspace.activeDocumentId === d.id ? 'active' : ''} onClick={() => useApp.getState().edit(w => { w.activeDocumentId = d.id; }, false)} title={d.name}><FileText size={14} /><span>{d.name.replace(/\.pdf$/i, '')}</span>{workspace.activeDocumentId === d.id && <i />}</button>) : <span className="no-document-label"><FolderOpen size={15} />還沒有開啟的文獻</span>}</div>
      <button className="import-button" disabled={!!busy} onClick={() => fileRef.current?.click()}><Plus size={16} /><span>開啟 PDF</span></button>
      <div className="save-status" title={saveStatus === 'saved' ? '已儲存至此瀏覽器的 IndexedDB' : ''}>{saveStatus === 'saving' ? <LoaderCircle size={13} className="spin" /> : saveStatus === 'error' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}<span>{saveStatus === 'saving' ? '儲存中' : saveStatus === 'error' ? '儲存失敗' : '已存於本機'}</span></div>
      <button className="toolbar-toggle" aria-label={preferences.toolbarCollapsed ? '展開工具列' : '隱藏工具列'} title={preferences.toolbarCollapsed ? '展開工具列' : '隱藏工具列'} aria-expanded={!preferences.toolbarCollapsed} aria-controls="top-toolbar" onClick={() => useApp.getState().pref({ toolbarCollapsed: !preferences.toolbarCollapsed })}>
        {preferences.toolbarCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}<span>{preferences.toolbarCollapsed ? '展開工具列' : '隱藏工具列'}</span>
      </button>
    </nav>
    {!workspace.documents.length && <div className="welcome-strip"><div><span className="eyebrow">A QUIETER SPACE FOR DEEPER THINKING</span><h2>從閱讀，到理解<span>。</span></h2><p>一篇文獻，一些線索，一個逐漸清晰的想法。</p></div><div className="welcome-right"><div className="local-badge"><ShieldCheck size={15} />你的文獻，留在你的裝置</div><button className="sample-button" disabled={!!busy} onClick={() => void sample()}>先試讀一篇範例<ArrowUpRight size={14} /></button></div></div>}
    <div className="mobile-view-tabs"><button className={mobileView === 'read' ? 'active' : ''} onClick={() => setMobileView('read')}>文獻閱讀</button><button className={mobileView === 'board' ? 'active' : ''} onClick={() => setMobileView('board')}>知識白板 ({workspace.notes.length})</button></div>
    <main className="main-workspace">
      {libraryOpen && <aside className="library"><header><div><span className="eyebrow">LIBRARY</span><h2>我的文獻庫 <span>{workspace.documents.length}</span></h2></div><button className="icon-button" onClick={() => setLibraryOpen(false)} aria-label="關閉文獻庫"><X size={16} /></button></header><button className="library-import" onClick={() => fileRef.current?.click()}><FilePlus2 size={17} />匯入 PDF 文獻</button><div className="library-list">{workspace.documents.map(d => <div key={d.id} className={`library-paper ${d.id === workspace.activeDocumentId ? 'active' : ''}`}><button onClick={() => useApp.getState().edit(w => { w.activeDocumentId = d.id; }, false)}><FileText size={20} /><div><strong>{d.name}</strong><span>{d.pageCount} 頁 · {workspace.notes.filter(n => n.documentId === d.id).length} 張便條</span></div></button><button className="icon-button remove-paper" onClick={() => removePaper(d.id)} aria-label={`移除 ${d.name}`}><Trash2 size={13} /></button></div>)}{!workspace.documents.length && <p className="library-empty">這裡將收藏你正在<br />思考的每篇文獻。</p>}</div><div className="library-footer"><button className="secondary-button" onClick={() => restoreRef.current?.click()}><Upload size={14} />還原研究封裝 / JSON</button><button className="text-button" onClick={() => { useApp.setState({ exportOpen: true }); }}><Download size={14} />備份目前研究</button><div className="storage-usage"><HardDrive size={13} />本機使用約 {storage || '…'}</div><button className="text-button danger subtle" onClick={() => void clearWorkspace()}>清除本機資料</button></div></aside>}
      <div className="split-area" ref={splitRef} data-mobile-view={mobileView} style={{ gridTemplateColumns: `${split}% 8px minmax(0, 1fr)` }}>
        <PdfViewer onImport={() => fileRef.current?.click()} busy={busy} />
        <div className="split-handle" role="separator" aria-label="調整閱讀器與白板寬度" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={75} aria-valuenow={Math.round(split)} tabIndex={0}
          onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const value = Math.max(30, Math.min(75, split + (e.key === 'ArrowLeft' ? -2 : 2))); setSplit(value); useApp.getState().pref({ split: value }); } }}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { const r = splitRef.current!.getBoundingClientRect(); setSplit(Math.max(30, Math.min(75, (e.clientX - r.left) / r.width * 100))); } }}
          onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); document.body.classList.remove('resizing'); useApp.getState().pref({ split }); }}><span /></div>
        <ResearchCanvas />
      </div>
    </main>
    {full && <div className="global-ai-progress"><LoaderCircle className="spin" size={17} /><div><strong>{full.phase}</strong><span>分塊 {full.completed} / {full.total} · 已完成結果即時保存在本機</span></div><progress value={full.completed} max={full.total} /><button onClick={() => cancelTask(full.jobId)}>取消</button></div>}
    <footer className="app-footer"><div><LockKeyhole size={12} /><span>Local first. Always yours.</span><i />{offline ? <span className="offline-label"><WifiOff size={12} />離線閱讀中</span> : <span>PDF 與筆記保存在這台裝置</span>}</div><button onClick={() => useApp.setState({ helpOpen: true })}>一點閱讀，一點發現 <ArrowUpRight size={12} /></button></footer>
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden data-testid="pdf-input" onChange={e => { if (e.target.files) void handleFiles([...e.target.files]); }} />
    <input ref={restoreRef} type="file" accept=".researchpack,.zip,.json" hidden data-testid="restore-input" onChange={e => { if (e.target.files?.[0]) void restore(e.target.files[0]); }} />
    {settingsOpen && <Settings close={() => useApp.setState({ settingsOpen: false })} />}
    {summaryOpen && <SummaryDialog close={() => setSummaryOpen(false)} />}
    {helpOpen && <HelpDialog close={() => useApp.setState({ helpOpen: false })} />}
    {exportOpen && <ExportDialog close={() => useApp.setState({ exportOpen: false })} />}
    {currentToast && <Toast />}
    {dragging && <div className="drop-overlay"><div><Upload size={38} /><h2>放下文獻，開始探索。</h2><p>PDF 只會匯入這台裝置</p></div></div>}
  </div>;
}
function Toast() { const t = useApp(s => s.toast); if (!t) return null; return <div className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.kind === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}<span>{t.text}</span><button className="icon-button" aria-label="關閉提示" onClick={() => useApp.setState({ toast: undefined })}><X size={15} /></button></div>; }
export default function App() { return <ErrorBoundary><AppContent /></ErrorBoundary>; }
