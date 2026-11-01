export const cguDocs = 'https://air.cgu.edu.tw/workspace4/LLMAPI/api_call.html';
export const cguKeyPage = 'https://air.cgu.edu.tw/workspace4/LLMAPI/index.php';
export const cguModelPresets = ['gemma-4-26b-a4b-it', 'gpt-oss:20b', 'gpt-oss-120b'] as const;
export const defaultCguModel = 'gpt-oss:20b';
export function normalizeCguKey(value: string) {
  const raw = value.trim(); if (!raw) return '';
  const key = raw.replace(/^Authorization:\s*/i, '').replace(/^Bearer(?:\s+|$)/i, '');
  if (!key || !/^[\x21-\x7e]+$/.test(key)) throw new Error('CGU API key 格式不正確，請只貼上金鑰或 Authorization: Bearer 金鑰，不要包含其他文字。');
  return key;
}
