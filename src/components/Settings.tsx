import { beginBusyOperation } from '../lib/projectContext';
import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, Trash2, Wifi } from 'lucide-react';
import { useApp } from '../store';
import { hasKey, setKey, useCredentials, listModels, testConnection, verifyCguKey, providerName, endpoints, type ModelOption } from '../lib/ai';
import { cguDocs, cguKeyPage, cguModelPresets, defaultCguModel } from '../lib/cgu';
import { Modal } from './Modal';
import { providers, isProviderAvailable, reasoningEfforts, reasoningLabels, usesReasoningEffort, type Provider, type ReasoningEffort } from '../types';

const modelCache: Partial<Record<Provider, ModelOption[]>> = {};
const cguPresets: string[] = [...cguModelPresets];
const preferredGeminiModel = 'gemini-flash-lite-latest';
const keyLinks: Partial<Record<Provider, string>> = { openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/api-keys', cgu: cguKeyPage, grok: 'https://console.x.ai/' };
export function Settings({ close }: { close: () => void }) {
  const { preferences, pref } = useApp();
  const provider = preferences.provider; const model = preferences.models[provider];
  const isCgu = provider === 'cgu';
  const detectsModels = provider === 'grok';
  useCredentials();
  const [key, setDraftKey] = useState(''); const [show, setShow] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(modelCache[provider] || []);
  const visibleModels = isCgu ? models.filter(option => cguPresets.includes(option.id)) : models;
  const selectedOption = visibleModels.some(m => m.id === model) ? model : '';
  const [busy, setBusyState] = useState(''); const releaseBusy = useRef<(() => void) | undefined>(undefined);
  function setBusy(value: string) {
    if (value && !releaseBusy.current) releaseBusy.current = beginBusyOperation();
    if (!value) { releaseBusy.current?.(); releaseBusy.current = undefined; }
    setBusyState(value);
  } const [message, setMessage] = useState(''); const [ok, setOk] = useState(false);
  useEffect(() => { setDraftKey(''); setModels(modelCache[provider] || []); setMessage(''); setShow(false); }, [provider]);
  useEffect(() => {
    const clearDrafts = () => { setDraftKey(''); setShow(false); };
    window.addEventListener('pagehide', clearDrafts);
    return () => window.removeEventListener('pagehide', clearDrafts);
  }, []);
  const storedKey = hasKey(provider);
  const keyReady = storedKey || !!key.trim();
  function resetModels() {
    delete modelCache[provider];
    setModels([]);
  }
  function applyDraftKey() {
    if (key.trim()) {
      setKey(provider, key); setDraftKey(''); setShow(false);
      resetModels();
    }
  }
  function clearKey() {
    setKey(provider, ''); setDraftKey(''); setShow(false); resetModels();
    setMessage(`已清除 ${providerName(provider)} 的本機 API Key 記憶。`); setOk(true);
  }
  async function saveKey() {
    try {
      if (detectsModels) { await fetchModels(); return; }
      applyDraftKey(); setMessage('金鑰已暫存於分頁記憶體。請選擇模型並測試連線。'); setOk(true);
    }
    catch (e) { setOk(false); setMessage((e as Error).message); }
  }
  async function verify() {
    setBusy('verify'); setMessage('');
    try { applyDraftKey(); const result = await verifyCguKey(); modelCache.cgu = result; setModels(result); setOk(true); setMessage(`CGU 金鑰已通過驗證，已取得 ${result.length} 個模型。此驗證沒有送出文字生成請求；模型的文字生成能力請再測試連線。`); }
    catch (e) { setOk(false); setMessage((e as Error).message); }
    finally { setBusy(''); }
  }
  const changeModel = (value: string) => pref({ models: { ...useApp.getState().preferences.models, [provider]: value } });
  async function fetchModels() {
    setBusy('models'); setMessage('');
    try {
      applyDraftKey(); const result = await listModels(provider); modelCache[provider] = result; setModels(result);
      let selection = '';
      if (provider === 'gemini') {
        const available = result.some(m => m.id === preferredGeminiModel);
        changeModel(available ? preferredGeminiModel : '');
        selection = available ? `已預設選擇 ${preferredGeminiModel}。` : `清單未包含 ${preferredGeminiModel}，請自行選擇模型。`;
      } else if (detectsModels) {
        const selected = result.some(m => m.id === model) ? model : result[0]?.id || '';
        changeModel(selected);
        selection = selected ? `已選擇 ${selected}，可從下拉選單更換。` : '目前沒有可用模型，請確認帳戶模型權限，或輸入自訂模型 ID。';
      }
      setOk(true); setMessage(`已取得 ${result.length} 個模型。${selection}清單可見不代表具備文字生成權限，請測試所選模型。`);
    }
    catch (e) { setOk(false); setMessage((e as Error).message); }
    finally { setBusy(''); }
  }
  async function test() {
    setBusy('test'); setMessage('');
    try { applyDraftKey(); await testConnection(provider, model, preferences.reasoningEffort); setOk(true); setMessage('連線成功，這個模型已通過文字生成測試。'); }
    catch (e) { setOk(false); setMessage((e as Error).message); }
    finally { setBusy(''); }
  }
  return <Modal title="連接你的 AI" description="讓模型協助理解文獻，由你決定何時分享哪些文字。" onClose={close}>
    <div className="settings-body"><div className="provider-tabs">{providers.map(p => <button key={p} aria-label={providerName(p)} aria-pressed={provider === p} className={provider === p ? 'active' : ''} onClick={() => !busy && isProviderAvailable(p) && pref({ provider: p })} disabled={!!busy || !isProviderAvailable(p)}><span className={`provider-mark ${p === 'gemini' ? 'gemini-mark' : ''}`} aria-hidden="true">{p === 'openai' ? '✳' : p === 'cgu' ? '◈' : p === 'grok' ? '𝕏' : '✦'}</span><span>{providerName(p)}{!isProviderAvailable(p) && <small className="provider-unavailable">尚未開放</small>}</span>{hasKey(p) && <span className="connected-dot" />}</button>)}</div>
      {provider === 'gemini' && <p className="field-help model-recommendation gemini-recommendation">Google AI Studio 建議用 <code>{preferredGeminiModel}</code> 模型</p>}
      {isCgu && <p className="field-help model-recommendation">CGU API 建議使用 <code>{defaultCguModel}</code> 模型</p>}
      <div className="api-endpoint"><span>Base URL</span><code>{endpoints[provider]}</code></div>
      {provider === 'cgu' && <section className="cgu-connection">
        <p className="field-help">瀏覽器直接連線至 CGU API。</p>
        <p className="field-help"><a href={cguDocs} target="_blank" rel="noreferrer">CGU 官方 API 說明</a> · 一般 CGU 模型使用 Responses API；`gpt-oss:20b` 使用 Chat Completions。</p>
      </section>}
      <label className="field-label" htmlFor="api-key">你的 API key <span>{hasKey(provider) ? <><Check size={12} />本分頁已設定</> : '尚未設定'}</span></label>
      <div className="key-input"><KeyRound size={16} /><input id="api-key" autoComplete="off" spellCheck={false} type={show ? 'text' : 'password'} placeholder={storedKey ? '***' : provider === 'gemini' ? 'AIza…' : provider === 'cgu' ? '貼上你的 CGU API key' : provider === 'grok' ? 'xai-…' : 'sk-…'} value={key} disabled={!!busy} onChange={e => setDraftKey(e.target.value)} aria-describedby={storedKey ? 'stored-key-help' : undefined} /><button className="icon-button" onClick={() => setShow(!show)} disabled={!key || !!busy} aria-label={show ? '隱藏 API key' : '顯示 API key'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      {storedKey && <p className="field-help" id="stored-key-help">*** 表示此供應商的金鑰已暫存於本分頁；輸入新金鑰可更換。</p>}
      <div className="key-actions"><a href={keyLinks[provider]} target="_blank" rel="noreferrer">{provider === 'cgu' ? '啟用／取得 CGU API key' : `取得 ${providerName(provider)} API key`}<ExternalLink size={12} /></a><div><button className="text-button danger" onClick={clearKey} disabled={!keyReady || !!busy}><Trash2 size={13} />清除本機 API Key</button><button className="small-button" disabled={!key.trim() || !!busy} onClick={() => void saveKey()}>使用此金鑰</button></div></div>
      {detectsModels && <p className="field-help">按「使用此金鑰」後會自動偵測可用模型；也可按「自動偵測模型」重新查詢。模型偵測不會送出文字生成請求。</p>}
      {provider === 'cgu' && <div className="cgu-verify"><button className="small-button" disabled={!keyReady || !!busy} onClick={() => void verify()}>{busy === 'verify' && <LoaderCircle size={13} className="spin" />}驗證 CGU 金鑰</button><p className="field-help">可貼上純金鑰、Bearer 金鑰或 Authorization: Bearer 金鑰。驗證只查詢 /models，不送出文字生成。</p></div>}
      <div className="settings-divider" />
      <div className="field-row"><label className="field-label" htmlFor="model-id">選擇模型</label><button className="text-button" disabled={!keyReady || !!busy} onClick={() => void fetchModels()}>{busy === 'models' ? <LoaderCircle size={13} className="spin" /> : <Wifi size={13} />}{detectsModels ? '自動偵測模型' : '取得模型清單'}</button></div>
      <select aria-label="模型選項" className="full-input" value={selectedOption} disabled={!!busy || !visibleModels.length} onChange={e => changeModel(e.target.value)}>
        {!selectedOption && <option value="" hidden>請選擇模型</option>}
        {visibleModels.map(m => <option key={m.id} value={m.id}>{isCgu ? m.id : `${m.label} · ${m.id}`}</option>)}
      </select>
      <input id="model-id" list="provider-models" value={model} onChange={e => changeModel(e.target.value.trim())} placeholder="輸入自訂模型 ID，或從取得的清單選擇" autoComplete="off" className="full-input" disabled={!!busy} />
      <datalist id="provider-models">{visibleModels.map(m => <option key={m.id} value={m.id}>{m.label} · {m.capability}</option>)}</datalist>
      <p className="field-help">預設選項與模型清單不保證帳戶有權限；請用測試連線確認。計費依你的供應商帳戶。</p>
      <p className="field-help">清單中的部分模型僅能處理圖片或語音。本服務的翻譯與摘要需要能處理文字的 AI 模型，請選擇支援文字的模型。</p>
      <div className="reasoning-field"><label className="field-label" htmlFor="reasoning-effort">推理程度</label>
        <select id="reasoning-effort" className="full-input" value={preferences.reasoningEffort} disabled={!usesReasoningEffort(provider) || !!busy} onChange={e => pref({ reasoningEffort: e.target.value as ReasoningEffort })} aria-describedby="reasoning-help">{reasoningEfforts.map(effort => <option key={effort} value={effort}>{reasoningLabels[effort]}{effort === 'medium' ? '（預設）' : ''}</option>)}</select>
        <p className="field-help" id="reasoning-help">{!usesReasoningEffort(provider) ? `${providerName(provider)} 使用模型自身的推理預設；此調整適用於 OpenAI 與 CGU。` : '較高的推理程度可能增加等待時間與用量，實際支援依模型而定。'}</p>
      </div>
      {message && <div role="status" className={`settings-message ${ok ? 'success' : 'error'}`}>{ok ? <Check size={16} /> : <KeyRound size={16} />}<span>{message}</span></div>}
      <div className="data-disclosure"><strong>每次 AI 操作會傳送什麼？</strong><p>翻譯／段落摘要：該便條的文字（無原文時使用筆記），截圖不送交分析。<br />關聯摘要：確認預覽的便條文字與連線屬性。<br />全文摘要：目前 PDF 在本機擷取的分塊文字。<br />測試連線：一則簡短測試文字。資料直接傳給 {providerName(provider)}；本站沒有代管伺服器。</p></div>
    </div><footer className="modal-actions"><button className="secondary-button" onClick={() => void test()} disabled={!keyReady || !model || !!busy}>{busy === 'test' ? <LoaderCircle size={15} className="spin" /> : <Wifi size={15} />}測試連線<span className="subtle">（會產生少量用量）</span></button><button className="primary-button" onClick={close}>完成</button></footer>
  </Modal>;
}
