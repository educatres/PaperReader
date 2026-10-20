import { ProjectsPage } from './components/ProjectsPage';
import { beginBusyOperation, hasBusyOperation, registerEditor } from './lib/projectContext';
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ChevronUp, CircleHelp, FilePlus2, FolderOpen, Download, KeyRound, ShieldCheck, Sparkles, Check, LoaderCircle, PanelLeft, X, FileText, ArrowUpRight, LockKeyhole, Trash2, HardDrive, Plus, Upload, CheckCircle2, AlertCircle, FileArchive, Braces, NotebookPen, PanelLeftOpen, PanelRightOpen, ExternalLink, Undo2, Redo2 } from 'lucide-react';
import { PdfViewer } from './components/PdfViewer';
import { ResearchCanvas } from './components/ResearchCanvas';
import { Settings } from './components/Settings';
import { SummaryDialog } from './components/SummaryDialog';
import { Modal } from './components/Modal';
import { useApp, initialize, toast, createNote, flushSave, replaceWorkspace, navigateToProject, retryInitialize, saveProjectName, getWorkspaceEpoch } from './store';
import { readerWindow, boardWindow, openReader, openBoard, boardURL, announceBoard } from './lib/windows';
import { SyncConflicts } from './components/SyncConflicts';
import { hasKey, useCredentials, useAI, cancelTask, providerName } from './lib/ai';
import { importPdf, resetPdfCache } from './lib/pdf';
import { exportJSON, exportMarkdown, exportPack, readImport, restoreImport, importAsProject, downloadLocalDraft } from './lib/transfer';
import { emptyWorkspace, type Viewport } from './types';
import { pausePdfTranslation, usePdfTranslation } from './lib/pdfTranslation';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Do not log research data or credential-bearing state. */ }
  render() { return this.state.error ? <div className="fatal-error"><BookOpen size={40} /><h1>PaperReader 遇到顯示問題</h1><p>已儲存的研究資料仍在這台裝置，請重新整理後再試。</p><button className="primary-button" onClick={() => location.reload()}>重新整理</button></div> : this.props.children; }
}
function ExportDialog({ close }: { close: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function runExport(run: () => Promise<void>) {
    if (busy || hasBusyOperation()) return; setBusy(true); setError('');
    try { await run(); toast('研究備份已下載'); close(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="帶走你的研究" description="定期下載備份，讓研究成果多一份保障。" onClose={close}>
    <div className="export-options"><button disabled={busy} onClick={() => void runExport(exportPack)}>
      <span className="export-icon primary">{busy ? <LoaderCircle className="spin" /> : <FileArchive size={24} />}</span><div><strong>完整研究封裝<span className="recommended">建議備份</span></strong><p>PDF、截圖、標記、便條、連線與逐段譯文，完整還原到另一台電腦。</p><small>.researchpack · v2，需新版 PaperReader</small></div><ArrowUpRight size={18} /></button>
      <button disabled={busy} onClick={() => void runExport(exportMarkdown)}><span className="export-icon"><NotebookPen size={24} /></span><div><strong>Markdown 研究筆記</strong><p>保留原文、頁碼、翻譯、筆記與人工關係。</p><small>.md · 適合寫作與整理</small></div><ArrowUpRight size={18} /></button>
      <button disabled={busy} onClick={() => void runExport(exportJSON)}><span className="export-icon"><Braces size={24} /></span><div><strong>JSON 註記資料</strong><p>保留文字、逐段譯文與附件資訊，不含 PDF 原檔或截圖圖片。</p><small>.json · v2，完整圖片請使用研究封裝</small></div><ArrowUpRight size={18} /></button>
    </div>{error && <div className="inline-error export-error">{error}</div>}<div className="export-footnote"><LockKeyhole size={14} />所有匯出檔都不包含 API key。</div>
  </Modal>;
}
function HelpDialog({ close }: { close: () => void }) {
  return <Modal title="把閱讀變成自己的知識" description="PaperReader 使用指南" onClose={close} wide>
    <div className="help-content">{[
      ['00', '分開整理不同研究', '從「我的專案」建立、搜尋或切換研究。每個專案各有文獻庫與白板；返回前會保存編輯並暫停本視窗任務。其他已開啟視窗仍留在原專案。匯入備份預設建立新專案，覆蓋還原與清空只處理目前專案。'],
      ['01', '帶入你的文獻', '匯入或拖放 PDF。所有原檔、文字索引與研究筆記只保存在此瀏覽器的 IndexedDB。可在文件列切換多篇論文。'],
      ['02', '標記值得留下的話', '螢光筆模式下直接選字，鬆開滑鼠就會產生一張來源便條。跨行屬於同一張；跨頁請分開標記。選字模式可複製文字，選取範圍以灰色顯示。手掌模式可拖曳移動 PDF，翻頁按鈕與頁碼位於閱讀面板上方。'],
      ['03', '在白板上連結想法', '拖曳便條標題整理位置，從四周的連接點拖曳至另一張便條。雙擊關係線可設定支持、對比或延伸等關係。Shift 可多選。'],
      ['04', '需要時，邀請 AI 協助', '貼上你自己的 OpenAI、CGU 或 Gemini key，選擇模型並測試。OpenAI／CGU 提供 gpt-6-luna、gpt-5.6-luna、自訂模型與低／中／高推理（預設中）。點翻譯／摘要才會傳送該便條原文；全文摘要需再次確認。'],
      ['05', '回查原文，定期備份', '便條右下箭頭可回到 PDF；點 PDF 標記可聚焦便條。JSON 不含 PDF，完整備份請使用研究封裝。AI 的來源範圍需人工核對。'],
      ['06', '留更多空間給閱讀', '文件列右側可隱藏最上方工具列，再按「展開工具列」即可叫回 AI 設定、全文摘要與匯出。PDF 與白板右上都可隱藏該面板，讓另一面板佔滿寬度；按文件列的「顯示 PDF」或「顯示知識白板」即可恢復。'],
      ['07', '整合一組相連的想法', '點選已連線的便條，再按白板上方「關聯摘要」，或便條選單的「摘要這組關聯」。會整理直接與間接連通、未隱藏的便條，參考關係類型、說明與箭頭方向。確認預覽後，產生一張紫色整合便條；N1 等來源按鈕可回查便條。來源變動後可按「再次整合」產生新摘要。'],
      ['08', '框選圖表，留下自己的解讀', 'PDF 工具列選擇「截圖模式」，在單頁拖曳框選後放開，即建立圖片便條。Esc 可取消，過小的框選不會建立便條。點圖片可放大，點「輸入或貼上文字」可填寫內容；文字預設完全留白，不執行 OCR。單張與關聯 AI 摘要只使用便條文字，不傳送或分析圖片。完整研究封裝包含圖片，JSON 與 Markdown 不含圖片。'],
      ['09', '多個視窗，同一份研究', 'PDF 工具列的「在新視窗閱讀」或文獻庫的開窗按鈕可開啟多個閱讀視窗；白板右上的「在新視窗開啟白板」可開出多個白板，從目前視角開始，各自聚焦不同位置。同一專案的文獻、標記、截圖、便條、連線與已保存的 AI 結果會在同一瀏覽器、同一網址下互通；頁碼、縮放、工具與視角各自獨立。復原只處理本視窗操作，同欄位衝突會保留草稿。主畫面關閉後仍可操作其他視窗；金鑰不會傳給新視窗。'],
    ].map(([n, title, text]) => <div className="help-step" key={n}><b>{n}</b><div><h3>{title}</h3><p>{text}</p></div></div>)}
      <div className="shortcut-row"><span><kbd>Ctrl / ⌘</kbd> + <kbd>O</kbd> 開啟 PDF</span><span><kbd>Ctrl / ⌘</kbd> + <kbd>Z</kbd> 復原</span><span><kbd>N</kbd> 新便條</span><span><kbd>?</kbd> 使用指南</span></div>
      <div className="data-disclosure"><strong>關於本機資料與金鑰</strong><p>GitHub Pages 版本的資料屬於目前網站來源，與 localhost 版本各自獨立。金鑰只暫存於記憶體，重新整理後會清除。AI 操作由瀏覽器以 HTTPS 直接傳送至所選供應商。網站沒有帳號、雲端同步或分析追蹤。清除瀏覽器網站資料會刪除研究內容；請定期匯出。掃描 PDF 的 OCR、原生 PDF 圖像理解尚未提供。</p></div>
    </div>
  </Modal>;
}
function AppContent() {
  const { workspace, preferences, ready, saveStatus, settingsOpen, helpOpen, exportOpen } = useApp();
  useCredentials(); const { full } = useAI();
  const currentToast = useApp(s => s.toast);
  const [libraryOpen, setLibraryOpen] = useState(false); const [summaryOpen, setSummaryOpen] = useState(false);
  const [busy, setBusy] = useState(''); const [dragging, setDragging] = useState(false);
  const [split, setSplit] = useState(preferences.split); const [mobileView, setMobileView] = useState('read');
  const [storage, setStorage] = useState('');
  const [blockedReader, setBlockedReader] = useState('');
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: string }>();
  const confirmResolve = useRef<((accepted: boolean) => void) | undefined>(undefined);
  useEffect(() => () => { confirmResolve.current?.(false); }, []);
  function confirmProjectAction(title: string, message: string, action: string) {
    return new Promise<boolean>(resolve => { confirmResolve.current = resolve; setConfirmation({ title, message, action }); });
  }
  function finishConfirmation(accepted: boolean) { confirmResolve.current?.(accepted); confirmResolve.current = undefined; setConfirmation(undefined); }
  const fileRef = useRef<HTMLInputElement>(null); const restoreRef = useRef<HTMLInputElement>(null); const splitRef = useRef<HTMLDivElement>(null);
  const importProjectRef = useRef<HTMLInputElement>(null);
  const fileBusy = useRef(false); const dragDepth = useRef(0);
  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 700px)');
    const update = () => announceBoard(!readerWindow && !preferences.boardCollapsed && (!mobile.matches || preferences.pdfCollapsed || mobileView === 'board'));
    update(); mobile.addEventListener('change', update); return () => mobile.removeEventListener('change', update);
  }, [preferences.boardCollapsed, preferences.pdfCollapsed, mobileView]);
  useEffect(() => { document.title = workspace.title + ' · ' + (readerWindow ? 'PDF 閱讀' : boardWindow ? '知識白板' : 'PaperReader'); }, [workspace.title]);
  useEffect(() => { const show = () => setMobileView('read'); window.addEventListener('paperreader-show-pdf', show); return () => window.removeEventListener('paperreader-show-pdf', show); }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (e.target as HTMLElement).isContentEditable || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); fileRef.current?.click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) useApp.getState().redo(); else useApp.getState().undo(); }
      else if (!readerWindow && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') createNote();
      else if (e.key === '?') useApp.setState({ helpOpen: true });
      else if (e.key === 'Escape') window.getSelection()?.removeAllRanges();
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  function popout(documentId: string) {
    void flushSave(); const blocked = openReader(documentId); setBlockedReader(blocked || '');
    if (!blocked && !readerWindow) useApp.getState().pref({ pdfCollapsed: true });
  }
  function popoutBoard(viewport: Viewport) {
    void flushSave(); const blocked = openBoard(viewport); setBlockedReader(blocked || '');
    if (!blocked && !boardWindow && !preferences.pdfCollapsed) useApp.getState().pref({ boardCollapsed: true });
  }
  useEffect(() => { if (libraryOpen) navigator.storage?.estimate().then(s => setStorage(`${((s.usage || 0) / 1024 / 1024).toFixed(1)} MB`)).catch(() => {}); }, [libraryOpen, workspace.documents.length]);
  async function handleFiles(files: File[]) {
    if (fileBusy.current || hasBusyOperation()) return; fileBusy.current = true; const finish = beginBusyOperation();
    try { for (const file of files) await importPdf(file, setBusy); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { finish(); fileBusy.current = false; setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function sample() {
    if (fileBusy.current || hasBusyOperation()) return; fileBusy.current = true;
    const finish = beginBusyOperation(); setBusy('正在載入範例…');
    try { const r = await fetch(`${import.meta.env.BASE_URL}sample.pdf`); if (!r.ok) throw new Error('範例載入失敗，請匯入自己的 PDF。'); await importPdf(new File([await r.blob()], 'Reading as a Research Practice.pdf', { type: 'application/pdf' }), setBusy); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { finish(); fileBusy.current = false; setBusy(''); }
  }
  async function restore(file: File) {
    if (hasBusyOperation()) return;
    if (full || Object.keys(useAI.getState().running).length || usePdfTranslation.getState().active) { toast('請先完成或取消 AI 任務，再還原研究空間。', 'error'); return; }
    const finish = beginBusyOperation(); setBusy('正在驗證研究封裝…');
    try { const pack = await readImport(file);
      if (await confirmProjectAction('還原目前專案', `將以「${pack.workspace.title}」的 ${pack.workspace.documents.length} 篇文獻、${pack.workspace.notes.length} 張便條，取代目前「${workspace.title}」的研究內容。此操作無法復原，請先確認已下載備份。`, '確認還原')) await restoreImport(pack);
    } catch { toast('匯入失敗：檔案格式、版本、校驗碼或關聯資料無效。原有研究空間未變更。', 'error'); }
    finally { finish(); setBusy(''); if (restoreRef.current) restoreRef.current.value = ''; }
  }
  function removePaper(id: string) {
    const count = workspace.notes.filter(n => n.documentId === id).length;
    if (!confirm(`移除此 PDF 與其 ${count} 張便條、標記及連線？可用復原恢復。`)) return;
    workspace.jobs.filter(j => j.documentId === id && j.status === 'running').forEach(j => cancelTask(j.id));
    if (usePdfTranslation.getState().active?.documentId === id) pausePdfTranslation();
    useApp.getState().edit(w => { const ids = w.notes.filter(n => n.documentId === id).map(n => n.id); w.documents = w.documents.filter(d => d.id !== id); w.notes = w.notes.filter(n => !ids.includes(n.id)); w.highlights = w.highlights.filter(h => h.documentId !== id); w.edges = w.edges.filter(e => !ids.includes(e.source) && !ids.includes(e.target)); w.jobs = w.jobs.filter(j => j.documentId !== id);
      w.pdfLayouts = w.pdfLayouts.filter(l => l.documentId !== id); w.pdfParagraphs = w.pdfParagraphs.filter(p => p.documentId !== id);
      w.pdfTranslations = w.pdfTranslations.filter(t => t.documentId !== id); w.pdfTranslationJobs = w.pdfTranslationJobs.filter(j => j.documentId !== id);
      if (w.activeDocumentId === id) w.activeDocumentId = w.documents[0]?.id; });
  }
  async function clearWorkspace() {
    if (hasBusyOperation()) return;
    if (full || Object.keys(useAI.getState().running).length || usePdfTranslation.getState().active) { toast('請先取消執行中的 AI 任務。', 'error'); return; }
    const finish = beginBusyOperation();
    try {
      if (!await confirmProjectAction('清空目前專案', `將永久清空「${workspace.title}」的 PDF、便條、連線、附件與草稿，保留專案名稱。此操作無法復原，請先下載研究封裝備份。`, '確認清空')) return;
      setBusy('正在清空目前專案…');
      const next = emptyWorkspace(workspace.id, workspace.title);
      await replaceWorkspace(next, [], [], true);
      resetPdfCache(); setLibraryOpen(false); toast('目前專案已清空');
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { finish(); setBusy(''); }
  }
  if (!ready) return <div className="app-loading"><BookOpen size={35} /><span>PaperReader</span><LoaderCircle className="spin" size={20} /></div>;
  const blockedNotice = blockedReader && <div className="reader-popup-notice" role="status">瀏覽器未開啟新視窗。<a href={blockedReader} target="_blank" rel="noopener noreferrer" onClick={() => setBlockedReader('')}>改用新分頁開啟</a><button className="icon-button" aria-label="關閉開窗提示" onClick={() => setBlockedReader('')}><X size={14} /></button></div>;
  if (readerWindow) {
    const active = workspace.documents.find(d => d.id === workspace.activeDocumentId);
    return <div className="reader-shell"><header className="reader-window-header"><button className="project-back-button" disabled={!!busy} onClick={() => void navigateToProject()}>← 我的專案</button><BookOpen size={20} /><label><span>{workspace.title} · 獨立閱讀</span><select aria-label="閱讀文獻" value={active?.id || ''} onChange={e => { const id = e.target.value; useApp.getState().edit(w => { w.activeDocumentId = id; }, false); const url = new URL(location.href); url.searchParams.set('document', id); history.replaceState(history.state, '', url); }}><option value="" disabled>選擇文獻</option>{workspace.documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <div className="reader-window-actions"><button className="icon-button" aria-label="復原" title="復原本視窗的操作" disabled={!useApp.getState().history.length} onClick={() => useApp.getState().undo()}><Undo2 size={16} /></button><button className="icon-button" aria-label="重做" title="重做本視窗的操作" disabled={!useApp.getState().future.length} onClick={() => useApp.getState().redo()}><Redo2 size={16} /></button><a className="secondary-button" href={boardURL(workspace.viewport)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /><span>研究白板</span></a></div></header>
      {blockedNotice}<PdfViewer onImport={() => fileRef.current?.click()} busy={busy} onPopout={() => active && popout(active.id)} />
      {!active && <p className="reader-missing-document">原文獻已移除或尚未選擇；可從上方選擇文獻，或開啟研究白板匯入。</p>}
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden data-testid="pdf-input" onChange={e => { if (e.target.files) void handleFiles([...e.target.files]); }} />
      {settingsOpen && <Settings close={() => useApp.setState({ settingsOpen: false })} />}
      <SyncConflicts />{currentToast && <Toast />}</div>;
  }
  return <div className={`app-shell${preferences.toolbarCollapsed ? ' toolbar-collapsed' : ''}`} onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragLeave={e => { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer.files.length) void handleFiles([...e.dataTransfer.files]); }}>
    <header id="top-toolbar" className="app-header" hidden={preferences.toolbarCollapsed}><div className="brand"><span className="brand-symbol"><BookOpen size={22} strokeWidth={1.7} /></span><div><h1>PaperReader<span className="version-tag">BETA</span></h1><span className="brand-tagline">{boardWindow ? '獨立知識白板 · 視角各自保存' : 'READ. THINK. CONNECT.'}</span></div></div>
      <div className="header-project"><button className="project-back-button" disabled={!!busy} onClick={() => void navigateToProject()}>← 我的專案</button><span>PRIVATE WORKSPACE</span><WorkspaceTitle /></div>
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
      {preferences.pdfCollapsed && <button className="show-pdf-button" aria-label="顯示 PDF" onClick={() => { useApp.getState().pref({ pdfCollapsed: false }); setMobileView('read'); }}><PanelLeftOpen size={16} /><span>顯示 PDF</span></button>}
      {preferences.boardCollapsed && <button className="show-pdf-button" aria-label="顯示知識白板" onClick={() => { useApp.getState().pref({ boardCollapsed: false }); setMobileView('board'); }}><PanelRightOpen size={16} /><span>顯示知識白板</span></button>}
      <div className="save-status" title={saveStatus === 'saved' ? '已儲存至此瀏覽器的 IndexedDB' : ''}>{saveStatus === 'saving' ? <LoaderCircle size={13} className="spin" /> : saveStatus === 'error' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}<span>{saveStatus === 'saving' ? '儲存中' : saveStatus === 'error' ? '儲存失敗' : '已存於本機'}</span></div>
      {saveStatus === 'error' && <button className="text-button" onClick={() => downloadLocalDraft()}>下載本視窗草稿</button>}
      <button className="toolbar-toggle" aria-label={preferences.toolbarCollapsed ? '展開工具列' : '隱藏工具列'} title={preferences.toolbarCollapsed ? '展開工具列' : '隱藏工具列'} aria-expanded={!preferences.toolbarCollapsed} aria-controls="top-toolbar" onClick={() => useApp.getState().pref({ toolbarCollapsed: !preferences.toolbarCollapsed })}>
        {preferences.toolbarCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}<span>{preferences.toolbarCollapsed ? '展開工具列' : '隱藏工具列'}</span>
      </button>
    </nav>
    {!workspace.documents.length && <div className="welcome-strip"><div><span className="eyebrow">A QUIETER SPACE FOR DEEPER THINKING</span><h2>從閱讀，到理解<span>。</span></h2><p>一篇文獻，一些線索，一個逐漸清晰的想法。</p></div><div className="welcome-right"><div className="local-badge"><ShieldCheck size={15} />你的文獻，留在你的裝置</div><button className="sample-button" disabled={!!busy} onClick={() => void sample()}>先試讀一篇範例<ArrowUpRight size={14} /></button></div></div>}
    <div className="mobile-view-tabs"><button className={!preferences.pdfCollapsed && (preferences.boardCollapsed || mobileView === 'read') ? 'active' : ''} onClick={() => { useApp.getState().pref({ pdfCollapsed: false }); setMobileView('read'); }}>文獻閱讀</button><button className={!preferences.boardCollapsed && (preferences.pdfCollapsed || mobileView === 'board') ? 'active' : ''} onClick={() => { useApp.getState().pref({ boardCollapsed: false }); setMobileView('board'); }}>知識白板 ({workspace.notes.length})</button></div>
    {blockedNotice}<main className="main-workspace">
      {libraryOpen && <aside className="library"><header><div><span className="eyebrow">LIBRARY</span><h2>我的文獻庫 <span>{workspace.documents.length}</span></h2></div><button className="icon-button" onClick={() => setLibraryOpen(false)} aria-label="關閉文獻庫"><X size={16} /></button></header><button className="library-import" onClick={() => fileRef.current?.click()}><FilePlus2 size={17} />匯入 PDF 文獻</button><div className="library-list">{workspace.documents.map(d => <div key={d.id} className={`library-paper ${d.id === workspace.activeDocumentId ? 'active' : ''}`}><button onClick={() => useApp.getState().edit(w => { w.activeDocumentId = d.id; }, false)}><FileText size={20} /><div><strong>{d.name}</strong><span>{d.pageCount} 頁 · {workspace.notes.filter(n => n.documentId === d.id).length} 張便條</span></div></button><button className="icon-button open-paper-window" title="在新視窗閱讀" aria-label={`另開視窗閱讀 ${d.name}`} onClick={() => popout(d.id)}><ExternalLink size={13} /></button><button className="icon-button remove-paper" onClick={() => removePaper(d.id)} aria-label={`移除 ${d.name}`}><Trash2 size={13} /></button></div>)}{!workspace.documents.length && <p className="library-empty">這裡將收藏你正在<br />思考的每篇文獻。</p>}</div><div className="library-footer"><button className="secondary-button" onClick={() => restoreRef.current?.click()}><Upload size={14} />還原研究封裝 / JSON</button><button className="text-button" onClick={() => { useApp.setState({ exportOpen: true }); }}><Download size={14} />備份目前研究</button><button className="text-button" disabled={!!busy} onClick={() => importProjectRef.current?.click()}><Upload size={14} />匯入為新專案</button><div className="storage-usage"><HardDrive size={13} />本機使用約 {storage || '…'}</div><button className="text-button danger subtle" onClick={() => void clearWorkspace()}>清空目前專案</button></div></aside>}
      <div className={`split-area${preferences.pdfCollapsed ? ' pdf-collapsed' : ''}${preferences.boardCollapsed ? ' board-collapsed' : ''}`} ref={splitRef} data-mobile-view={preferences.pdfCollapsed ? 'board' : preferences.boardCollapsed ? 'read' : mobileView} style={{ gridTemplateColumns: preferences.pdfCollapsed || preferences.boardCollapsed ? 'minmax(0, 1fr)' : `${split}% 8px minmax(0, 1fr)` }}>
        {!preferences.pdfCollapsed && <PdfViewer onImport={() => fileRef.current?.click()} busy={busy} onCollapse={() => useApp.getState().pref({ pdfCollapsed: true })} onPopout={() => workspace.activeDocumentId && popout(workspace.activeDocumentId)} />}
        {!preferences.pdfCollapsed && !preferences.boardCollapsed && <div className="split-handle" role="separator" aria-label="調整閱讀器與白板寬度" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={75} aria-valuenow={Math.round(split)} tabIndex={0}
          onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const value = Math.max(30, Math.min(75, split + (e.key === 'ArrowLeft' ? -2 : 2))); setSplit(value); useApp.getState().pref({ split: value }); } }}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { const r = splitRef.current!.getBoundingClientRect(); setSplit(Math.max(30, Math.min(75, (e.clientX - r.left) / r.width * 100))); } }}
          onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); document.body.classList.remove('resizing'); useApp.getState().pref({ split }); }}><span /></div>}
        {!preferences.boardCollapsed && <ResearchCanvas onCollapse={() => useApp.getState().pref({ boardCollapsed: true })} onPopout={popoutBoard} />}
      </div>
    </main>
    {full && <div className="global-ai-progress"><LoaderCircle className="spin" size={17} /><div><strong>{full.phase}</strong><span>分塊 {full.completed} / {full.total} · 已完成結果即時保存在本機</span></div><progress value={full.completed} max={full.total} /><button onClick={() => cancelTask(full.jobId)}>取消</button></div>}
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden data-testid="pdf-input" onChange={e => { if (e.target.files) void handleFiles([...e.target.files]); }} />
    <input ref={importProjectRef} type="file" accept=".researchpack,.zip,.json" hidden data-testid="project-import-input" onChange={async e => { const file = e.target.files?.[0]; if (!file || hasBusyOperation()) return; const finish = beginBusyOperation(); setBusy('正在匯入新專案…'); let id: string | undefined; try { id = await importAsProject(await readImport(file)); } catch { toast('匯入失敗，既有專案未變更。', 'error'); } finally { finish(); setBusy(''); if (importProjectRef.current) importProjectRef.current.value = ''; } if (id) await navigateToProject(id); }} />
    <input ref={restoreRef} type="file" accept=".researchpack,.zip,.json" hidden data-testid="restore-input" onChange={e => { if (e.target.files?.[0]) void restore(e.target.files[0]); }} />
    {settingsOpen && <Settings close={() => useApp.setState({ settingsOpen: false })} />}
    {confirmation && <Modal title={confirmation.title} onClose={() => finishConfirmation(false)}><div className="editor-form"><p className="project-confirm-copy">{confirmation.message}</p><footer className="modal-actions"><button className="secondary-button" onClick={() => finishConfirmation(false)}>取消</button><button className="danger-button" onClick={() => finishConfirmation(true)}>{confirmation.action}</button></footer></div></Modal>}
    {summaryOpen && <SummaryDialog close={() => setSummaryOpen(false)} />}
    {helpOpen && <HelpDialog close={() => useApp.setState({ helpOpen: false })} />}
    {exportOpen && <ExportDialog close={() => useApp.setState({ exportOpen: false })} />}
    {currentToast && <Toast />}
    <SyncConflicts />
    {dragging && <div className="drop-overlay"><div><Upload size={38} /><h2>放下文獻，開始探索。</h2><p>PDF 只會匯入這台裝置</p></div></div>}
  </div>;
}
function Toast() { const t = useApp(s => s.toast); if (!t) return null; return <div className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.kind === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}<span>{t.text}</span><button className="icon-button" aria-label="關閉提示" onClick={() => useApp.setState({ toast: undefined })}><X size={15} /></button></div>; }
export default function App() { return <ErrorBoundary><ProjectRouter /></ErrorBoundary>; }
function ProjectRouter() {
  const { ready, route, switching, missingProject, initializationError, settingsOpen, helpOpen, deletedDraft } = useApp();
  useEffect(() => { void initialize(); }, []);
  useEffect(() => { if (route.view === 'projects') document.title = '我的專案 · PaperReader'; }, [route.view]);
  if (!ready) return <div className="app-loading"><BookOpen size={35} /><span>PaperReader</span><LoaderCircle className="spin" /></div>;
  if (initializationError) return <div className="fatal-error"><h1>暫時無法開啟研究資料</h1><p>{initializationError}</p><button className="primary-button" onClick={() => void retryInitialize()}>重試</button></div>;
  return <><div className="project-router" inert={switching}>{missingProject ? <div className="fatal-error"><FolderOpen size={36} /><h1>此專案不存在或已刪除</h1><p>其他專案仍可從「我的專案」開啟。</p>{!!deletedDraft && <button className="secondary-button" onClick={() => downloadLocalDraft(deletedDraft)}>下載本視窗未儲存草稿</button>}<button className="primary-button" onClick={() => void navigateToProject()}>返回我的專案</button></div> : route.view === 'projects' ? <><ProjectsPage />{settingsOpen && <Settings close={() => useApp.setState({ settingsOpen: false })} />}{helpOpen && <HelpDialog close={() => useApp.setState({ helpOpen: false })} />}<Toast /></> : <AppContent key={route.projectId + '.' + route.view} />}</div>{switching && <div className="project-transition-overlay" role="status"><LoaderCircle className="spin" size={24} /><span>正在保存並切換專案…</span></div>}</>;
}

