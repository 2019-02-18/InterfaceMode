import type { LLMSettings } from './settings';
import type { FindSpec } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AssistantMode = 'operate' | 'chat';

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
input    — 填写文本框（role=textbox）
select   — 选择下拉框（role=combobox，原生 <select>）
goto     — 跳转 URL
api      — 调用站点注册的业务接口（比 DOM 更可靠，优先使用）

## 严格输出格式

先用1-2句话描述计划，然后用以下格式输出操作步骤（代码块名称必须是 tool_calls）：

\`\`\`tool_calls
[
  {"action":"snapshot","explanation":"采集页面"},
  {"action":"click","find":{"textContains":"新建订单"},"explanation":"点击新建订单"},
  {"action":"select","find":{"role":"combobox","textContains":"客户"},"explanation":"选择客户"},
  {"action":"select","find":{"role":"combobox","textContains":"商品"},"selectValue":"","explanation":"选择商品"},
  {"action":"input","find":{"role":"textbox","textContains":"数量"},"inputValue":"2","explanation":"填写数量"},
  {"action":"click","find":{"textContains":"提交订单"},"explanation":"提交订单"}
]
\`\`\`

重要：代码块必须命名为 tool_calls，不能用 json 或其他名称，否则系统无法解析。

## 规则

1. 操作序列必须以 snapshot 开头
2. click / input / select 必须提供 find 或明确 ref；优先用 find.textContains 定位，不猜 ref 数字
3. **role=combobox 的元素必须用 select，禁止用 input 填写；role=textbox 才用 input**
4. 遇到表单字段带 required 或 aria-required="true" 时，必须先填写该字段再提交
5. 页面快照中若元素标记了 [required]，表示必填字段；提交/保存前必须确保这些字段不为空
6. 若执行返回「必填项未填写」，应向用户询问缺失字段应填什么，等用户回复后再补全并继续
7. 有 api 时优先调 api，不读 DOM
8. 高危操作不自动执行，提示用户手动处理
9. 找不到元素时诚实说明，不猜测
10. 禁止输出没有 find/ref 的 click / input / select；例如提交按钮必须写 {"action":"click","find":{"textContains":"提交订单"},"explanation":"提交订单"}
11. 用户消息已匹配站点包 playbook 时，系统会直接按 playbook 执行，你无需重复规划该流程`;

export const CHAT_MODE_SYSTEM = `你是一个网页内「问答模式」AI 助手。

## 职责

回答用户关于当前产品、页面、字段、流程和操作含义的问题。

## 规则

1. 不输出 tool_calls 代码块
2. 不规划点击、填表、跳转等可执行页面操作
3. 如果用户要求你代为操作，提示用户切换到操作模式
4. 可以解释当前站点能力和操作风险
5. 不确定时说明需要更多页面或业务上下文`;

// ── SSE streaming ────────────────────────────────────────────────────────────

export async function* streamChat(
  history: ChatMessage[],
  settings: LLMSettings,
  siteSkills?: string,
  abortSignal?: AbortSignal,
  mode: AssistantMode = 'operate',
): AsyncGenerator<string, void, unknown> {
  const system =
    (mode === 'chat' ? CHAT_MODE_SYSTEM : INTERFACE_MODE_SYSTEM) +
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
