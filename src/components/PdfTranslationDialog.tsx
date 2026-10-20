import { useEffect } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Modal } from './Modal';
import { useApp, toast } from '../store';
import { hasKey, providerName, useCredentials } from '../lib/ai';
import { pausePdfTranslation, preparePdfLayout, recoverPdfTranslationJobs, runPdfTranslation, usePdfTranslation } from '../lib/pdfTranslation';
import { splitTranslationText } from '../lib/pdfParagraphs';
import { reasoningLabels, usesReasoningEffort } from '../types';

export function PdfTranslationDialog({ documentId, close, shown, setShown }: { documentId: string; close: () => void; shown: boolean; setShown: (shown: boolean) => void }) {
  const { workspace, preferences, saveStatus } = useApp(); useCredentials();
  const { active, error } = usePdfTranslation();
  useEffect(() => { void recoverPdfTranslationJobs().then(() => preparePdfLayout(documentId)).catch(e => toast((e as Error).message, 'error')); }, [documentId]);
  const remoteRunning = !active && saveStatus === 'saved' && workspace.pdfTranslationJobs.some(j => j.documentId === documentId && j.status === 'running');
  useEffect(() => {
    if (!remoteRunning) return;
    // pagehide can arrive before the browser releases the owner's Web Lock.
    // Recheck locally while this manager is open; this never calls the API.
    const timer = setInterval(() => { void recoverPdfTranslationJobs().catch(e => toast((e as Error).message, 'error')); }, 1000);
    return () => clearInterval(timer);
  }, [remoteRunning, documentId]);
  const paper = workspace.documents.find(d => d.id === documentId);
  if (!paper) return null;
  const paragraphs = workspace.pdfParagraphs.filter(p => p.documentId === documentId);
  const eligible = paragraphs.filter(p => !['review', 'excluded'].includes(p.role));
  const complete = eligible.filter(p => workspace.pdfTranslations.some(t => t.paragraphId === p.id && t.sourceHash === p.sourceHash && t.layoutVersion === p.layoutVersion));
  const pending = eligible.filter(p => !complete.includes(p));
  const jobs = workspace.pdfTranslationJobs.filter(j => j.documentId === documentId);
  const newest = jobs.at(-1);
  const latest = newest?.status !== 'complete' ? newest : undefined;
  const running = jobs.find(j => j.status === 'running');
  const current = active?.jobId ? jobs.find(j => j.id === active.jobId) : running || latest;
  const provider = latest?.provider || preferences.provider;
  const model = latest?.model || preferences.models[provider];
  const remainingParts = latest?.targets.filter(t => t.status !== 'translated').flatMap(t => {
    const p = paragraphs.find(p => p.id === t.paragraphId);
    return p ? t.parts.filter(part => !part.result).map(part => part.end - part.start) : [];
  }) || pending.flatMap(p => splitTranslationText(p.normalizedText).map(part => part.end - part.start));
  const warnings = workspace.pdfLayouts.filter(l => l.documentId === documentId).flatMap(l => l.warnings.map(w => '第 ' + (l.pageIndex + 1) + ' 頁：' + w));
  const failed = current?.targets.filter(t => t.status === 'failed') || [];
  const settings = () => { close(); useApp.setState({ settingsOpen: true }); };
  const start = (resumeId?: string, replace = false) => {
    const p = resumeId ? provider : preferences.provider;
    if (!hasKey(p) || !(resumeId ? model : preferences.models[p])) { settings(); return; }
    if (replace && !confirm('重新翻譯所有可用段落將再次產生用量。新譯文保存前仍保留舊版本。是否繼續？')) return;
    void runPdfTranslation(documentId, { resumeId, replace });
  };
  return <Modal title="PDF 逐段翻譯" description="同頁同欄分段，跨頁與跨欄分開翻譯。滑鼠移到標註圖示即可閱讀中文。" onClose={close}>
    <div className="pdf-translation-dialog">
      <strong>{paper.name}</strong>
      <p>{paper.pageCount} 頁 · 可翻譯 {eligible.length} 段 · 已保存 {complete.length} 段 · 待檢查 {paragraphs.filter(p => p.role === 'review').length} 段 · 排除 {paragraphs.filter(p => p.role === 'excluded').length} 段</p>
      <label className="translation-visibility"><input type="checkbox" checked={shown} onChange={e => setShown(e.target.checked)} />顯示翻譯圖示</label>
      <div className="privacy-card"><div><strong>只傳送目前 PDF 選定段落的擷取文字</strong>
        <p>{providerName(provider)} · {model || '尚未選擇模型'} · {usesReasoningEffort(provider) ? '推理：' + reasoningLabels[latest?.reasoningEffort || preferences.reasoningEffort] : '依模型預設推理'}。不傳送 PDF、圖片或白板內容。</p></div></div>
      <p className="field-help">尚待翻譯約 {remainingParts.reduce((n, length) => n + length, 0).toLocaleString()} 原文字元，預估 {remainingParts.length} 次請求（接續可沿用已保存子片段）。費用依供應商帳單；表格、掃描與待檢查內容不會自動翻譯。</p>
      {!!complete.length && <p className="field-help">重新翻譯全部將傳送 {eligible.reduce((n, p) => n + p.normalizedText.length, 0).toLocaleString()} 原文字元，約 {eligible.reduce((n, p) => n + splitTranslationText(p.normalizedText).length, 0)} 次請求，使用目前 AI 設定：{providerName(preferences.provider)} · {preferences.models[preferences.provider] || '尚未選擇模型'}{usesReasoningEffort(preferences.provider) ? ' · 推理：' + reasoningLabels[preferences.reasoningEffort] : ' · 模型預設推理'}。</p>}
      {active && <div className="translation-progress" role="status"><LoaderCircle size={16} className="spin" /><span>{active.phase}{active.documentId !== documentId ? '（另一篇文獻）' : ''}</span></div>}
      {current && <div className="translation-progress"><span>本次任務已完成 {current.targets.filter(t => t.status === 'translated').length} / {current.targets.length} 段</span><progress max={current.targets.length} value={current.targets.filter(t => t.status === 'translated').length} /></div>}
      {error && <p className="translation-error" role="alert">{error}</p>}
      {failed.map(t => <p className="translation-error" key={t.paragraphId}>第 {(paragraphs.find(p => p.id === t.paragraphId)?.pageIndex ?? 0) + 1} 頁：{t.error}</p>)}
      {!!warnings.length && <details><summary>擷取提醒（{warnings.length}）</summary>{warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
      {paragraphs.some(p => p.role === 'review' || p.role === 'excluded') && <details><summary>查看待檢查與排除內容</summary>{paragraphs.filter(p => ['review', 'excluded'].includes(p.role)).map(p => <p key={p.id}>第 {p.pageIndex + 1} 頁 · {p.reason}：{p.rawText.slice(0, 100)}</p>)}</details>}
      {!active && !workspace.pdfLayouts.some(l => l.documentId === documentId) && <button className="secondary-button" onClick={() => void preparePdfLayout(documentId)}>重新辨識段落</button>}
    </div>
    <footer className="modal-actions translation-actions">
      <button className="text-button" onClick={settings}>AI 設定</button>
      {active ? <button className="secondary-button" onClick={pausePdfTranslation}>暫停</button> : <>
        {!!complete.length && <button className="secondary-button" disabled={!!running} onClick={() => start(undefined, true)}>重新翻譯全部</button>}
        {latest && <button className="primary-button" disabled={!!running} onClick={() => start(latest.id)}>接續未完成翻譯</button>}
        {!latest && <button className="primary-button" disabled={!pending.length || !!running} onClick={() => start()}>開始逐段翻譯</button>}
      </>}
      <button className="secondary-button" onClick={close}>繼續閱讀</button>
    </footer>
  </Modal>;
}