function WorkspaceTitle() {
  const title = useApp(s => s.workspace.title); const projectId = useApp(s => s.workspace.id);
  const [value, setValue] = useState(title); const [error, setError] = useState('');
  const editing = useRef(false); const draft = useRef(value); draft.current = value;
  const base = useRef({ title, epoch: getWorkspaceEpoch() });
  function save() { if (draft.current !== base.current.title) { saveProjectName(base.current.title, draft.current, base.current.epoch, projectId); draft.current = draft.current.trim(); setValue(draft.current); base.current = { title: draft.current, epoch: getWorkspaceEpoch() }; } setError(''); }
  useEffect(() => { if (!editing.current) { setValue(title); base.current = { title, epoch: getWorkspaceEpoch() }; } }, [title]);
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => registerEditor(() => saveRef.current(), () => ({ projectId, title: draft.current })), [projectId]);
  return <><input aria-label="研究空間名稱" value={value} maxLength={100} onFocus={() => { editing.current = true; base.current = { title, epoch: getWorkspaceEpoch() }; }} onChange={e => setValue(e.target.value)} onBlur={() => { editing.current = false; try { save(); void flushSave(); } catch (e) { setError((e as Error).message); } }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{error && <span role="alert" className="inline-error">{error}</span>}</>;
}
