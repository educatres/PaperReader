import { useEffect, useState } from 'react';
import { Check, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { useApp } from '../store';
import { hasKey, setKey, useCredentials, listModels, testConnection, verifyCguKey, providerName, endpoints, type ModelOption } from '../lib/ai';
import { bridgeEndpoint, checkBridge, cguDocs, cguKeyPage, hasBridgeToken, setBridgeToken } from '../lib/cgu';
import { Modal } from './Modal';
import { reasoningEfforts, reasoningLabels, type Provider, type ReasoningEffort } from '../types';

const modelCache: Partial<Record<Provider, ModelOption[]>> = {};
const presets = ['gpt-6-luna', 'gpt-5.6-luna'];
const preferredGeminiModel = 'gemini-flash-lite-latest';
const keyLinks: Record<Provider, string> = { openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/api-keys', cgu: cguKeyPage, mercuryapi: 'https://air.cgu.edu.tw/mercuryapi/#redeem' };
export function Settings({ close }: { close: () => void }) {
  const { preferences, pref } = useApp();
  const provider = preferences.provider; const model = preferences.models[provider];
  useCredentials();
  const [key, setDraftKey] = useState(''); const [show, setShow] = useState(false);
  const [pairing, setPairing] = useState('');
  const [models, setModels] = useState<ModelOption[]>(modelCache[provider] || []);
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [ok, setOk] = useState(false);
  useEffect(() => { setDraftKey(''); setPairing(''); setModels(modelCache[provider] || []); setMessage(''); setShow(false); }, [provider]);
  useEffect(() => {
    const clearDrafts = () => { setDraftKey(''); setPairing(''); setShow(false); };
    window.addEventListener('pagehide', clearDrafts);
    return () => window.removeEventListener('pagehide', clearDrafts);
  }, []);
  const local = provider === 'cgu' && preferences.cguConnection === 'localhost';
  const storedKey = hasKey(provider);
  const keyReady = storedKey || !!key.trim();
  function applyDraftKey() { if (key.trim()) { setKey(provider, key); setDraftKey(''); setShow(false); } }
  function clearKey() {
    setKey(provider, ''); setDraftKey(''); setShow(false);
    setMessage(`已清除 ${providerName(provider)} 的本機 API Key 記憶。`); setOk(true);
  }
  async function saveKey() {
    try {
      if (provider === 'mercuryapi') { await fetchModels(); return; }
      applyDraftKey(); setMessage('金鑰已暫存於分頁記憶體。請選擇模型並測試連線。'); setOk(true);
    }
    catch (e) { setOk(false); setMessage((e as Error).message); }
  }
  async function connectBridge() {
    setBusy('bridge'); setMessage('');
    try { if (pairing.trim()) setBridgeToken(pairing); await checkBridge(); setPairing(''); setOk(true); setMessage('本機助手已連接。現在可以貼上 CGU 金鑰並驗證。'); }
    catch (e) { setBridgeToken(''); setOk(false); setMessage((e as Error).message); }
    finally { setBusy(''); }
  }
  async function verify() {
    setBusy('verify'); setMessage('');
    try { applyDraftKey(); const result = await verifyCguKey(); modelCache.cgu = result; setModels(result); setOk(true); setMessage(`CGU 金鑰已通過驗證，已取得 ${result.length} 個模型。此驗證沒有送出文字生成請求；模型的 Responses 能力請再測試連線。`); }
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
      } else if (provider === 'mercuryapi') {
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
    <div className="settings-body"><div className="provider-tabs">{(['openai', 'cgu', 'gemini', 'mercuryapi'] as Provider[]).map(p => <button key={p} aria-label={providerName(p)} aria-pressed={provider === p} className={provider === p ? 'active' : ''} onClick={() => !busy && pref({ provider: p })} disabled={!!busy}><span className={`provider-mark ${p === 'gemini' ? 'gemini-mark' : ''}`} aria-hidden="true">{p === 'openai' ? '✳' : p === 'cgu' ? '◈' : p === 'mercuryapi' ? '☿' : '✦'}</span>{providerName(p)}{hasKey(p) && <span className="connected-dot" />}</button>)}</div>
      <div className="api-endpoint"><span>Base URL</span><code>{endpoints[provider]}</code></div>
      {provider === 'cgu' && <section className="cgu-connection">
        <label className="field-label" htmlFor="cgu-connection">CGU 連線方式</label>
        <select id="cgu-connection" className="full-input" value={preferences.cguConnection} disabled={!!busy} onChange={e => { pref({ cguConnection: e.target.value as 'direct' | 'localhost' }); setMessage(''); }}>
          <option value="localhost">localhost 本機助手（建議）</option><option value="direct">瀏覽器直接連線</option>
        </select>
        {local ? <div className="bridge-setup">
          <p>助手只在你自己的電腦執行，協助連接 CGU。每次使用時：</p>
          <ol><li>安裝 <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Node.js 24 或更新版本</a>，<a href={`${import.meta.env.BASE_URL}PaperReader-CGU-Bridge.mjs`} download>下載本機助手</a>。</li>
            <li>在下載檔案所在的資料夾開啟終端機，執行 <code>node PaperReader-CGU-Bridge.mjs</code>，保持視窗開啟。</li>
            <li>複製視窗中的 Pairing code，貼到下方後連接。若瀏覽器詢問本機網路權限，請允許。</li></ol>
          <p className="field-help">助手位址：<code>{bridgeEndpoint}</code>。連接助手時不會傳送 API key；每次重啟助手會更換連線碼。</p>
          <label className="field-label" htmlFor="bridge-code">本機助手連線碼 <span>{hasBridgeToken() ? '本分頁已配對' : '尚未配對'}</span></label>
          <input id="bridge-code" className="full-input" type="password" autoComplete="off" spellCheck={false} value={pairing} onChange={e => setPairing(e.target.value)} placeholder="貼上助手視窗中的 Pairing code" disabled={!!busy} />
          <div className="bridge-actions"><button className="small-button" disabled={!!busy || (!pairing.trim() && !hasBridgeToken())} onClick={() => void connectBridge()}>{busy === 'bridge' && <LoaderCircle size={13} className="spin" />}連接本機助手</button>
            {hasBridgeToken() && <button className="text-button" disabled={!!busy} onClick={() => { setBridgeToken(''); setPairing(''); setOk(true); setMessage('已清除此分頁的助手連線碼。'); }}>清除配對</button>}</div>
        </div> : <p className="cgu-access-note">CGU 目前拒絕此網站來源的瀏覽器跨來源連線。建議使用本機助手；直接連線須由 CGU 管理員允許 <code>{location.origin}</code> 的 CORS。</p>}
        <p className="field-help"><a href={cguDocs} target="_blank" rel="noreferrer">CGU 官方 API 說明</a> · 本程式使用 Bearer 授權與 Responses API；自訂模型也須支援 Responses。</p>
      </section>}
      <div className="privacy-card"><ShieldCheck size={22} /><div><strong>金鑰只暫存在記憶體。</strong><p>不儲存至硬碟、localStorage、資料庫或 GitHub。重新整理或關閉分頁後，需重新輸入。{local ? '金鑰經本機助手的記憶體，以 HTTPS 傳給 CGU 驗證；助手不記錄或保存金鑰。' : '呼叫時以 HTTPS 傳給所選供應商驗證。'}</p></div></div>
      <label className="field-label" htmlFor="api-key">你的 API key <span>{hasKey(provider) ? <><Check size={12} />本分頁已設定</> : '尚未設定'}</span></label>
      <div className="key-input"><KeyRound size={16} /><input id="api-key" autoComplete="off" spellCheck={false} type={show ? 'text' : 'password'} placeholder={storedKey ? '***' : provider === 'gemini' ? 'AIza…' : provider === 'cgu' ? '貼上你的 CGU API key' : provider === 'mercuryapi' ? 'sk-mercury-…' : 'sk-…'} value={key} disabled={!!busy} onChange={e => setDraftKey(e.target.value)} aria-describedby={storedKey ? 'stored-key-help' : undefined} /><button className="icon-button" onClick={() => setShow(!show)} disabled={!key || !!busy} aria-label={show ? '隱藏 API key' : '顯示 API key'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      {storedKey && <p className="field-help" id="stored-key-help">*** 表示此供應商的金鑰已暫存於本分頁；輸入新金鑰可更換。</p>}
      <div className="key-actions"><a href={keyLinks[provider]} target="_blank" rel="noreferrer">{provider === 'cgu' ? '啟用／取得 CGU API key' : `取得 ${providerName(provider)} API key`}<ExternalLink size={12} /></a><div><button className="text-button danger" onClick={clearKey} disabled={!keyReady || !!busy}><Trash2 size={13} />清除本機 API Key</button><button className="small-button" disabled={!key.trim() || !!busy} onClick={() => void saveKey()}>使用此金鑰</button></div></div>
      {provider === 'mercuryapi' && <p className="field-help">按「使用此金鑰」後會自動偵測可用模型；也可按「自動偵測模型」重新查詢。模型偵測不會送出文字生成請求。</p>}
      {provider === 'cgu' && <div className="cgu-verify"><button className="small-button" disabled={!keyReady || !!busy} onClick={() => void verify()}>{busy === 'verify' && <LoaderCircle size={13} className="spin" />}驗證 CGU 金鑰</button><p className="field-help">可貼上純金鑰、Bearer 金鑰或 Authorization: Bearer 金鑰。驗證只查詢 /models，不送出文字生成。</p></div>}
      <div className="settings-divider" />
      <div className="field-row"><label className="field-label" htmlFor="model-id">選擇模型</label><button className="text-button" disabled={!keyReady || !!busy} onClick={() => void fetchModels()}>{busy === 'models' ? <LoaderCircle size={13} className="spin" /> : <Wifi size={13} />}{provider === 'mercuryapi' ? '自動偵測模型' : '取得模型清單'}</button></div>
      {provider === 'gemini' || provider === 'mercuryapi' ? <select aria-label="模型選項" className="full-input" value={model} disabled={!!busy} onChange={e => changeModel(e.target.value)}>
        <option value="">請選擇模型</option>{model && !models.some(m => m.id === model) && <option value={model}>自訂：{model}</option>}
        {models.map(m => <option key={m.id} value={m.id}>{m.label} · {m.id}</option>)}
      </select> : <select aria-label="模型選項" className="full-input" value={presets.includes(model) ? model : 'custom'} disabled={!!busy} onChange={e => { changeModel(e.target.value === 'custom' ? '' : e.target.value); if (e.target.value === 'custom') document.getElementById('model-id')?.focus(); }}>
        {presets.map(id => <option key={id} value={id}>{id}</option>)}<option value="custom">自訂模型 ID</option>
      </select>}
      <input id="model-id" list="provider-models" value={model} onChange={e => changeModel(e.target.value.trim())} placeholder="輸入自訂模型 ID，或從取得的清單選擇" autoComplete="off" className="full-input" disabled={!!busy} />
      <datalist id="provider-models">{models.map(m => <option key={m.id} value={m.id}>{m.label} · {m.capability}</option>)}</datalist>
      <p className="field-help">預設選項與模型清單不保證帳戶有權限；請用測試連線確認。計費依你的供應商帳戶。</p>
      <div className="reasoning-field"><label className="field-label" htmlFor="reasoning-effort">推理程度</label>
        <select id="reasoning-effort" className="full-input" value={preferences.reasoningEffort} disabled={provider === 'gemini' || !!busy} onChange={e => pref({ reasoningEffort: e.target.value as ReasoningEffort })} aria-describedby="reasoning-help">{reasoningEfforts.map(effort => <option key={effort} value={effort}>{reasoningLabels[effort]}{effort === 'medium' ? '（預設）' : ''}</option>)}</select>
        <p className="field-help" id="reasoning-help">{provider === 'gemini' ? 'Gemini 使用模型自身的推理預設；此調整適用於 OpenAI、CGU 與 mercuryapi。' : '較高的推理程度可能增加等待時間與用量，實際支援依模型而定。'}</p>
      </div>
      {message && <div role="status" className={`settings-message ${ok ? 'success' : 'error'}`}>{ok ? <Check size={16} /> : <KeyRound size={16} />}<span>{message}</span></div>}
      <div className="data-disclosure"><strong>每次 AI 操作會傳送什麼？</strong><p>翻譯／段落摘要：該便條的文字（無原文時使用筆記），截圖不送交分析。<br />關聯摘要：確認預覽的便條文字與連線屬性。<br />全文摘要：目前 PDF 在本機擷取的分塊文字。<br />測試連線：一則簡短測試文字。{local ? '資料經你電腦上的助手傳給 CGU' : `資料直接傳給 ${providerName(provider)}`}；本站沒有代管伺服器。</p></div>
    </div><footer className="modal-actions"><button className="secondary-button" onClick={() => void test()} disabled={!keyReady || !model || !!busy}>{busy === 'test' ? <LoaderCircle size={15} className="spin" /> : <Wifi size={15} />}測試連線<span className="subtle">（會產生少量用量）</span></button><button className="primary-button" onClick={close}>完成</button></footer>
  </Modal>;
}
