import { useEffect, useState } from 'react';
import { Check, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { useApp } from '../store';
import { hasKey, setKey, useCredentials, listModels, testConnection, providerName, endpoints, type ModelOption } from '../lib/ai';
import { Modal } from './Modal';
import { reasoningEfforts, reasoningLabels, type Provider, type ReasoningEffort } from '../types';

const modelCache: Partial<Record<Provider, ModelOption[]>> = {};
const presets = ['gpt-6-luna', 'gpt-5.6-luna'];
const keyLinks: Record<Provider, string> = { openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/api-keys', cgu: 'https://air.cgu.edu.tw/' };
export function Settings({ close }: { close: () => void }) {
  const { preferences, pref } = useApp();
  const provider = preferences.provider; const model = preferences.models[provider];
  useCredentials();
  const [key, setDraftKey] = useState(''); const [show, setShow] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(modelCache[provider] || []);
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [ok, setOk] = useState(false);
  useEffect(() => { setDraftKey(''); setModels(modelCache[provider] || []); setMessage(''); setShow(false); }, [provider]);
  const changeModel = (value: string) => pref({ models: { ...useApp.getState().preferences.models, [provider]: value } });
  async function fetchModels() {
    setBusy('models'); setMessage('');
    try { const result = await listModels(provider); modelCache[provider] = result; setModels(result); setOk(true); setMessage(`已取得 ${result.length} 個模型。清單可見不代表具備文字生成權限，請測試所選模型。`); }
    catch (e) { setOk(false); setMessage((e as Error).message); }
    finally { setBusy(''); }
  }
  async function test() {
    setBusy('test'); setMessage('');
    try { await testConnection(provider, model, preferences.reasoningEffort); setOk(true); setMessage('連線成功，這個模型已通過文字生成測試。'); }
    catch (e) { setOk(false); setMessage((e as Error).message); }
    finally { setBusy(''); }
  }
  return <Modal title="連接你的 AI" description="讓模型協助理解文獻，由你決定何時分享哪些文字。" onClose={close}>
    <div className="settings-body"><div className="provider-tabs">{(['openai', 'cgu', 'gemini'] as Provider[]).map(p => <button key={p} aria-label={providerName(p)} aria-pressed={provider === p} className={provider === p ? 'active' : ''} onClick={() => !busy && pref({ provider: p })} disabled={!!busy}><span className={`provider-mark ${p === 'gemini' ? 'gemini-mark' : ''}`} aria-hidden="true">{p === 'openai' ? '✳' : p === 'cgu' ? '◈' : '✦'}</span>{providerName(p)}{hasKey(p) && <span className="connected-dot" />}</button>)}</div>
      <div className="api-endpoint"><span>Base URL</span><code>{endpoints[provider]}</code></div>
      {provider === 'cgu' && <p className="cgu-access-note">CGU 瀏覽器直連需要閘道允許目前網站來源 <code>{location.origin}</code> 的 CORS；若連線受阻，請聯絡閘道管理員開放來源。</p>}
      <div className="privacy-card"><ShieldCheck size={22} /><div><strong>金鑰只留在這個分頁。</strong><p>不儲存至硬碟、localStorage、資料庫或 GitHub。重新整理或關閉分頁後，需重新輸入。請在私人電腦使用受信任的瀏覽器。</p></div></div>
      <label className="field-label" htmlFor="api-key">你的 API key <span>{hasKey(provider) ? <><Check size={12} />本分頁已設定</> : '尚未設定'}</span></label>
      <div className="key-input"><KeyRound size={16} /><input id="api-key" autoComplete="off" spellCheck={false} type={show ? 'text' : 'password'} placeholder={hasKey(provider) ? '輸入新金鑰以更換…' : provider === 'gemini' ? 'AIza…' : provider === 'cgu' ? '貼上你的 CGU API key' : 'sk-…'} value={key} onChange={e => setDraftKey(e.target.value)} /><button className="icon-button" onClick={() => setShow(!show)} aria-label={show ? '隱藏 API key' : '顯示 API key'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      <div className="key-actions"><a href={keyLinks[provider]} target="_blank" rel="noreferrer">{provider === 'cgu' ? '前往 CGU 平台' : `取得 ${providerName(provider)} API key`}<ExternalLink size={12} /></a><div>{hasKey(provider) && <button className="text-button danger" onClick={() => { setKey(provider, ''); setMessage('已清除此分頁的金鑰。'); setOk(true); }} disabled={!!busy}><Trash2 size={13} />清除</button>}<button className="small-button" disabled={!key.trim() || !!busy} onClick={() => { setKey(provider, key); setDraftKey(''); setMessage('金鑰已暫存於分頁記憶體。請選擇模型並測試連線。'); setOk(true); }}>使用此金鑰</button></div></div>
      <div className="settings-divider" />
      <div className="field-row"><label className="field-label" htmlFor="model-id">選擇模型</label><button className="text-button" disabled={!hasKey(provider) || !!busy} onClick={() => void fetchModels()}>{busy === 'models' ? <LoaderCircle size={13} className="spin" /> : <Wifi size={13} />}取得模型清單</button></div>
      {provider !== 'gemini' && <select aria-label="模型選項" className="full-input" value={presets.includes(model) ? model : 'custom'} disabled={!!busy} onChange={e => { changeModel(e.target.value === 'custom' ? '' : e.target.value); if (e.target.value === 'custom') document.getElementById('model-id')?.focus(); }}>
        {presets.map(id => <option key={id} value={id}>{id}</option>)}<option value="custom">自訂模型 ID</option>
      </select>}
      <input id="model-id" list="provider-models" value={model} onChange={e => changeModel(e.target.value.trim())} placeholder="輸入自訂模型 ID，或從取得的清單選擇" autoComplete="off" className="full-input" disabled={!!busy} />
      <datalist id="provider-models">{models.map(m => <option key={m.id} value={m.id}>{m.label} · {m.capability}</option>)}</datalist>
      <p className="field-help">預設選項與模型清單不保證帳戶有權限；請用測試連線確認。計費依你的供應商帳戶。</p>
      <div className="reasoning-field"><label className="field-label" htmlFor="reasoning-effort">推理程度</label>
        <select id="reasoning-effort" className="full-input" value={preferences.reasoningEffort} disabled={provider === 'gemini' || !!busy} onChange={e => pref({ reasoningEffort: e.target.value as ReasoningEffort })} aria-describedby="reasoning-help">{reasoningEfforts.map(effort => <option key={effort} value={effort}>{reasoningLabels[effort]}{effort === 'medium' ? '（預設）' : ''}</option>)}</select>
        <p className="field-help" id="reasoning-help">{provider === 'gemini' ? 'Gemini 使用模型自身的推理預設；此調整適用於 OpenAI 與 CGU。' : '較高的推理程度可能增加等待時間與用量，實際支援依模型而定。'}</p>
      </div>
      {message && <div role="status" className={`settings-message ${ok ? 'success' : 'error'}`}>{ok ? <Check size={16} /> : <KeyRound size={16} />}<span>{message}</span></div>}
      <div className="data-disclosure"><strong>每次 AI 操作會傳送什麼？</strong><p>翻譯／段落摘要：該便條的原文（無原文時使用筆記）。<br />全文摘要：目前 PDF 在本機擷取的分塊文字。<br />測試連線：一則簡短測試文字。資料直接傳給 {providerName(provider)}；本站沒有代管伺服器。</p></div>
    </div><footer className="modal-actions"><button className="secondary-button" onClick={() => void test()} disabled={!hasKey(provider) || !model || !!busy}>{busy === 'test' ? <LoaderCircle size={15} className="spin" /> : <Wifi size={15} />}測試連線<span className="subtle">（會產生少量用量）</span></button><button className="primary-button" onClick={close}>完成</button></footer>
  </Modal>;
}
