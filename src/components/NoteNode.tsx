import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { ArrowUpRight, ChevronDown, ChevronUp, Languages, Sparkles, Pencil, MoreHorizontal, Quote, X, Link2, FileText, Lightbulb, LoaderCircle, Layers3, Network, Image } from 'lucide-react';
import { colors, type Note, type Paper, type Highlight } from '../types';
import { useApp, patchNote, focusSource, deleteNotes, saveEntityDraft, preserveEntityDraft, getWorkspaceEpoch } from '../store';
import { taskKey } from '../lib/projectContext';
import { useAI, runNoteAI, cancelTask, providerName } from '../lib/ai';
import { Modal } from './Modal';
import { ScreenshotImage } from './ScreenshotImage';
import { singleNoteText } from '../lib/noteText';
import { registerEditor, getProjectId } from '../lib/projectContext';

export type ResearchNode = Node<{ note: Note; paper?: Paper; highlight?: Highlight }, 'researchNote'>;
function draftValues(draft: Note, tags: string): Partial<Note> {
  return { title: draft.title.trim() || '未命名便條', userNotes: draft.userNotes, tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean).slice(0, 30), color: draft.color,
    ...(draft.type === 'manual-note' || draft.type === 'screenshot-note' ? { originalText: draft.originalText } : {}), translation: draft.translation, summary: draft.summary };
}
function NoteEditor({ note, close }: { note: Note; close: () => void }) {
  const [base] = useState(note);
  const [epoch] = useState(getWorkspaceEpoch);
  const [projectId] = useState(getProjectId);
  const [draft, setDraft] = useState(note); const [tags, setTags] = useState(note.tags.join(', '));
  const editableText = note.type === 'manual-note' || note.type === 'screenshot-note';
  const latest = useRef({ draft, tags }); latest.current = { draft, tags };
  const dismissed = useRef(false);
  const autoSaved = useRef('');
  useEffect(() => registerEditor(() => {
    saveEntityDraft('notes', base, draftValues(latest.current.draft, latest.current.tags), epoch, projectId);
    autoSaved.current = JSON.stringify(latest.current);
  }, () => ({ projectId, epoch, base, values: draftValues(latest.current.draft, latest.current.tags) })), [base, epoch, projectId]);
  function finish() { dismissed.current = true; close(); }
  useEffect(() => () => {
    const live = useApp.getState().workspace.notes.find(n => n.id === base.id);
    if (!dismissed.current && JSON.stringify(latest.current) !== autoSaved.current && (!live || live.hidden)) void preserveEntityDraft('notes', base, draftValues(latest.current.draft, latest.current.tags), epoch, projectId);
  }, [base, epoch]);
  return <Modal title="編輯研究便條" description="原文與你的解讀，各自留存。" onClose={finish}>
    <form className="editor-form" onSubmit={e => { e.preventDefault(); saveEntityDraft('notes', base, draftValues(draft, tags), epoch); finish(); }}>
      <label>便條標題<input autoFocus value={draft.title} maxLength={200} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>{note.type === 'screenshot-note' ? '截圖便條文字（自行輸入或貼上）' : note.type === 'manual-note' ? '參考文字（選填）' : note.type === 'group-summary' ? '整合來源快照' : '來源原文'}<textarea rows={4} readOnly={!editableText} placeholder={note.type === 'screenshot-note' ? '輸入或貼上文字，AI 只讀取這些文字及你的筆記，不分析圖片。' : undefined} value={draft.originalText} onChange={e => setDraft({ ...draft, originalText: e.target.value })} /></label>
      <label>我的筆記<textarea rows={5} placeholder="這段話讓我想到…" value={draft.userNotes} onChange={e => setDraft({ ...draft, userNotes: e.target.value })} /></label>
      {draft.translation && <label>翻譯（可修訂）<textarea rows={4} value={draft.translation.text} onChange={e => setDraft({ ...draft, translation: { ...draft.translation!, text: e.target.value } })} /></label>}
      {draft.summary && <label>AI 摘要（可修訂）<textarea rows={5} value={draft.summary.text} onChange={e => setDraft({ ...draft, summary: { ...draft.summary!, text: e.target.value } })} /></label>}
      <label>標籤<span className="label-hint">以逗號分隔</span><input value={tags} onChange={e => setTags(e.target.value)} placeholder="例如：研究方法, 值得延伸" /></label>
      {note.type !== 'group-summary' && <div className="field-row"><span>便條顏色</span><div className="color-palette">{(Object.keys(colors) as (keyof typeof colors)[]).map(c => <button type="button" aria-label={`${c} note`} key={c} className={`color-dot ${draft.color === c ? 'active' : ''}`} style={{ background: colors[c] }} onClick={() => setDraft({ ...draft, color: c })} />)}</div></div>}
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={finish}>取消</button><button className="primary-button" type="submit">儲存便條</button></footer>
    </form>
  </Modal>;
}
export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<ResearchNode>) {
  const { note, paper, highlight } = data;
  const isGroup = note.type === 'group-summary';
  const isScreenshot = note.type === 'screenshot-note';
  const emptyScreenshot = isScreenshot && !singleNoteText(note).trim();
  const sources = useApp(s => s.workspace.notes);
  const regroupAnchor = note.groupSummary?.sources.find(source => sources.some(n => n.id === source.noteId && !n.hidden))?.noteId;
  const [tab, setTab] = useState<'original' | 'translation' | 'summary' | 'notes'>(note.type === 'document-summary' || isGroup ? 'summary' : note.type === 'manual-note' ? 'notes' : 'original');
  const [editing, setEditing] = useState(false); const [menu, setMenu] = useState(false);
  const running = useAI(s => s.running[taskKey(note.id)]); const error = useAI(s => s.errors[taskKey(note.id)]);
  const aiResult = tab === 'translation' ? note.translation : tab === 'summary' ? note.summary : undefined;
  useEffect(() => { if (note.translation) setTab('translation'); }, [note.translation?.createdAt]);
  useEffect(() => { if (note.summary) setTab('summary'); }, [note.summary?.createdAt]);
  function remove() {
    if (confirm(note.highlightId ? '刪除此便條、來源螢光標記與相關連線？可用復原恢復。' : '刪除此研究便條與相關連線？可用復原恢復。')) deleteNotes([note.id], true);
  }
  return <article className={`note-card color-${note.color} ${isGroup ? 'group-summary-note' : ''} ${isScreenshot ? 'screenshot-note' : ''} ${selected ? 'selected' : ''} ${running ? 'is-running' : ''}`} style={{ '--note-color': isGroup ? '#9c86c4' : colors[note.color] } as React.CSSProperties} data-note-id={note.id} aria-label={`便條：${note.title}`}>
    <NodeResizer isVisible={selected} minWidth={280} maxWidth={560} minHeight={100} lineClassName="resize-line" handleClassName="resize-handle" onResizeEnd={(_, p) => patchNote(note.id, { width: p.width, position: { x: p.x, y: p.y } })} />
    {[Position.Left, Position.Right, Position.Top, Position.Bottom].map(position => <Handle type="source" key={position} id={position} position={position} title="拖曳到其他便條以連線" />)}
    <header className="note-header"><span className="note-kind">{isScreenshot ? <Image size={14} /> : isGroup ? <Layers3 size={14} /> : note.type === 'highlight-note' ? <Quote size={13} /> : note.type === 'document-summary' ? <FileText size={13} /> : <Lightbulb size={13} />}{isScreenshot ? 'PDF 截圖' : isGroup ? 'AI 關聯整合' : note.type === 'highlight-note' ? '文獻摘錄' : note.type === 'document-summary' ? '文獻總覽' : '我的想法'}</span>
      <div className="note-header-actions nodrag"><button className="icon-button" title="編輯便條" aria-label="編輯便條" onClick={() => setEditing(true)}><Pencil size={13} /></button><button className="icon-button" title={note.collapsed ? '展開便條' : '收合便條'} aria-label={note.collapsed ? '展開便條' : '收合便條'} onClick={() => patchNote(note.id, { collapsed: !note.collapsed })}>{note.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button></div></header>
    <h3 className="note-title" onDoubleClick={() => setEditing(true)}>{note.title}</h3>
    {paper && <div className="note-source"><FileText size={11} /><span title={paper.name}>{paper.name.replace(/\.pdf$/i, '')}</span><b>{note.screenshot ? `p. ${note.screenshot.pageIndex + 1}` : highlight ? `p. ${highlight.displayPage}` : '全文'}</b></div>}
    {!note.collapsed && <div className="nodrag">
      {isScreenshot && note.screenshot && <><ScreenshotImage image={note.screenshot} /><p className="screenshot-text-only">AI 僅讀取便條文字，不分析圖片。</p></>}
      {isGroup && note.groupSummary && <div className="group-note-sources"><p>{note.groupSummary.sources.length} 張便條 · {note.groupSummary.relations.length} 條關係 · 來源快照</p><div className="nowheel">{note.groupSummary.sources.map((source, i) => {
        const live = sources.find(n => n.id === source.noteId);
        return <button key={source.noteId} disabled={!live} title={live ? `回到來源便條：${source.title}` : `來源已移除：${source.title}`} aria-label={`定位來源 N${i + 1}：${source.title}`} onClick={e => { e.stopPropagation(); if (live?.hidden) patchNote(live.id, { hidden: false }); useApp.setState({ selectedNoteId: source.noteId, focusNoteId: source.noteId }); }}><b>N{i + 1}</b><span>{source.title || '未命名便條'}</span><ArrowUpRight size={11} /></button>;
      })}</div></div>}
      <div className="note-tabs">{([['original', '原文'], ['translation', '翻譯'], ['summary', '摘要'], ['notes', '筆記']] as const).filter(([id]) => !isGroup || id !== 'translation').map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{isScreenshot && id === 'original' ? '文字' : isGroup && id === 'original' ? '來源快照' : isGroup && id === 'summary' ? '整合摘要' : label}{(id === 'translation' && note.translation || id === 'summary' && note.summary || id === 'notes' && note.userNotes) ? <i /> : null}</button>)}</div>
      <div className={`note-content nowheel ${tab === 'original' ? 'original-text' : ''}`}>
        {tab === 'original' ? isScreenshot ? <button className={`notes-preview ${note.originalText ? '' : 'empty'}`} onClick={() => setEditing(true)}>{note.originalText || '+ 輸入或貼上文字…'}</button> : note.originalText || <span className="placeholder-text">寫下參考文字，或切換「筆記」留下想法。</span>
          : tab === 'notes' ? <button className={`notes-preview ${note.userNotes ? '' : 'empty'}`} onClick={() => setEditing(true)}>{note.userNotes || '+ 寫下你的理解與疑問…'}</button>
          : aiResult?.text || <div className="ai-empty"><Sparkles size={19} /><span>{emptyScreenshot ? '請先輸入便條文字或筆記' : tab === 'translation' ? '用自己的模型讀懂原文' : '讓重點更清晰一些'}</span><button disabled={emptyScreenshot} className="text-button" onClick={() => void runNoteAI(note.id, tab === 'translation' ? 'translation' : 'summary')}>{tab === 'translation' ? '翻譯成繁體中文' : '產生段落摘要'}<ArrowUpRight size={12} /></button></div>}
      </div>
      {aiResult && <div className="ai-attribution" title={`${providerName(aiResult.provider)} · ${aiResult.model} · ${new Date(aiResult.createdAt).toLocaleString('zh-TW')}${aiResult.usage !== undefined ? ` · 最後一次回應 ${aiResult.usage} tokens（非全文任務總量）` : ''}`}><Sparkles size={10} />{aiResult.model}<span>{aiResult.usage !== undefined ? `${aiResult.usage} tokens · 本次回應` : '可編輯'}</span></div>}
      {note.tags.length > 0 && <div className="note-tags">{note.tags.map(t => <span key={t}>#{t}</span>)}</div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {highlight?.status === 'unresolved' && <div className="inline-error">來源位置需重新標記，原文仍已保存。</div>}
    </div>}
    <footer className="note-footer nodrag">
      {running ? <button className="text-button" onClick={() => cancelTask(note.id)}><LoaderCircle size={13} className="spin" />{running}<X size={13} /></button> : isGroup ? <div className="note-ai-actions"><button disabled={!regroupAnchor} title="重新預覽來源目前的連線群組，產生另一張摘要便條" onClick={() => useApp.setState({ groupSummaryAnchorId: regroupAnchor })}><Network size={14} /><span>再次整合</span></button></div> : <div className="note-ai-actions"><button disabled={emptyScreenshot} title={emptyScreenshot ? '請先輸入便條文字或筆記' : '傳送此便條文字至所選 AI 供應商翻譯'} onClick={() => void runNoteAI(note.id, 'translation')}><Languages size={14} /><span>翻譯</span></button><button disabled={emptyScreenshot} title={emptyScreenshot ? '請先輸入便條文字或筆記' : '傳送此便條文字至所選 AI 供應商摘要'} onClick={() => void runNoteAI(note.id, 'summary')}><Sparkles size={13} /><span>摘要</span></button></div>}
      <div className="note-other-actions">{note.documentId && <button title="定位 PDF 原文" aria-label="定位原文" onClick={() => focusSource(note)}><ArrowUpRight size={16} /></button>}<div className="menu-anchor"><button title="更多便條選項" aria-label="更多便條選項" onClick={() => setMenu(!menu)}><MoreHorizontal size={17} /></button>
        {menu && <><div className="menu-dismiss" onClick={() => setMenu(false)} /><div className="dropdown note-menu"><button onClick={() => { useApp.setState({ groupSummaryAnchorId: note.id }); setMenu(false); }}><Network size={14} />摘要這組關聯</button><button onClick={() => { useApp.setState({ selectedNoteId: note.id }); navigator.clipboard?.writeText([isGroup ? note.summary?.text : '', note.originalText, note.userNotes].filter(Boolean).join('\n\n')); setMenu(false); }}><Quote size={14} />複製內容</button><button onClick={() => { if (note.hidden) patchNote(note.id, { hidden: false }); else deleteNotes([note.id], false); setMenu(false); }}><Link2 size={14} />{note.hidden ? '還原卡片至白板' : '只隱藏卡片'}</button><button className="danger" onClick={remove}><X size={14} />刪除便條與標記</button></div></>}
      </div></div>
    </footer>
    {editing && <NoteEditor note={note} close={() => setEditing(false)} />}
  </article>;
});
