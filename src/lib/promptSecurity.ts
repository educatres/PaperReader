/**
 * Heuristics for content that tries to control the assistant instead of
 * being research material. This is intentionally local and deterministic:
 * source text is never sent to another classifier just to decide whether it
 * is safe to send to the configured provider.
 */
export interface PromptSecurityFinding {
  category: 'instruction_override' | 'identity_change' | 'prompt_extraction' | 'tool_abuse';
}

const compact = (value: string) => value
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
  .toLocaleLowerCase();

const rules: Array<{ category: PromptSecurityFinding['category']; pattern: RegExp }> = [
  {
    category: 'instruction_override',
    pattern: /(?:ignore|disregard|forget|override|bypass|do not follow|stop following)\s+(?:all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+)?(?:system\s+|developer\s+|safety\s+|previous\s+|prior\s+)?instructions?|(?:忽略|無視|不必遵守|不要遵守|忘記|覆寫|繞過|跳過)(?:所有|任何|先前|上面|之前)?(?:的)?(?:指示|指令|規則|限制)/i,
  },
  {
    category: 'identity_change',
    pattern: /(?:you are now|act as|pretend to be|role[- ]?play as|assume the identity of|change your(?: identity| role)|new persona|jailbreak|\bdan\b)|(?:你現在是|改變(?:你的)?身分|更換(?:你的)?身分|切換身分|假裝自己是|扮演(?:成)?|採用新角色|解除限制|越獄)/i,
  },
  {
    category: 'prompt_extraction',
    pattern: /(?:reveal|show|print|provide|repeat| disclose|leak|dump)\s+(?:your\s+|the\s+)?(?:system|developer|hidden|internal)\s+(?:prompt|message|instructions?)|(?:顯示|提供|揭露|複述|重現|印出|洩漏|告訴我)(?:你的|本聊天的|這個聊天的|內部的|隱藏的)?(?:系統提示詞|系統提示|system prompt|開發者訊息|內部指令|隱藏指令)|(?:本聊天|這個 chat|this chat).{0,20}(?:system prompt|系統提示詞|系統提示)/i,
  },
  {
    category: 'tool_abuse',
    pattern: /(?:execute|run|call|invoke)\s+(?:this\s+)?(?:tool|function|command)|(?:執行|呼叫|觸發)(?:這個|該)?(?:工具|函式|指令|命令)|<\/?(?:system|developer|tool|function)>/i,
  },
];

const categoryMessage: Record<PromptSecurityFinding['category'], string> = {
  instruction_override: '試圖覆寫或繞過 AI 指示',
  identity_change: '試圖更換 AI 身分或角色',
  prompt_extraction: '試圖取得系統／開發者提示詞',
  tool_abuse: '試圖要求 AI 執行工具或命令',
};

/** Return a safe, user-facing reason without echoing the untrusted text. */
export function detectPromptInjection(value: unknown): PromptSecurityFinding | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = compact(value);
  for (const rule of rules) if (rule.pattern.test(normalized)) return { category: rule.category };
  return undefined;
}

export function promptSecurityMessage(finding: PromptSecurityFinding) {
  return `已阻止這次 AI 請求：內容${categoryMessage[finding.category]}。來源文字只會作為研究資料，不能更改 AI 身分、取得本聊天的 system prompt 或要求執行工具。請移除這段指令後再試。`;
}

/** Catch an accidental provider response that attempts to disclose its guard. */
export function containsPromptDisclosure(value: unknown) {
  if (typeof value !== 'string') return false;
  const normalized = compact(value);
  return /(?:my|the|here(?:'s| is)\s+(?:my|the))\s+(?:system|developer|hidden|internal)\s+(?:prompt|instructions?)\s*(?:is|:)|(?:我的|以下是|這是)(?:系統提示詞|系統提示|開發者訊息|內部指令)\s*[:：]/i.test(normalized);
}
