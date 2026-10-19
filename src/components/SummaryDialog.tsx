import { useEffect } from 'react';
import { FileText, ShieldCheck, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { useApp, recoverSummaryJobs } from '../store';
import { chunkDocument, hasKey, providerName, runDocumentAI, useCredentials } from '../lib/ai';
import { reasoningLabels, usesReasoningEffort } from '../types';

export function SummaryDialog({ close }: { close: () => void }) {
  const { workspace, preferences } = useApp(); useCredentials();
  useEffect(() => { void recoverSummaryJobs(); }, []);
  const paper = workspace.documents.find(d => d.id === workspace.activeDocumentId);
  if (!paper) return null;
  const chunks = chunkDocument(paper.pages); const chars = paper.pages.join('').length;
  const previous = [...workspace.jobs].reverse().find(j => j.documentId === paper.id && (j.status === 'failed' || j.status === 'paused'));
  const selectedProvider = previous?.provider || preferences.provider;
  const selectedModel = previous?.model || preferences.models[selectedProvider];
  const selectedEffort = previous ? previous.reasoningEffort || 'medium' : preferences.reasoningEffort;
  return <Modal title="讀懂整篇文獻的脈絡" description="先整理每個分塊，再把研究線索串起來。" onClose={close}>
    <div className="summary-preview"><div className="summary-paper"><FileText size={28} /><div><strong>{paper.name}</strong><span>{paper.pageCount} 頁 · {chars.toLocaleString()} 字元 · {chunks.length} 個分塊</span></div></div>
      <div className="summary-sections">{['研究背景', '研究目的', '方法與資料', '主要結果', '限制與貢獻', '延伸方向'].map((s, i) => <span key={s}><b>0{i + 1}</b>{s}</span>)}</div>
      <div className="privacy-card"><ShieldCheck size={21} /><div><strong>只傳送目前這篇 PDF 的擷取文字</strong><p>直接傳至 {providerName(selectedProvider)} · {selectedModel || '尚未選擇模型'} · {usesReasoningEffort(selectedProvider) ? `推理：${reasoningLabels[selectedEffort]}` : '依模型預設推理'}。不傳送 PDF 原檔、其他文獻或未選取的便條。</p></div></div>
      <p className="field-help">預估至少 {chunks.length + 1} 次生成請求；輸入約 {Math.ceil(chars / 3).toLocaleString()} tokens（粗估，不含提示與整合階段）。實際費用依模型與供應商帳單，本站無法預先報價。圖表、公式與雙欄順序可能無法完整擷取，結果需回查原文。</p>
      {previous && <div className="resume-notice">有一項可接續的任務：已完成 {previous.results.filter(Boolean).length} / {previous.chunks.length} 個分塊。接續時使用原任務的供應商、模型與推理程度。{previous.error && <p>{previous.error}</p>}</div>}
      {!chunks.length && <div className="inline-error">這篇 PDF 沒有可用文字，需要先做 OCR。</div>}
    </div><footer className="modal-actions"><button className="secondary-button" onClick={close}>稍後再讀</button><button className="primary-button" disabled={!chunks.length} onClick={() => {
      if (!hasKey(selectedProvider) || !selectedModel) { useApp.getState().pref({ provider: selectedProvider, reasoningEffort: selectedEffort, ...(selectedModel ? { models: { ...useApp.getState().preferences.models, [selectedProvider]: selectedModel } } : {}) }); useApp.setState({ settingsOpen: true }); close(); return; }
      close(); void runDocumentAI(paper.id, previous?.id);
    }}><Sparkles size={15} />{previous ? '同意傳送並接續' : '同意傳送並生成'}</button></footer>
  </Modal>;
}
