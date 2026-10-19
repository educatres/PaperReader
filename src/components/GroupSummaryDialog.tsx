import { useMemo } from 'react';
import { Network, ShieldCheck, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../store';
import { hasKey, providerName, runGroupAI, useAI, useCredentials } from '../lib/ai';
import { connectedGroup, prepareGroupSummary } from '../lib/groupSummary';
import { reasoningLabels, usesReasoningEffort } from '../types';

export function GroupSummaryDialog({ anchorId, close }: { anchorId: string; close: () => void }) {
  const { workspace, preferences } = useApp(); useCredentials();
  const running = useAI(s => !!s.group);
  const preview = useMemo(() => {
    try { return { plan: prepareGroupSummary(workspace, anchorId), error: '' }; }
    catch (e) { return { plan: undefined, error: (e as Error).message }; }
  }, [workspace, anchorId]);
  const group = connectedGroup(workspace, anchorId);
  const refs = new Map(group.notes.map((n, i) => [n.id, `N${i + 1}`]));
  const { provider, models, reasoningEffort } = preferences;
  const configured = hasKey(provider) && !!models[provider];
  return <Modal title="整合這組關聯便條" description="從一張便條出發，沿直接與間接連線整理同一組想法。" onClose={close} wide>
    <div className="group-summary-preview">
      <div className="group-summary-heading"><Network size={25} /><div><strong>{group.notes.length} 張便條 · {group.edges.length} 條關係</strong><p>只納入未隱藏的連通便條；箭頭方向會保留給 AI 判讀。</p></div></div>
      <ol className="group-preview-sources" aria-label="將摘要的便條">{group.notes.map((n, i) => <li key={n.id}><b>N{i + 1}</b><div><strong>{n.title || '未命名便條'}</strong><p>{(n.originalText || n.userNotes || n.summary?.text || n.translation?.text || '尚無文字內容').slice(0, 140)}</p></div></li>)}</ol>
      <div className="group-preview-relations"><h3>連線如何影響摘要</h3><ul aria-label="將參考的連線">{group.edges.map((e, i) => <li key={e.id}><b>R{i + 1}</b><span>{refs.get(e.source)} {e.directed ? '→' : '↔'} {refs.get(e.target)}</span><strong>{e.relationType}</strong>{e.label && <p>{e.label}</p>}</li>)}</ul>
        <p className="field-help">AI 會整合共同主題、支持與對比，區分延伸想法及待驗證假說；人工連線不代表事實已獲證實。</p>
      </div>
      <div className="privacy-card"><ShieldCheck size={21} /><div><strong>只傳送預覽這組便條與連線</strong><p>包含原文、既有翻譯／摘要、人工筆記、標籤、來源文件名稱與頁碼，以及關係類型、說明、方向。直接傳至 {providerName(provider)} · {models[provider] || '尚未選擇模型'} · {usesReasoningEffort(provider) ? `推理：${reasoningLabels[reasoningEffort]}` : '依模型預設推理'}。截圖只使用便條文字，無文字的截圖會標記內容缺失；不傳送或分析圖片，也不傳送 PDF 原檔或其他群組。</p></div></div>
      {preview.plan && <p className="field-help">約 {preview.plan.input.length.toLocaleString()} 字元，執行 1 次生成請求，費用依供應商帳戶。結果會成為新的紫色整合便條，附來源按鈕與產生時的內容快照；來源後續修改時，需重新生成摘要。</p>}
      {preview.error && <div className="inline-error" role="alert">{preview.error}</div>}
    </div>
    <footer className="modal-actions"><button className="secondary-button" onClick={close}>取消</button><button className="primary-button" disabled={!preview.plan || running} onClick={() => {
      if (!configured) { close(); useApp.setState({ settingsOpen: true }); return; }
      if (preview.plan) { const plan = preview.plan; close(); void runGroupAI(plan); }
    }}><Sparkles size={15} />{configured ? '同意傳送並整合' : '先設定 AI'}</button></footer>
  </Modal>;
}
