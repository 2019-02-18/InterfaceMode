import type { LLMSettings } from './settings';
import type { FindSpec } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Tool call shape that the LLM outputs (and we parse into ToolCommand) */
export interface ParsedAction {
  action: 'snapshot' | 'click' | 'input' | 'select' | 'goto' | 'api';
  find?: {
    textContains?: string;
    text?: string;
    role?: string;
    tagName?: string;
    selector?: string;
  };
  ref?: number;
  inputValue?: string;
  selectValue?: string;
  navigateUrl?: string;
  apiName?: string;
  apiArgs?: Record<string, unknown>;
  explanation?: string;
}

export function parsedToFindSpec(p: ParsedAction['find']): FindSpec | undefined {
  if (!p) return undefined;
  return {
    textContains: p.textContains,
    text: p.text,
    role: p.role,
    tagName: p.tagName,
    selector: p.selector,
  };
}

// ── System prompt injected for interface mode ───────────────────────────────

export const INTERFACE_MODE_SYSTEM = `你是一个网页「操作模式」AI 助手，可以控制浏览器页面帮用户完成操作。

## 可用工具

snapshot — 采集页面可交互元素（每次操作前必须先调用）
click    — 点击元素（用 find.textContains 按可见文字定位）
input    — 填写输入框
select   — 选择下拉选项
goto     — 跳转 URL
api      — 调用站点注册的业务接口（比 DOM 更可靠，优先使用）

## 严格输出格式

先用1-2句话描述计划，然后用以下格式输出操作步骤（代码块名称必须是 tool_calls）：

\`\`\`tool_calls
[
  {"action":"snapshot","explanation":"采集页面"},
  {"action":"click","find":{"textContains":"新建订单"},"explanation":"点击新建订单"},
  {"action":"input","find":{"role":"textbox","textContains":"客户名称"},"inputValue":"张三","explanation":"填写客户名"}
]
\`\`\`

重要：代码块必须命名为 tool_calls，不能用 json 或其他名称，否则系统无法解析。

## 规则

1. 操作序列必须以 snapshot 开头
2. 用 find.textContains 定位，不猜 ref 数字
3. 有 api 时优先调 api，不读 DOM
4. 高危操作不自动执行，提示用户手动处理
5. 找不到元素时诚实说明，不猜测`;

// ── SSE streaming ────────────────────────────────────────────────────────────

export async function* streamChat(
  history: ChatMessage[],
  settings: LLMSettings,
  siteSkills?: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const system =
    INTERFACE_MODE_SYSTEM +
    (siteSkills ? `\n\n---\n## 当前站点说明\n\n${siteSkills}` : '');

  let resp: Response;
  try {
    resp = await fetch(settings.apiEndpoint, {
      method: 'POST',
      signal: abortSignal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        stream: true,
        messages: [{ role: 'system', content: system }, ...history],
      }),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    yield `❌ 网络错误：${(err as Error).message}`;
    return;
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => resp.statusText);
    yield `❌ API ${resp.status}：${body.slice(0, 200)}`;
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) { yield '❌ 无法读取响应流'; return; }

  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (d === '[DONE]') return;
        try {
          const j = JSON.parse(d);
          const delta = (j.choices?.[0]?.delta?.content ?? '') as string;
          if (delta) yield delta;
        } catch { /* partial JSON */ }
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }
}

// ── Tool call parsing ─────────────────────────────────────────────────────────
// LLMs frequently ignore exact fence names; try multiple formats in priority order.

const PATTERNS = [
  // 1. Our preferred: ```tool_calls
  /```tool_calls\s*([\s\S]*?)```/g,
  // 2. Generic JSON fence containing an array with "action" key
  /```(?:json)?\s*(\[\s*\{[\s\S]*?"action"[\s\S]*?\}[\s\S]*?\])\s*```/g,
  // 3. XML tags
  /<tool_calls>\s*([\s\S]*?)<\/tool_calls>/g,
  // 4. Bare JSON array that starts the line (last resort)
  /^(\[\s*\{"action"[\s\S]*?\])\s*$/m,
];

function tryParse(raw: string): ParsedAction[] | null {
  try {
    const p: unknown = JSON.parse(raw.trim());
    const arr = Array.isArray(p) ? p : [p];
    // Validate that every item has an "action" string field
    if (arr.every((a) => typeof (a as Record<string, unknown>).action === 'string')) {
      return arr as ParsedAction[];
    }
  } catch { /* not valid JSON */ }
  return null;
}

export function parseToolCalls(text: string): ParsedAction[] | null {
  for (const re of PATTERNS) {
    re.lastIndex = 0; // reset for /g patterns
    const m = re.exec(text);
    if (!m) continue;
    const result = tryParse(m[1]);
    if (result) return result;
  }
  return null;
}

export function stripToolCallBlocks(text: string): string {
  let out = text;
  for (const re of PATTERNS.slice(0, 3)) {
    re.lastIndex = 0;
    out = out.replace(re, '');
  }
  // Remove bare trailing JSON arrays too
  out = out.replace(/\[\s*\{"action"[\s\S]*?\]\s*$/, '');
  return out.trim();
}
