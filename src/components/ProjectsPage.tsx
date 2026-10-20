import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Search, Upload, ArrowUpRight, MoreHorizontal, Pencil, Trash2, FolderOpen, HardDrive, LoaderCircle, KeyRound, CircleHelp, X } from 'lucide-react';
import { createProject, deleteProject, listProjects, renameProject } from '../lib/db';
import { useApp, navigateToProject, notifyProjectsChanged, toast } from '../store';
import { beginBusyOperation } from '../lib/projectContext';
import { importAsProject, readImport } from '../lib/transfer';
import { type ProjectMeta } from '../types';
import { Modal } from './Modal';

export function ProjectsPage() {
  const revision = useApp(s => s.projectsRevision);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(''); const [sort, setSort] = useState('modified');
  const [menu, setMenu] = useState<string>(); const [dialog, setDialog] = useState<{ mode: 'create' | 'rename' | 'delete'; project?: ProjectMeta }>();
  const [name, setName] = useState(''); const [dialogError, setDialogError] = useState(''); const [working, setWorking] = useState(false);
  const [importing, setImporting] = useState(false); const [usage, setUsage] = useState('');
  const input = useRef<HTMLInputElement>(null); const submitting = useRef(false);
  useEffect(() => {
    let disposed = false;
    listProjects().then(items => { if (!disposed) { setProjects(items); setLoading(false); setError(''); } })
      .catch(() => { if (!disposed) { setLoading(false); setError('無法讀取專案清單，請重試。'); } });
    return () => { disposed = true; };
  }, [revision, retry]);
  useEffect(() => { void navigator.storage?.estimate().then(value => setUsage(((value.usage || 0) / 1024 / 1024).toFixed(1) + ' MB')).catch(() => {}); }, [revision]);
  function open(mode: 'create' | 'rename' | 'delete', project?: ProjectMeta) {
    setMenu(undefined); setName(project?.title || '未命名專案'); setDialogError(''); setDialog({ mode, project });
  }
  async function submit() {
    if (!dialog || submitting.current) return;
    submitting.current = true; setWorking(true); setDialogError('');
    const finish = beginBusyOperation(); let enterId: string | undefined;
    try {
      if (dialog.mode === 'create') {
        enterId = await createProject(name); notifyProjectsChanged(enterId); setDialog(undefined);
      } else if (dialog.mode === 'rename') {
        const result = await renameProject(dialog.project!.id, name);
        notifyProjectsChanged(dialog.project!.id);
        if (result.conflict) throw new Error('其他視窗也修改了名稱，已保留草稿。請進入專案比較版本。');
        setDialog(undefined);
      } else {
        await deleteProject(dialog.project!.id); notifyProjectsChanged(dialog.project!.id); setDialog(undefined); toast('專案已刪除');
      }
    } catch (e) { setDialogError((e as Error).message); }
    finally { finish(); submitting.current = false; setWorking(false); }
    if (enterId) await navigateToProject(enterId);
  }
  async function importFile(file: File) {
    if (submitting.current) return;
    submitting.current = true; setImporting(true); const finish = beginBusyOperation(); let id: string | undefined;
    try { id = await importAsProject(await readImport(file)); }
    catch { toast('匯入失敗：請確認格式、版本、附件與校驗碼。既有專案未變更。', 'error'); }
    finally { finish(); submitting.current = false; setImporting(false); if (input.current) input.current.value = ''; }
    if (id) await navigateToProject(id);
  }
  const filtered = projects.filter(project => project.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title, 'zh-Hant') : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  const busy = working || importing;
  return <div className="projects-shell">
    <header className="projects-header"><div className="brand"><span className="brand-symbol"><BookOpen size={22} /></span><div><h1>PaperReader<span className="version-tag">BETA</span></h1><span className="brand-tagline">READ. THINK. CONNECT.</span></div></div>
      <div className="projects-header-actions">
        <a className="secondary-button" href={`${import.meta.env.BASE_URL}manual.html`} target="_blank" rel="noopener noreferrer" aria-label="操作手冊（另開分頁）"><BookOpen size={16} />操作手冊</a>
        <button className="secondary-button" onClick={() => useApp.setState({ settingsOpen: true })}><KeyRound size={16} />連接你的 AI</button><button className="icon-button" aria-label="使用指南" onClick={() => useApp.setState({ helpOpen: true })}><CircleHelp size={21} /></button>
      </div></header>
    <main className="projects-main"><div className="projects-heading"><div><span className="eyebrow">YOUR RESEARCH COLLECTION</span><h2>我的專案</h2><p>把不同研究分開整理，隨時接續閱讀。</p></div><button className="primary-button" disabled={busy || loading || !!error} onClick={() => open('create')}><Plus size={18} />建立專案</button></div>
      <div className="projects-controls"><label className="project-search"><Search size={18} /><input aria-label="搜尋專案名稱" placeholder="搜尋專案名稱…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="清除搜尋" onClick={() => setQuery('')}><X size={15} /></button>}</label><select aria-label="專案排序" value={sort} onChange={e => setSort(e.target.value)}><option value="modified">最後修改</option><option value="name">專案名稱</option></select></div>
      {loading ? <div className="projects-empty" role="status"><LoaderCircle className="spin" size={30} /><p>正在讀取專案…</p></div>
        : error ? <div className="projects-empty" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>重試</button></div>
        : !projects.length ? <div className="projects-empty"><span className="projects-empty-icon"><FolderOpen size={36} strokeWidth={1.4} /></span><h3>為下一個想法，留一個研究空間。</h3><p>文獻、標記與筆記各自保存，從第一個專案開始。</p><button className="primary-button" disabled={busy} onClick={() => open('create')}><Plus size={17} />建立第一個專案</button><button className="text-button" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} />匯入研究封裝 / JSON</button></div>
        : !filtered.length ? <div className="projects-empty"><Search size={30} /><h3>找不到符合的專案</h3><button className="secondary-button" onClick={() => setQuery('')}>清除搜尋</button></div>
        : <div className="project-grid">{filtered.map(project => <article className="project-card" key={project.id} data-project-id={project.id}>
          <button className="project-card-main" disabled={busy} onClick={() => void navigateToProject(project.id)} aria-label={'進入專案 ' + project.title}><span className="project-card-symbol"><BookOpen size={23} strokeWidth={1.5} /></span><h3>{project.title}</h3><span className="project-card-counts">{project.documentCount} 篇 PDF · {project.noteCount} 張便條</span><span className="project-card-date">最後修改：{new Date(project.updatedAt).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })}</span><span className="project-card-enter">進入專案<ArrowUpRight size={16} /></span></button>
          <div className="project-card-menu"><button className="icon-button" aria-label={'專案選單 ' + project.title} aria-expanded={menu === project.id} disabled={busy} onClick={() => setMenu(menu === project.id ? undefined : project.id)}><MoreHorizontal size={20} /></button>{menu === project.id && <div className="project-menu-items"><button onClick={() => open('rename', project)}><Pencil size={14} />重新命名</button><button className="danger" onClick={() => open('delete', project)}><Trash2 size={14} />刪除專案</button></div>}</div>
        </article>)}</div>}
      <footer className="projects-footer"><button className="secondary-button" disabled={busy || loading} onClick={() => input.current?.click()}>{importing ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{importing ? '正在驗證並匯入…' : '匯入研究封裝 / JSON'}</button><span><HardDrive size={14} />本網站本機使用約 {usage || '…'}<small>專案保存在此瀏覽器，請定期下載研究備份。</small></span></footer>
    </main>
    <input type="file" ref={input} hidden accept=".researchpack,.zip,.json" data-testid="project-import-input" onChange={e => { if (e.target.files?.[0]) void importFile(e.target.files[0]); }} />
    {dialog && <Modal title={dialog.mode === 'create' ? '建立專案' : dialog.mode === 'rename' ? '重新命名專案' : '刪除專案'} onClose={() => { if (!working) setDialog(undefined); }}>
      <form className="editor-form" onSubmit={e => { e.preventDefault(); void submit(); }}>{dialog.mode === 'delete' ? <div className="project-delete-copy"><p>將永久刪除「<strong>{dialog.project?.title}</strong>」及其 {dialog.project?.documentCount} 篇 PDF、{dialog.project?.noteCount} 張便條、附件與已保存草稿。</p><p>此操作無法復原，建議先下載研究封裝備份。</p></div> : <label>專案名稱<input autoFocus aria-label="專案名稱" value={name} maxLength={100} onChange={e => setName(e.target.value)} disabled={working} /><span className="label-hint">1–100 字元，可以與其他專案同名。</span></label>}
        {dialogError && <p className="inline-error" role="alert">{dialogError}</p>}<footer className="modal-actions"><button type="button" className="secondary-button" disabled={working} onClick={() => setDialog(undefined)}>取消</button><button type="submit" className={dialog.mode === 'delete' ? 'danger-button' : 'primary-button'} disabled={working}>{working && <LoaderCircle size={15} className="spin" />}{dialog.mode === 'delete' ? '永久刪除專案' : dialog.mode === 'create' ? '建立並進入' : '儲存名稱'}</button></footer>
      </form></Modal>}
  </div>;
}
