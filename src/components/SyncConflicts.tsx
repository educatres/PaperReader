import { useState } from 'react';
import { Download } from 'lucide-react';
import { resolveConflict, useApp } from '../store';
import { Modal } from './Modal';
import { patchValue } from '../lib/workspaceChanges';

const collectionNames = { documents: '文獻', notes: '便條', highlights: '螢光標記', edges: '便條關係', jobs: '全文摘要任務', pdfLayouts: 'PDF 版面', pdfParagraphs: 'PDF 段落', pdfTranslations: 'PDF 譯文', pdfTranslationJobs: '逐段翻譯任務', workspace: '研究空間' };
const fieldNames: Record<string, string> = { title: '標題', name: '名稱', userNotes: '我的筆記', originalText: '原文／參考文字', translation: '翻譯', summary: 'AI 摘要', tags: '標籤', color: '顏色', position: '白板位置', width: '寬度', hidden: '隱藏狀態', collapsed: '收合狀態', relationType: '關係類型', label: '關係說明', directed: '箭頭方向', status: '狀態', results: '摘要內容' };
function readable(value: unknown) {
  if (value === undefined) return '（已刪除或未設定）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
export function SyncConflicts() {
  const conflicts = useApp(s => s.conflicts); const workspace = useApp(s => s.workspace);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const draft = conflicts[0]; if (!draft) return null;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'PaperReader-conflict-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <><button className="sync-conflict-notice" onClick={() => setOpen(true)}>有 {conflicts.length} 份跨視窗修改草稿待確認</button>
    {open && <Modal title="確認跨視窗修改" description={draft.reason} onClose={() => setOpen(false)} wide>
      <div className="sync-conflict-body"><p>草稿已保存在本機。選擇版本前，其他視窗的資料會維持目前內容。</p>
        {draft.patches.map((patch, index) => <div className="sync-conflict-field" key={index}><strong>{collectionNames[patch.collection]} · {patch.field ? fieldNames[patch.field] || '來源資料' : '整筆資料'}</strong><div><label>目前共用版本<textarea readOnly value={readable(patchValue(workspace, patch))} rows={3} /></label><label>這份草稿<textarea readOnly value={readable(patch.after)} rows={3} /></label></div></div>)}
      </div><footer className="modal-actions"><button className="text-button" onClick={download}><Download size={14} />下載草稿</button><button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); try { await resolveConflict(draft, false); } finally { setBusy(false); } }}>保留共用版本</button><button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await resolveConflict(draft, true); } finally { setBusy(false); } }}>套用草稿版本</button></footer>
    </Modal>}</>;
}
