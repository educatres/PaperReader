export const cguDocs = 'https://air.cgu.edu.tw/workspace4/LLMAPI/api_call.html';
export const cguKeyPage = 'https://air.cgu.edu.tw/workspace4/LLMAPI/index.php';
export const bridgeEndpoint = 'http://127.0.0.1:43127';
export function normalizeCguKey(value: string) {
  const raw = value.trim(); if (!raw) return '';
  const key = raw.replace(/^Authorization:\s*/i, '').replace(/^Bearer(?:\s+|$)/i, '');
  if (!key || !/^[\x21-\x7e]+$/.test(key)) throw new Error('CGU API key 格式不正確，請只貼上金鑰或 Authorization: Bearer 金鑰，不要包含其他文字。');
  return key;
}
let bridgeToken = '';
export const hasBridgeToken = () => !!bridgeToken;
export function setBridgeToken(value: string) {
  const token = value.trim();
  if (token && !/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error('本機助手連線碼格式不正確，請從助手視窗重新複製。');
  bridgeToken = token;
}
export function bridgeHeaders(): Record<string, string> {
  if (!bridgeToken) throw new Error('請先啟動本機助手，貼上連線碼並按「連接本機助手」。');
  return { 'X-PaperReader-Token': bridgeToken };
}
export async function checkBridge(signal?: AbortSignal) {
  let response: Response;
  try { response = await fetch(`${bridgeEndpoint}/health`, { headers: bridgeHeaders(), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) }); }
  catch (error) {
    if (!hasBridgeToken()) throw error;
    throw new Error('無法連到本機助手。請先啟動助手；若瀏覽器詢問本機網路權限，請允許。');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('此連接埠不是受支援的 PaperReader 本機助手。'); }
  if (!response.ok || !data || data.app !== 'PaperReader CGU Bridge' || data.version !== 1) throw new Error('此連接埠不是受支援的 PaperReader 本機助手。');
  if (data.paired !== true) throw new Error('本機助手連線碼不符，請從目前執行的助手重新複製。');
}
