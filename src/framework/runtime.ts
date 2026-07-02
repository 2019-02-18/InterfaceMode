import { marked } from 'marked';
import type { PageSnapshot, SitePack, ToolCommand, ToolResult } from './types';
import { executeCommand } from './executor';
import { planFromUserMessage, formatPackContextForAgent } from './planner';
import { checkCommandPolicy, executeApiCommand } from './policy';
import { formatSnapshotForAgent, takeSnapshot } from './snapshot';
import { parseMissingRequiredFields, formatRequiredFieldQuestion } from './validation';
import { VisualLayer } from './visual';
import {
  type LLMSettings,
  type Provider,
  PROVIDERS,
  isConfigured,
  loadSettings,
  saveSettings,
} from './settings';
import {
  type AssistantMode,
  type ChatMessage,
  type ParsedAction,
  parseToolCalls,
  parsedToFindSpec,
  streamChat,
  stripToolCallBlocks,
} from './transport';
import {
  type PersistedSession,
  type TaskState,
  type TaskStep,
  createTask,
  createTaskStep,
  loadSession,
  saveSession,
  taskStatusLabel,
  touchTask,
} from './task-state';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'info';
  text: string;
  steps?: Array<{ label: string; ok?: boolean; error?: string }>;
  streaming?: boolean;
  /** When set, render an inline "Execute" button below the bubble */
  hasPendingActions?: boolean;
}

/** Execution paused at a failed step — used for recovery actions */
interface PausedExecution {
  execMsg: UIMessage;
  steps: Array<{ label: string; ok?: boolean; error?: string }>;
  stepIndex: number;
  currentCmds: ToolCommand[];
  snap: PageSnapshot;
  globalSnap: PageSnapshot | null;
  turn: number;
  llmResultParts: string[];
  errorMessage: string;
}

export interface InterfaceModeConfig {
  sitePack: SitePack;
  skillsMarkdown?: string;
}

export interface InterfaceModeOpenOptions {
  mode?: AssistantMode;
  message?: string;
  autoSend?: boolean;
}

let _uid = 0;
const uid = () => `im${++_uid}`;

// ── Markdown helpers ──────────────────────────────────────────────────────────

marked.use({
  breaks: true,          // single \n → <br>
  gfm: true,
});

function renderMd(text: string): string {
  if (!text) return '';
  const html = marked.parse(text) as string;
  // Strip only <script> tags for safety; we trust LLM text for other elements
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function isContextLostError(message: string): boolean {
  return message.includes('未找到元素') || message.includes('未在页面中找到');
}

const ICONS = {
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="3"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M9 13h.01"/><path d="M15 13h.01"/><path d="M10 17h4"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  play: '<path d="m6 3 14 9-14 9Z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  cursor: '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51Z"/><path d="m13 13 6 6"/>',
  move: '<path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/><path d="M2 12h20"/><path d="m19 15 3-3-3-3"/><path d="m5 15-3-3 3-3"/>',
} satisfies Record<string, string>;

type IconName = keyof typeof ICONS;

function icon(name: IconName, className = 'im-icon'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

function inferClickFindFromText(text: string | undefined): { textContains: string } | undefined {
  if (!text) return undefined;
  const quoted = text.match(/[「『"']([^」』"']{1,40})[」』"']/);
  if (quoted?.[1]) return { textContains: quoted[1].trim() };

  const knownLabels = [
    '提交订单',
    '新建订单',
    '刷新列表',
    '订单管理',
    '经营概览',
    '门店设置',
    '保存设置',
    '确认',
    '确定',
    '提交',
    '保存',
    '取消',
  ];
  const known = knownLabels.find((label) => text.includes(label));
  if (known) return { textContains: known };

  const compact = text
    .replace(/第\s*\d+\s*步[：:]?/g, '')
    .replace(/等待\s*\d+\s*ms\s*后/g, '')
    .replace(/点击|单击|按下|选择|按钮|链接|菜单项|然后|继续|进行/g, '')
    .trim();
  return compact ? { textContains: compact.slice(0, 24) } : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating Panel Styles (self-contained so the panel works anywhere)
// ─────────────────────────────────────────────────────────────────────────────

const PANEL_CSS = `
:root {
  --im-accent: #2563eb;
  --im-accent-2: #0f766e;
  --im-danger: #dc2626;
  --im-warning: #b45309;
  --im-success: #15803d;
  --im-bg: #ffffff;
  --im-bg2: #f8fafc;
  --im-bg3: #f1f5f9;
  --im-border: #d8dee8;
  --im-text: #111827;
  --im-text2: #64748b;
  --im-radius: 10px;
  --im-shadow: 0 18px 50px rgba(15,23,42,.16), 0 2px 8px rgba(15,23,42,.08);
}
.im-icon {
  width: 16px; height: 16px;
  stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
  fill: none; display: block; flex-shrink: 0;
}

/* ── Launcher ── */
#im-launcher {
  position: fixed; bottom: 24px; right: 24px;
  width: 50px; height: 50px; border-radius: 14px;
  background: #0f172a; color: white;
  box-shadow: 0 10px 28px rgba(15,23,42,.25);
  border: none; outline: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  z-index: 2147483640;
  transition: transform .2s, box-shadow .2s;
  touch-action: none;
}
#im-launcher:hover { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(15,23,42,.3); }
#im-launcher svg { width: 23px; height: 23px; }
#im-launcher .im-notify-dot {
  position: absolute; top: 6px; right: 6px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #f97316; border: 2px solid white;
  display: none;
}
#im-launcher.im-has-notify .im-notify-dot { display: block; }

/* ── Floating panel ── */
#im-float-panel {
  position: fixed; bottom: 84px; right: 24px;
  width: min(400px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 104px));
  max-height: calc(100vh - 32px);
  background: var(--im-bg);
  border-radius: var(--im-radius);
  box-shadow: var(--im-shadow);
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 2147483639;
  transition: opacity .18s, transform .18s;
  transform-origin: bottom right;
  border: 1px solid var(--im-border);
}
#im-float-panel[data-hidden] {
  opacity: 0; transform: scale(.92) translateY(8px);
  pointer-events: none;
}

/* ── Panel header (drag handle) ── */
.im-panel-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px;
  background: #111827;
  cursor: grab; user-select: none; flex-shrink: 0;
  touch-action: none;
}
.im-panel-head:active { cursor: grabbing; }
.im-panel-head-logo {
  width: 28px; height: 28px; border-radius: 8px;
  background: #1f2937; color: #f8fafc;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.im-panel-head-logo svg { width: 16px; height: 16px; }
.im-panel-head-titles { flex: 1; min-width: 0; }
.im-panel-head-name { font-size: 13px; font-weight: 700; color: #f8fafc; line-height: 1.3; }
.im-panel-head-site { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.im-panel-head-actions { display: flex; gap: 4px; flex-shrink: 0; }
.im-head-btn {
  width: 28px; height: 28px; border-radius: 7px;
  background: rgba(255,255,255,.08); border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #94a3b8; font-size: 14px;
  transition: background .15s, color .15s;
}
.im-head-btn:hover { background: rgba(255,255,255,.16); color: #f8fafc; }
.im-head-btn svg { width: 14px; height: 14px; fill: currentColor; }

/* ── Views ── */
.im-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.im-view[data-hidden] { display: none; }

/* ── Chat messages ── */
.im-messages {
  flex: 1; overflow-y: auto; padding: 14px;
  display: flex; flex-direction: column; gap: 12px;
  min-height: 0;
}
.im-messages::-webkit-scrollbar { width: 4px; }
.im-messages::-webkit-scrollbar-track { background: transparent; }
.im-messages::-webkit-scrollbar-thumb { background: var(--im-border); border-radius: 4px; }

.im-msg { display: flex; flex-direction: column; max-width: 88%; gap: 4px; }
.im-msg--user { align-self: flex-end; align-items: flex-end; }
.im-msg--assistant, .im-msg--info { align-self: flex-start; align-items: flex-start; }

.im-msg-bubble {
  padding: 10px 14px; border-radius: 12px;
  font-size: 13.5px; line-height: 1.55; word-break: break-word;
}
.im-msg--user .im-msg-bubble {
  background: var(--im-accent);
  color: white; border-bottom-right-radius: 4px;
}
.im-msg--assistant .im-msg-bubble {
  background: var(--im-bg2); color: var(--im-text);
  border: 1px solid var(--im-border); border-bottom-left-radius: 4px;
}
.im-msg--info .im-msg-bubble {
  background: #f8fafc; color: #334155;
  border: 1px solid var(--im-border); font-size: 12.5px;
  border-radius: 8px;
}

/* steps list inside a message */
.im-steps { margin: 8px 0 0; display: flex; flex-direction: column; gap: 5px; }
.im-step {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12px; color: var(--im-text2);
}
.im-step-icon {
  width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.im-step-icon .im-icon { width: 12px; height: 12px; }
.im-step--ok .im-step-icon { background: #dcfce7; color: var(--im-success); }
.im-step--fail .im-step-icon { background: #fee2e2; color: var(--im-danger); }
.im-step--pending .im-step-icon { background: #e0f2fe; color: var(--im-accent); }
.im-step--running .im-step-icon {
  background: var(--im-accent); color: white;
  animation: im-spin .8s linear infinite;
}
@keyframes im-spin { to { transform: rotate(360deg); } }

/* streaming dot */
.im-typing::after {
  content: '▋'; animation: im-blink .7s step-end infinite;
}
@keyframes im-blink { 50% { opacity: 0; } }

/* ── Mode bar ── */
.im-mode-bar {
  display: flex; gap: 6px; padding: 10px 14px 0;
  flex-shrink: 0;
}
.im-mode-pill {
  padding: 6px 10px; border-radius: 8px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--im-border); background: white;
  color: var(--im-text2); transition: .15s;
  display: inline-flex; align-items: center; gap: 6px;
}
.im-mode-pill.active {
  background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8;
}

/* ── Confirm bar ── */
.im-confirm-bar {
  display: flex; gap: 8px; padding: 10px 14px;
  background: #eff6ff; border-top: 1px solid #bfdbfe;
  flex-shrink: 0;
  align-items: center;
}
.im-confirm-bar[data-hidden] { display: none; }

/* ── Mini task strip (always minimal) ── */
.im-mini-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: var(--im-bg2);
  border-top: 1px solid var(--im-border);
  flex-shrink: 0;
}
.im-mini-bar[data-hidden] { display: none; }
.im-mini-text { font-size: 12px; color: var(--im-text2); flex: 1; line-height: 1.35; }

/* ── Task drawer (right side) ── */
.im-drawer-backdrop {
  position: absolute; inset: 0;
  background: rgba(15,23,42,.35);
  z-index: 2147483641;
}
.im-drawer-backdrop[data-hidden] { display: none; }
.im-drawer {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: min(340px, calc(100% - 56px));
  background: var(--im-bg);
  border-left: 1px solid var(--im-border);
  z-index: 2147483642;
  display: flex; flex-direction: column;
  box-shadow: -10px 0 30px rgba(15,23,42,.16);
}
.im-drawer[data-hidden] { display: none; }
.im-drawer-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 12px;
  border-bottom: 1px solid var(--im-border);
  background: var(--im-bg);
  flex-shrink: 0;
}
.im-drawer-title { font-size: 13px; font-weight: 700; color: var(--im-text); flex: 1; }
.im-drawer-close {
  width: 28px; height: 28px; border-radius: 7px;
  border: 1px solid var(--im-border);
  background: white; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--im-text2);
}
.im-drawer-body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.im-drawer-body::-webkit-scrollbar { width: 4px; }
.im-drawer-body::-webkit-scrollbar-thumb { background: var(--im-border); border-radius: 4px; }

/* ── Task card (compact strip — does not eat chat space) ── */
.im-task-card {
  margin: 0; padding: 8px 12px;
  background: var(--im-bg2); border: 1px solid var(--im-border);
  border-radius: 10px; flex-shrink: 0;
}
.im-task-card[data-hidden] { display: none; }
.im-task-card[data-compact] { padding: 8px 12px; }
.im-task-card[data-compact] .im-task-plan,
.im-task-card[data-compact] .im-task-steps,
.im-task-card[data-compact] .im-task-summary { display: none; }
.im-task-card[data-compact] .im-task-compact-hint { display: block; }
.im-task-card[data-expanded] .im-task-plan,
.im-task-card[data-expanded] .im-task-steps,
.im-task-card[data-expanded] .im-task-summary { display: block; }
.im-task-card[data-expanded] .im-task-compact-hint { display: none; }
.im-task-compact-hint {
  display: none; font-size: 11.5px; color: var(--im-text2);
  margin-top: 4px; line-height: 1.45;
}
.im-task-expand {
  border: none; background: none; padding: 0; margin-left: 6px;
  font-size: 11px; color: var(--im-accent); cursor: pointer; flex-shrink: 0;
}
.im-task-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-bottom: 0;
}
.im-task-card:not([data-compact]) .im-task-head { margin-bottom: 6px; }
.im-task-goal { font-size: 13px; font-weight: 600; color: var(--im-text); flex: 1; }
.im-task-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: #e0f2fe; color: #0369a1; white-space: nowrap;
}
.im-task-badge--running { background: #dbeafe; color: #1d4ed8; }
.im-task-badge--done { background: #dcfce7; color: var(--im-success); }
.im-task-badge--fail { background: #fee2e2; color: var(--im-danger); }
.im-task-badge--wait { background: #fef3c7; color: var(--im-warning); }
.im-task-plan { font-size: 12px; color: var(--im-text2); margin-bottom: 6px; }
.im-task-steps {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 96px; overflow-y: auto;
}
.im-task-step-error {
  font-size: 11px; color: var(--im-danger); margin-left: 24px;
  line-height: 1.35; word-break: break-word;
}
.im-step-error {
  font-size: 11px; color: var(--im-danger); margin-top: 2px; line-height: 1.35;
}
.im-task-step {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 11.5px; color: var(--im-text2);
}
.im-task-summary {
  margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--im-border);
  font-size: 12px; color: var(--im-text);
}
.im-task-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin: 0; padding: 8px 10px;
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px;
  flex-shrink: 0;
}
.im-task-toolbar[data-hidden] { display: none !important; }
.im-task-hint {
  font-size: 11.5px; color: #1e40af; flex: 1 1 100%; line-height: 1.4;
}
.im-task-toolbar .im-btn { flex-shrink: 0; }

/* ── Recovery bar (compact dock above input) ── */
.im-recovery-bar {
  display: flex; flex-wrap: wrap; gap: 5px; padding: 10px;
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;
  flex-shrink: 0; align-items: center;
}
.im-recovery-bar[data-hidden] { display: none; }
.im-recovery-msg {
  font-size: 12px; color: #9a3412; flex: 1 1 100%;
  line-height: 1.4; max-height: 2.8em; overflow: hidden;
}
.im-recovery-actions { display: flex; flex-wrap: wrap; gap: 5px; width: 100%; }

/* ── Status bar ── */
.im-status-bar {
  padding: 7px 14px; font-size: 12px; color: var(--im-text2);
  background: var(--im-bg2); border-top: 1px solid var(--im-border);
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
}
.im-status-bar[data-hidden] { display: none; }
.im-status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #10b981; flex-shrink: 0;
}
.im-status-dot.im-status-dot--busy {
  background: var(--im-accent);
  animation: im-pulse-dot 1s ease-in-out infinite;
}
@keyframes im-pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: .5; transform: scale(.8); }
}

/* ── Input area ── */
.im-input-wrap {
  border-top: 1px solid var(--im-border); padding: 10px 14px;
  display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
}
.im-textarea {
  width: 100%; resize: none;
  border: 1.5px solid var(--im-border); border-radius: 10px;
  padding: 9px 12px; font-size: 13.5px;
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.5; outline: none; background: var(--im-bg2);
  color: var(--im-text); transition: border-color .15s;
  box-sizing: border-box;
}
.im-textarea:focus { border-color: var(--im-accent); background: white; }
.im-textarea::placeholder { color: #94a3b8; }
.im-input-row {
  display: flex; align-items: center; justify-content: space-between;
}
.im-send-btn {
  background: var(--im-accent);
  color: white; border: none; border-radius: 8px;
  padding: 7px 12px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: opacity .15s;
  display: inline-flex; align-items: center; gap: 6px;
}
.im-send-btn:hover { opacity: .88; }
.im-send-btn:disabled { opacity: .45; cursor: default; }

/* ── Buttons ── */
.im-btn {
  padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1.5px solid var(--im-border);
  background: white; color: var(--im-text); transition: .15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.im-btn:hover { background: var(--im-bg2); }
.im-btn--primary { background: var(--im-accent); color: white; border-color: var(--im-accent); }
.im-btn--primary:hover { opacity: .88; background: var(--im-accent); }
.im-btn--danger { background: white; color: var(--im-danger); border-color: #fca5a5; }
.im-btn--danger:hover { background: #fee2e2; }
.im-btn-sm { padding: 4px 10px; font-size: 12px; }

/* ── Settings view ── */
.im-settings {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 16px; min-height: 0;
}
.im-settings-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700; color: var(--im-text);
  padding-bottom: 8px; border-bottom: 1px solid var(--im-border);
}
.im-settings-head svg { width: 18px; height: 18px; color: var(--im-accent); }
.im-field { display: flex; flex-direction: column; gap: 5px; }
.im-field label { font-size: 12px; font-weight: 600; color: var(--im-text2); letter-spacing: .03em; text-transform: uppercase; }
.im-field input, .im-field select {
  border: 1.5px solid var(--im-border); border-radius: 8px;
  padding: 8px 12px; font-size: 13.5px; outline: none;
  font-family: inherit; color: var(--im-text); background: var(--im-bg2);
  transition: border-color .15s; width: 100%; box-sizing: border-box;
}
.im-field input:focus, .im-field select:focus { border-color: var(--im-accent); background: white; }
.im-field input[type=password] { letter-spacing: .05em; }
.im-field-hint { font-size: 11.5px; color: var(--im-text2); }
.im-settings-save {
  width: 100%; padding: 10px; border-radius: 10px;
  background: var(--im-accent);
  color: white; border: none; font-size: 14px; font-weight: 700;
  cursor: pointer; transition: opacity .15s; margin-top: 4px;
}
.im-settings-save:hover { opacity: .88; }
.im-settings-status {
  padding: 10px 12px; border-radius: 8px; font-size: 12.5px;
  display: flex; align-items: center; gap: 8px;
}
.im-settings-status.ok { background: #dcfce7; color: #166534; }
.im-settings-status.warn { background: #fffbeb; color: #92400e; }

/* ── No-API-key notice ── */
.im-no-key-banner {
  margin: 0 14px 10px; padding: 10px 12px;
  background: #fffbeb; border: 1px solid #fde68a;
  border-radius: 8px; font-size: 12.5px; color: #92400e;
  display: flex; align-items: center; gap: 8px;
  cursor: pointer; text-decoration: none;
}
.im-no-key-banner:hover { background: #fef3c7; }
.im-no-key-banner[data-hidden] { display: none; }

/* ── Stop button (shown during execution) ── */
#im-stop-btn {
  background: var(--im-danger); color: white; border: none; border-radius: 8px;
  padding: 7px 12px; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: opacity .15s;
  display: none;
  align-items: center; gap: 6px;
}
#im-stop-btn.visible { display: inline-flex; }
#im-stop-btn:hover { opacity: .85; }

/* ── Inline action bar (below assistant plan message) ── */
.im-msg-actions {
  display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;
}
.im-msg-actions .im-btn { font-size: 12px; padding: 5px 14px; }

/* ── Markdown inside chat bubbles ── */
.im-md { line-height: 1.6; word-break: break-word; }
.im-md p { margin: 0 0 8px; }
.im-md p:last-child { margin-bottom: 0; }
.im-md h1, .im-md h2 { font-size: 14px; font-weight: 700; margin: 10px 0 4px; }
.im-md h3, .im-md h4 { font-size: 13px; font-weight: 700; margin: 8px 0 3px; }
.im-md strong { font-weight: 700; }
.im-md em { font-style: italic; opacity: .9; }
.im-md code {
  font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: 12px; padding: 1px 5px; border-radius: 4px;
  background: rgba(0,0,0,.07);
}
.im-msg--user .im-md code { background: rgba(255,255,255,.2); }
.im-md pre {
  background: #1e293b; color: #e2e8f0; border-radius: 8px;
  padding: 10px 12px; overflow-x: auto; margin: 6px 0;
  font-size: 12px; line-height: 1.5;
}
.im-md pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
.im-md ul, .im-md ol { margin: 4px 0 6px 18px; padding: 0; }
.im-md li { margin: 2px 0; font-size: 13px; }
.im-md blockquote {
  border-left: 3px solid var(--im-accent); margin: 6px 0;
  padding: 4px 10px; opacity: .8; font-style: italic;
}
.im-md table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0; }
.im-md th, .im-md td { border: 1px solid var(--im-border); padding: 4px 8px; text-align: left; }
.im-md th { background: var(--im-bg2); font-weight: 600; }
.im-md a { color: var(--im-accent); text-decoration: underline; }
.im-msg--user .im-md a { color: #bfdbfe; }
.im-md hr { border: none; border-top: 1px solid var(--im-border); margin: 8px 0; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────

export class InterfaceModeRuntime {
  private pack: SitePack;
  private skills: string | undefined;
  private visual = new VisualLayer();
  private settings: LLMSettings;
  private llmHistory: ChatMessage[] = [];

  private launcher!: HTMLButtonElement;
  private panel!: HTMLDivElement;
  private msgList!: HTMLDivElement;
  private textarea!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private confirmBar!: HTMLDivElement;
  private recoveryBar!: HTMLDivElement;
  private taskCard!: HTMLDivElement;
  private taskDrawer!: HTMLDivElement;
  private taskDrawerBackdrop!: HTMLDivElement;
  private miniBar!: HTMLDivElement;
  private miniText!: HTMLSpanElement;
  private miniPrimary!: HTMLButtonElement;
  private miniOpen!: HTMLButtonElement;
  private taskCardExpanded = false;
  private statusBar!: HTMLDivElement;
  private statusDot!: HTMLDivElement;
  private statusText!: HTMLSpanElement;
  private noKeyBanner!: HTMLAnchorElement;

  private viewChat!: HTMLDivElement;
  private viewSettings!: HTMLDivElement;
  private modePills!: NodeListOf<HTMLButtonElement>;

  private uiMessages: UIMessage[] = [];
  private pendingCmds: ToolCommand[] | null = null;
  private activeTask: TaskState | null = null;
  private pausedExecution: PausedExecution | null = null;
  private busy = false;
  private stopRequested = false;
  private panelOpen = false;
  private mode: AssistantMode = 'operate';
  private abortCtrl: AbortController | null = null;

  // drag state
  private dragging: 'panel' | 'launcher' | null = null;
  private dragStart = { x: 0, y: 0, px: 0, py: 0 };
  private dragMoved = false;
  private launcherSuppressClick = false;
  private readonly panelPositionKey: string;
  private readonly launcherPositionKey: string;
  private hostEventAbort = new AbortController();

  constructor(config: InterfaceModeConfig) {
    this.pack = config.sitePack;
    this.skills = config.skillsMarkdown;
    this.panelPositionKey = `im:${this.pack.siteId}:panel-position`;
    this.launcherPositionKey = `im:${this.pack.siteId}:launcher-position`;
    this.settings = loadSettings();
    this.visual.mount();
    this.applyTheme();
    this.buildUI();
    this.bindEvents();
    this.installHostApi();
    this.restoreSession();
    this.pushInfo(`已加载站点包「${this.pack.name}」v${this.pack.version}\n${isConfigured(this.settings) ? `AI: ${this.settings.model}` : '未配置 API Key，当前使用本地演示规划器'}`);
    this.updateNoKeyBanner();
    this.restorePositions();
    window.addEventListener('beforeunload', () => {
      if (this.activeTask?.status === 'running') {
        this.activeTask = this.markTaskInterrupted(this.activeTask);
      }
      this.persistSession();
    }, { signal: this.hostEventAbort.signal });
  }

  // ── UI construction ────────────────────────────────────────────────────────

  private buildUI(): void {
    // Inject styles
    if (!document.getElementById('im-panel-css')) {
      const s = document.createElement('style');
      s.id = 'im-panel-css';
      s.textContent = PANEL_CSS;
      document.head.appendChild(s);
    }

    // Launcher button
    const launcher = document.createElement('button');
    launcher.id = 'im-launcher';
    launcher.setAttribute('data-im-overlay', 'true');
    launcher.setAttribute('aria-label', '打开 InterfaceMode 助手');
    launcher.innerHTML = `
      ${icon('bot')}
      <div class="im-notify-dot"></div>`;
    document.body.appendChild(launcher);
    this.launcher = launcher;

    // Main panel
    const panel = document.createElement('div');
    panel.id = 'im-float-panel';
    panel.setAttribute('data-im-overlay', 'true');
    panel.setAttribute('data-hidden', '');
    panel.innerHTML = `
      <!-- Header / drag handle -->
      <div class="im-panel-head" id="im-panel-head">
        <div class="im-panel-head-logo">
          ${icon('bot')}
        </div>
        <div class="im-panel-head-titles">
          <div class="im-panel-head-name">InterfaceMode</div>
          <div class="im-panel-head-site">${this.pack.name}</div>
        </div>
        <div class="im-panel-head-actions">
          <button class="im-head-btn" id="im-btn-task" title="任务" aria-label="任务">
            ${icon('cursor')}
          </button>
          <button class="im-head-btn" id="im-btn-settings" title="设置" aria-label="设置">
            ${icon('settings')}
          </button>
          <button class="im-head-btn" id="im-btn-close" title="关闭" aria-label="关闭">
            ${icon('close')}
          </button>
        </div>
      </div>

      <!-- Chat view -->
      <div class="im-view" id="im-view-chat">
        <a class="im-no-key-banner" id="im-no-key-banner" href="#" tabindex="0">
          ${icon('alert')}<span>未配置 AI API Key，当前使用本地演示规划器。点此配置</span>
        </a>
        <div class="im-messages" id="im-messages"></div>
        <div class="im-mini-bar" id="im-mini-bar" data-hidden="">
          <span class="im-mini-text" id="im-mini-text"></span>
          <button class="im-btn im-btn-sm" id="im-mini-open">${icon('cursor')}任务</button>
          <button class="im-btn im-btn--primary im-btn-sm" id="im-mini-primary">${icon('play')}继续</button>
        </div>
        <div class="im-status-bar" id="im-status-bar" data-hidden="">
          <div class="im-status-dot" id="im-status-dot"></div>
          <span id="im-status-text">就绪</span>
        </div>
        <div class="im-mode-bar">
          <button class="im-mode-pill active" data-mode="operate">${icon('cursor')}操作模式</button>
          <button class="im-mode-pill" data-mode="chat">${icon('message')}问答模式</button>
        </div>
        <div class="im-input-wrap">
          <textarea class="im-textarea" id="im-textarea" rows="2" placeholder="描述你想完成的操作，例如：查看今日营收"></textarea>
          <div class="im-input-row">
            <span style="font-size:11.5px;color:#94a3b8">Enter 发送，Shift+Enter 换行</span>
            <div style="display:flex;gap:6px;align-items:center">
              <button id="im-stop-btn" title="停止执行" aria-label="停止执行">${icon('stop')}停止</button>
              <button class="im-send-btn" id="im-send-btn">${icon('send')}发送</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Task drawer -->
      <div class="im-drawer-backdrop" id="im-task-drawer-backdrop" data-hidden=""></div>
      <aside class="im-drawer" id="im-task-drawer" data-hidden="">
        <div class="im-drawer-head">
          <div class="im-drawer-title">任务</div>
          <button class="im-drawer-close" id="im-task-drawer-close" aria-label="关闭任务面板">${icon('close')}</button>
        </div>
        <div class="im-drawer-body">
          <div class="im-task-card" id="im-task-card" data-hidden="">
            <div class="im-task-head">
              <div class="im-task-goal" id="im-task-goal"></div>
              <button type="button" class="im-task-expand" id="im-task-expand" data-hidden="">展开步骤</button>
              <span class="im-task-badge" id="im-task-badge"></span>
            </div>
            <div class="im-task-compact-hint" id="im-task-compact-hint"></div>
            <div class="im-task-plan" id="im-task-plan" data-hidden=""></div>
            <div class="im-task-steps" id="im-task-steps"></div>
            <div class="im-task-summary" id="im-task-summary" data-hidden=""></div>
          </div>
          <div class="im-task-toolbar" id="im-task-toolbar" data-hidden="">
            <div class="im-task-hint" id="im-task-hint"></div>
            <button class="im-btn im-btn--primary im-btn-sm" id="im-task-continue">${icon('play')}继续执行</button>
            <button class="im-btn im-btn-sm" id="im-task-abandon">${icon('x')}放弃任务</button>
          </div>
          <div class="im-confirm-bar" id="im-confirm-bar" data-hidden="">
            ${icon('cursor')}<span style="font-size:13px;color:#1d4ed8;flex:1">AI 已规划操作步骤，是否执行？</span>
            <button class="im-btn im-btn--primary im-btn-sm" id="im-confirm-btn">${icon('play')}帮我操作</button>
            <button class="im-btn im-btn-sm" id="im-cancel-btn">${icon('x')}取消</button>
          </div>
          <div class="im-recovery-bar" id="im-recovery-bar" data-hidden="">
            <div class="im-recovery-msg" id="im-recovery-msg">步骤执行失败</div>
            <div class="im-recovery-actions">
              <button class="im-btn im-btn--primary im-btn-sm" id="im-recovery-replan">${icon('cursor')}重新规划</button>
              <button class="im-btn im-btn-sm" id="im-recovery-retry">${icon('play')}重试</button>
              <button class="im-btn im-btn-sm" id="im-recovery-resnapshot">${icon('info')}重新采集</button>
              <button class="im-btn im-btn-sm" id="im-recovery-skip">${icon('x')}跳过</button>
              <button class="im-btn im-btn-sm" id="im-recovery-handoff">${icon('move')}手动接管</button>
              <button class="im-btn im-btn-sm" id="im-recovery-debug">调试</button>
            </div>
          </div>
        </div>
      </aside>

      <!-- Settings view -->
      <div class="im-view" id="im-view-settings" data-hidden="">
        <div class="im-settings" id="im-settings-form">
          <div class="im-settings-head">
            ${icon('settings')}
            AI 接口配置
          </div>
          <div class="im-settings-status" id="im-settings-status"></div>
          <div class="im-field">
            <label>服务商</label>
            <select id="im-provider-select">
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">通义千问 (Qwen)</option>
              <option value="openai">OpenAI / 兼容接口</option>
              <option value="custom">自定义端点</option>
            </select>
          </div>
          <div class="im-field">
            <label>API 端点</label>
            <input type="text" id="im-endpoint-input" placeholder="https://api.deepseek.com/v1/chat/completions"/>
            <div class="im-field-hint" id="im-endpoint-hint"></div>
          </div>
          <div class="im-field">
            <label>API Key</label>
            <input type="password" id="im-key-input" placeholder="sk-..."/>
          </div>
          <div class="im-field">
            <label>模型</label>
            <select id="im-model-select"><option value="">请先选择服务商</option></select>
          </div>
          <button class="im-settings-save" id="im-save-btn">保存设置</button>
          <button class="im-btn" id="im-back-btn" style="width:100%">${icon('message')}返回对话</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.panel = panel;

    // Cache refs
    this.msgList = panel.querySelector('#im-messages')!;
    this.textarea = panel.querySelector('#im-textarea')!;
    this.sendBtn = panel.querySelector('#im-send-btn')!;
    this.confirmBar = panel.querySelector('#im-confirm-bar')!;
    this.recoveryBar = panel.querySelector('#im-recovery-bar')!;
    this.taskCard = panel.querySelector('#im-task-card')!;
    this.taskDrawer = panel.querySelector('#im-task-drawer')!;
    this.taskDrawerBackdrop = panel.querySelector('#im-task-drawer-backdrop')!;
    this.miniBar = panel.querySelector('#im-mini-bar')!;
    this.miniText = panel.querySelector('#im-mini-text')!;
    this.miniPrimary = panel.querySelector('#im-mini-primary')!;
    this.miniOpen = panel.querySelector('#im-mini-open')!;
    this.statusBar = panel.querySelector('#im-status-bar')!;
    this.statusDot = panel.querySelector('#im-status-dot')!;
    this.statusText = panel.querySelector('#im-status-text')!;
    this.noKeyBanner = panel.querySelector('#im-no-key-banner')!;
    this.viewChat = panel.querySelector('#im-view-chat')!;
    this.viewSettings = panel.querySelector('#im-view-settings')!;
    this.modePills = panel.querySelectorAll<HTMLButtonElement>('.im-mode-pill');

    // Pre-fill settings form
    this.fillSettingsForm();
    this.updateModeUI();
  }

  private bindEvents(): void {
    // Launcher toggle
    this.launcher.addEventListener('click', () => {
      if (this.launcherSuppressClick) {
        this.launcherSuppressClick = false;
        return;
      }
      this.togglePanel();
    });
    this.launcher.addEventListener('pointerdown', (e) => this.startDrag(e, 'launcher'));

    // Close
    this.panel.querySelector('#im-btn-close')!.addEventListener('click', () => this.togglePanel(false));
    // Task drawer open/close
    this.panel.querySelector('#im-btn-task')!.addEventListener('click', () => this.openTaskDrawer(true));
    this.panel.querySelector('#im-task-drawer-close')!.addEventListener('click', () => this.openTaskDrawer(false));
    this.taskDrawerBackdrop.addEventListener('click', () => this.openTaskDrawer(false));

    // Settings
    this.panel.querySelector('#im-btn-settings')!.addEventListener('click', () => this.showView('settings'));
    this.panel.querySelector('#im-back-btn')!.addEventListener('click', () => this.showView('chat'));
    this.noKeyBanner.addEventListener('click', (e) => { e.preventDefault(); this.showView('settings'); });

    // Send
    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleSend(); }
    });

    // Confirm / cancel
    this.panel.querySelector('#im-confirm-btn')!.addEventListener('click', () => this.confirmExecute());
    this.panel.querySelector('#im-cancel-btn')!.addEventListener('click', () => this.cancelPending());

    // Mini bar
    this.miniOpen.addEventListener('click', () => this.openTaskDrawer(true));
    this.miniPrimary.addEventListener('click', () => void this.handleMiniPrimary());

    // Task primary / secondary actions
    this.panel.querySelector('#im-task-continue')!.addEventListener('click', () => void this.handleTaskPrimary());
    this.panel.querySelector('#im-task-abandon')!.addEventListener('click', () => this.handleTaskSecondary());
    this.panel.querySelector('#im-task-expand')!.addEventListener('click', () => {
      this.taskCardExpanded = !this.taskCardExpanded;
      this.renderTaskCard();
    });

    // Recovery actions
    this.panel.querySelector('#im-recovery-replan')!.addEventListener('click', () => void this.handleRecoveryReplan());
    this.panel.querySelector('#im-recovery-retry')!.addEventListener('click', () => void this.handleRecovery('retry'));
    this.panel.querySelector('#im-recovery-resnapshot')!.addEventListener('click', () => void this.handleRecovery('resnapshot'));
    this.panel.querySelector('#im-recovery-skip')!.addEventListener('click', () => void this.handleRecovery('skip'));
    this.panel.querySelector('#im-recovery-handoff')!.addEventListener('click', () => void this.handleRecovery('handoff'));
    this.panel.querySelector('#im-recovery-debug')!.addEventListener('click', () => this.handleRecoveryDebug());

    // Stop execution
    this.panel.querySelector('#im-stop-btn')!.addEventListener('click', () => this.requestStop());

    // Mode pills
    this.modePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const mode = pill.dataset.mode === 'chat' ? 'chat' : 'operate';
        this.setMode(mode);
      });
    });

    // Settings form: provider change
    const providerSel = this.panel.querySelector<HTMLSelectElement>('#im-provider-select')!;
    providerSel.addEventListener('change', () => this.onProviderChange());

    // Settings save
    this.panel.querySelector('#im-save-btn')!.addEventListener('click', () => this.saveSettingsFromForm());

    // Drag
    const head = this.panel.querySelector<HTMLDivElement>('#im-panel-head')!;
    head.addEventListener('pointerdown', (e) => this.startDrag(e, 'panel'));
    document.addEventListener('pointermove', (e) => this.onDrag(e));
    document.addEventListener('pointerup', () => this.endDrag());
  }

  // ── Panel visibility ───────────────────────────────────────────────────────

  private togglePanel(open?: boolean): void {
    this.panelOpen = open ?? !this.panelOpen;
    if (this.panelOpen) {
      this.panel.removeAttribute('data-hidden');
      this.launcher.classList.remove('im-has-notify');
      this.textarea.focus();
    } else {
      this.panel.setAttribute('data-hidden', '');
    }
  }

  open(options: InterfaceModeOpenOptions = {}): void {
    if (options.mode) this.setMode(options.mode);
    this.togglePanel(true);
    this.showView('chat');
    if (options.message !== undefined) {
      if (options.autoSend) {
        void this.ask(options.message, { mode: options.mode });
      } else {
        this.textarea.value = options.message;
        this.textarea.focus();
      }
    }
  }

  close(): void {
    this.togglePanel(false);
  }

  toggle(open?: boolean): void {
    this.togglePanel(open);
  }

  setMode(mode: AssistantMode): void {
    this.mode = mode;
    this.updateModeUI();
  }

  async ask(text: string, options: { mode?: AssistantMode } = {}): Promise<void> {
    const value = text.trim();
    if (!value || this.busy) return;
    if (options.mode) this.setMode(options.mode);
    this.open({ mode: this.mode });
    this.textarea.value = '';
    this.pushMsg('user', value);
    await this.processUserMessage(value);
  }

  async startTask(text: string): Promise<void> {
    await this.ask(text, { mode: 'operate' });
  }

  continueTask(taskId?: string): void {
    this.open({ mode: 'operate' });
    const session = loadSession(this.pack.siteId);
    if (session?.task && (!taskId || session.task.id === taskId)) {
      this.activeTask = session.task;
      this.llmHistory = session.llmHistory ?? [];
      this.applyRestoredTask(session.task);
      if (this.activeTask?.status === 'interrupted') {
        void this.resumeTask();
        return;
      }
      this.pushInfo(`已恢复任务「${session.task.goal}」`);
      return;
    }
    this.pushInfo(taskId ? `未找到任务 ${taskId}` : '已打开助手，可继续当前工作。');
  }

  private applyRestoredTask(task: TaskState): void {
    if (task.status === 'running') {
      this.activeTask = this.markTaskInterrupted(task);
    } else if (
      task.status === 'cancelled'
      && task.steps.length > 0
      && task.steps.some((s) => s.status === 'pending' || s.status === 'failed' || s.status === 'running')
    ) {
      this.activeTask = touchTask(task, { status: 'interrupted', summary: undefined });
    }
    if (this.activeTask?.status === 'waiting_confirm' && this.activeTask.pendingCommands?.length) {
      this.pendingCmds = this.activeTask.pendingCommands;
      this.confirmBar.removeAttribute('data-hidden');
      this.launcher.classList.add('im-has-notify');
    }
    if (this.activeTask?.status === 'waiting_recovery') {
      this.ensurePausedExecution();
      this.recoveryBar.removeAttribute('data-hidden');
      const recovery = this.activeTask.recovery;
      const msg = recovery?.contextLost
        ? `「${this.activeTask.steps[recovery.failedStepIndex]?.label ?? '当前步骤'}」失败：目标可能不在当前页面。请打开对应弹窗后重试，或点「重新规划」。`
        : recovery?.errorMessage ?? '步骤执行失败，请选择恢复方式';
      this.panel.querySelector('#im-recovery-msg')!.textContent = truncateText(msg, 160);
      this.launcher.classList.add('im-has-notify');
    }
    if (this.canResumeTask(this.activeTask)) {
      this.launcher.classList.add('im-has-notify');
    }
    this.renderTaskCard();
  }

  private showView(v: 'chat' | 'settings'): void {
    if (v === 'chat') {
      this.viewChat.removeAttribute('data-hidden');
      this.viewSettings.setAttribute('data-hidden', '');
    } else {
      this.viewSettings.removeAttribute('data-hidden');
      this.viewChat.setAttribute('data-hidden', '');
    }
  }

  private updateModeUI(): void {
    this.modePills?.forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.mode === this.mode);
      pill.setAttribute('aria-pressed', String(pill.dataset.mode === this.mode));
    });
    this.textarea.placeholder = this.mode === 'operate'
      ? '描述你想完成的操作，例如：查看今日营收'
      : '询问当前页面、字段或流程含义';
    if (this.mode === 'chat') {
      this.confirmBar.setAttribute('data-hidden', '');
    }
  }

  private installHostApi(): void {
    const api = {
      runtime: this,
      open: (options?: InterfaceModeOpenOptions) => this.open(options),
      close: () => this.close(),
      toggle: (open?: boolean) => this.toggle(open),
      setMode: (mode: AssistantMode) => this.setMode(mode),
      ask: (text: string, options?: { mode?: AssistantMode }) => this.ask(text, options),
      startTask: (text: string) => this.startTask(text),
      continueTask: (taskId?: string) => this.continueTask(taskId),
      resumeTask: () => this.resumeTask(),
    };
    const w = window as typeof window & { InterfaceModeAssistant?: typeof api };
    w.InterfaceModeAssistant = api;
    window.addEventListener('interfacemode:open', (event) => {
      const detail = (event as CustomEvent<InterfaceModeOpenOptions>).detail ?? {};
      this.open(detail);
    }, { signal: this.hostEventAbort.signal });
    window.addEventListener('interfacemode:ask', (event) => {
      const detail = (event as CustomEvent<InterfaceModeOpenOptions>).detail ?? {};
      if (detail.message) void this.ask(detail.message, { mode: detail.mode });
    }, { signal: this.hostEventAbort.signal });
  }

  // ── Drag ──────────────────────────────────────────────────────────────────

  private startDrag(e: PointerEvent, target: 'panel' | 'launcher'): void {
    if (target === 'panel' && (e.target as HTMLElement).closest('button')) return;
    this.dragging = target;
    this.dragMoved = false;
    const el = target === 'panel' ? this.panel : this.launcher;
    const r = el.getBoundingClientRect();
    this.dragStart = { x: e.clientX, y: e.clientY, px: r.left, py: r.top };
    el.style.transition = 'none';
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }
  private onDrag(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) this.dragMoved = true;
    const el = this.dragging === 'panel' ? this.panel : this.launcher;
    const next = this.clampPosition(el, this.dragStart.px + dx, this.dragStart.py + dy);
    el.style.left = `${next.left}px`;
    el.style.top = `${next.top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
  private endDrag(): void {
    if (!this.dragging) return;
    const target = this.dragging;
    const el = target === 'panel' ? this.panel : this.launcher;
    this.dragging = null;
    el.style.transition = '';
    if (target === 'launcher' && this.dragMoved) this.launcherSuppressClick = true;
    this.savePosition(target, el);
  }

  private clampPosition(el: HTMLElement, left: number, top: number): { left: number; top: number } {
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  private savePosition(target: 'panel' | 'launcher', el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const key = target === 'panel' ? this.panelPositionKey : this.launcherPositionKey;
    localStorage.setItem(key, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  private restorePositions(): void {
    this.restorePosition('panel', this.panel, this.panelPositionKey);
    this.restorePosition('launcher', this.launcher, this.launcherPositionKey);
  }

  private restorePosition(_target: 'panel' | 'launcher', el: HTMLElement, key: string): void {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const value = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof value.left !== 'number' || typeof value.top !== 'number') return;
      const next = this.clampPosition(el, value.left, value.top);
      el.style.left = `${next.left}px`;
      el.style.top = `${next.top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    } catch {
      localStorage.removeItem(key);
    }
  }

  // ── Theme / session / task view ───────────────────────────────────────────

  private applyTheme(): void {
    const theme = this.pack.theme;
    if (!theme) return;
    const root = document.documentElement;
    if (theme.accent) root.style.setProperty('--im-accent', theme.accent);
    if (theme.accent2) root.style.setProperty('--im-accent-2', theme.accent2);
    if (theme.danger) root.style.setProperty('--im-danger', theme.danger);
    if (theme.warning) root.style.setProperty('--im-warning', theme.warning);
    if (theme.success) root.style.setProperty('--im-success', theme.success);
  }

  private persistSession(): void {
    const session: PersistedSession = {
      task: this.activeTask,
      llmHistory: this.llmHistory,
      mode: this.mode,
    };
    saveSession(this.pack.siteId, session);
  }

  private restoreSession(): void {
    const session = loadSession(this.pack.siteId);
    if (!session) return;
    if (session.llmHistory?.length) this.llmHistory = session.llmHistory;
    if (session.mode) this.mode = session.mode;
    if (!session.task) return;

    this.activeTask = session.task;
    this.applyRestoredTask(session.task);
    this.updateModeUI();
  }

  private openTaskDrawer(open: boolean): void {
    if (open) {
      this.taskDrawer.removeAttribute('data-hidden');
      this.taskDrawerBackdrop.removeAttribute('data-hidden');
      this.taskDrawer.setAttribute('aria-hidden', 'false');
    } else {
      this.taskDrawer.setAttribute('data-hidden', '');
      this.taskDrawerBackdrop.setAttribute('data-hidden', '');
      this.taskDrawer.setAttribute('aria-hidden', 'true');
    }
  }

  private updateMiniBar(): void {
    const task = this.activeTask;
    if (!task) {
      this.miniBar.setAttribute('data-hidden', '');
      return;
    }
    // always show minimal strip when there's an active task
    this.miniBar.removeAttribute('data-hidden');

    const status = taskStatusLabel(task.status);
    const base = `${status}：${task.goal}`;
    this.miniText.textContent = truncateText(base, 64);

    // Primary button behavior
    if (task.status === 'waiting_confirm') {
      this.miniPrimary.removeAttribute('data-hidden');
      this.miniPrimary.innerHTML = `${icon('play')}执行`;
      this.miniPrimary.disabled = false;
    } else if (task.status === 'interrupted') {
      this.miniPrimary.removeAttribute('data-hidden');
      this.miniPrimary.innerHTML = `${icon('play')}继续`;
      this.miniPrimary.disabled = false;
    } else if (task.status === 'waiting_recovery') {
      this.miniPrimary.removeAttribute('data-hidden');
      this.miniPrimary.innerHTML = `${icon('alert')}处理`;
      this.miniPrimary.disabled = false;
    } else if (task.status === 'completed') {
      this.miniPrimary.removeAttribute('data-hidden');
      this.miniPrimary.innerHTML = `${icon('message')}查看`;
      this.miniPrimary.disabled = false;
    } else {
      // planning/running/failed/cancelled: open drawer only
      this.miniPrimary.setAttribute('data-hidden', '');
    }
  }

  private async handleMiniPrimary(): Promise<void> {
    const task = this.activeTask;
    if (!task) return;
    if (task.status === 'waiting_confirm' && task.pendingCommands?.length) {
      this.pendingCmds = task.pendingCommands;
      this.confirmExecute();
      this.openTaskDrawer(false);
      return;
    }
    if (task.status === 'interrupted') {
      await this.resumeTask();
      this.openTaskDrawer(false);
      return;
    }
    // recovery/completed/others: open drawer to inspect
    this.openTaskDrawer(true);
  }

  private markTaskInterrupted(task: TaskState): TaskState {
    const steps = task.steps.map((step) => ({
      ...step,
      status: step.status === 'running' ? 'pending' as const : step.status,
    }));
    const fromIndex = steps.findIndex((s) => s.status === 'pending' || s.status === 'failed');
    return touchTask(task, {
      status: 'interrupted',
      steps,
      currentStepIndex: fromIndex >= 0 ? fromIndex : task.currentStepIndex,
    });
  }

  private canResumeTask(task: TaskState | null): boolean {
    if (!task) return false;
    if (task.status === 'waiting_confirm' && task.pendingCommands?.length) return true;
    if (task.status === 'interrupted') return true;
    if (task.status === 'waiting_recovery') return true;
    return false;
  }

  private clearTaskView(): void {
    this.pendingCmds = null;
    this.pausedExecution = null;
    this.confirmBar.setAttribute('data-hidden', '');
    this.hideRecovery();
    this.activeTask = null;
    this.taskCardExpanded = false;
    this.renderTaskCard();
    this.persistSession();
    this.pushInfo('已清除任务视图。');
  }

  private async handleTaskPrimary(): Promise<void> {
    const task = this.activeTask;
    if (!task) return;
    // Completed: primary is "view steps" toggle
    if (task.status === 'completed') {
      this.taskCardExpanded = !this.taskCardExpanded;
      this.renderTaskCard();
      return;
    }
    await this.resumeTask();
  }

  private handleTaskSecondary(): void {
    const task = this.activeTask;
    if (!task) return;
    // Completed: secondary is "clear"
    if (task.status === 'completed') {
      this.clearTaskView();
      return;
    }
    this.abandonTask();
  }

  private abandonTask(): void {
    if (!this.activeTask) return;
    this.pendingCmds = null;
    this.pausedExecution = null;
    this.confirmBar.setAttribute('data-hidden', '');
    this.hideRecovery();
    this.updateActiveTask({
      status: 'cancelled',
      summary: '用户放弃了任务',
      waitingFor: undefined,
      pendingCommands: undefined,
      recovery: undefined,
    });
    this.pushInfo('任务已放弃。');
  }

  async resumeTask(): Promise<void> {
    const task = this.activeTask;
    if (!task || this.busy) return;

    if (task.status === 'waiting_confirm' && task.pendingCommands?.length) {
      this.pendingCmds = task.pendingCommands;
      this.confirmExecute();
      return;
    }

    if (task.status === 'waiting_recovery') {
      this.recoveryBar.removeAttribute('data-hidden');
      this.open({ mode: 'operate' });
      this.ensurePausedExecution();
      return;
    }

    const commands = task.steps.length
      ? task.steps.map((s) => s.command)
      : task.pendingCommands;
    if (!commands?.length) {
      this.pushInfo('没有可继续的步骤。');
      return;
    }

    const fromIndex = task.steps.findIndex(
      (s) => s.status === 'pending' || s.status === 'running' || s.status === 'failed',
    );
    const startAt = fromIndex >= 0 ? fromIndex : 0;

    this.open({ mode: 'operate' });
    this.updateActiveTask({ status: 'running', currentStepIndex: startAt });
    this.pushInfo(`从第 ${startAt + 1} 步继续执行…`);
    await this.runCommands(commands, startAt);
  }

  private beginTask(goal: string): TaskState {
    this.activeTask = createTask(goal);
    this.renderTaskCard();
    this.persistSession();
    return this.activeTask;
  }

  private updateActiveTask(patch: Partial<TaskState>): void {
    if (!this.activeTask) return;
    this.activeTask = touchTask(this.activeTask, { ...patch, url: location.href });
    this.renderTaskCard();
    this.persistSession();
  }

  private renderTaskCard(): void {
    const task = this.activeTask;
    if (!task) {
      this.taskCard.setAttribute('data-hidden', '');
      this.updateMiniBar();
      return;
    }
    this.taskCard.removeAttribute('data-hidden');
    this.updateMiniBar();

    const compact = task.status === 'waiting_recovery' || task.status === 'interrupted' || task.status === 'completed';
    if (compact) this.taskCard.setAttribute('data-compact', '');
    else this.taskCard.removeAttribute('data-compact');
    if (this.taskCardExpanded && compact) this.taskCard.setAttribute('data-expanded', '');
    else this.taskCard.removeAttribute('data-expanded');

    const goalEl = this.panel.querySelector('#im-task-goal')!;
    const badgeEl = this.panel.querySelector('#im-task-badge')!;
    const planEl = this.panel.querySelector('#im-task-plan')!;
    const stepsEl = this.panel.querySelector('#im-task-steps')!;
    const summaryEl = this.panel.querySelector('#im-task-summary')!;
    const compactHint = this.panel.querySelector('#im-task-compact-hint')!;
    const expandBtn = this.panel.querySelector<HTMLButtonElement>('#im-task-expand')!;

    goalEl.textContent = task.goal;
    badgeEl.textContent = taskStatusLabel(task.status);
    badgeEl.className = 'im-task-badge';
    if (task.status === 'running' || task.status === 'planning') badgeEl.classList.add('im-task-badge--running');
    else if (task.status === 'interrupted') badgeEl.classList.add('im-task-badge--wait');
    else if (task.status === 'completed') badgeEl.classList.add('im-task-badge--done');
    else if (task.status === 'failed' || task.status === 'cancelled') badgeEl.classList.add('im-task-badge--fail');
    else if (task.status === 'waiting_confirm' || task.status === 'waiting_recovery') badgeEl.classList.add('im-task-badge--wait');

    if (compact) {
      expandBtn.removeAttribute('data-hidden');
      expandBtn.textContent = this.taskCardExpanded ? '收起' : '展开步骤';
      const failed = task.steps.find((s) => s.status === 'failed') ?? task.steps[task.currentStepIndex];
      const done = task.steps.filter((s) => s.status === 'ok' || s.status === 'skipped').length;
      const failHint = failed
        ? `第 ${task.steps.indexOf(failed) + 1} 步失败：${failed.label}`
        : `可从第 ${task.currentStepIndex + 1} 步继续`;
      if (task.status === 'completed') {
        compactHint.textContent = task.summary
          ? `已完成 · ${truncateText(task.summary, 64)}`
          : `已完成 · 共 ${done}/${task.steps.length || done} 步`;
      } else {
        compactHint.textContent = task.recovery?.contextLost
          ? `${done} 步已完成 · ${failHint}。目标可能在弹窗中，请先打开对应界面。`
          : `${done} 步已完成 · ${failHint}`;
      }
    } else {
      expandBtn.setAttribute('data-hidden', '');
      compactHint.textContent = '';
    }

    if (task.plan && !compact) {
      planEl.textContent = task.plan;
      planEl.removeAttribute('data-hidden');
    } else {
      planEl.setAttribute('data-hidden', '');
    }

    stepsEl.innerHTML = '';
    task.steps.forEach((step, i) => {
      const row = document.createElement('div');
      row.className = 'im-task-step';
      const stepIcon = step.status === 'running' ? icon('loader')
        : step.status === 'ok' ? icon('check')
          : step.status === 'failed' ? icon('x')
            : step.status === 'skipped' ? icon('x')
              : icon('loader');
      const cls = step.status === 'ok' ? 'im-step--ok'
        : step.status === 'failed' ? 'im-step--fail'
          : step.status === 'running' ? 'im-step--running'
            : 'im-step--pending';
      const err = step.status === 'failed' && step.result
        ? `<div class="im-task-step-error">${escHtml(truncateText(step.result, 100))}</div>`
        : '';
      row.innerHTML = `<div class="im-step-icon ${cls}">${stepIcon}</div><div><span>${i + 1}. ${escHtml(step.label)}</span>${err}</div>`;
      stepsEl.appendChild(row);
    });

    if (task.summary && !compact) {
      summaryEl.textContent = task.summary;
      summaryEl.removeAttribute('data-hidden');
    } else {
      summaryEl.setAttribute('data-hidden', '');
    }

    const actionsEl = this.panel.querySelector('#im-task-toolbar')!;
    const hintEl = this.panel.querySelector('#im-task-hint')!;
    const continueBtn = this.panel.querySelector<HTMLButtonElement>('#im-task-continue')!;
    const abandonBtn = this.panel.querySelector<HTMLButtonElement>('#im-task-abandon')!;
    const recoveryVisible = !this.recoveryBar.hasAttribute('data-hidden');
    const showToolbar = (this.canResumeTask(task) || task.status === 'completed') && !recoveryVisible && task.status !== 'waiting_recovery';
    if (showToolbar) {
      actionsEl.removeAttribute('data-hidden');
      if (task.status === 'waiting_confirm') {
        hintEl.textContent = '任务等待确认，点击下方执行或取消。';
        continueBtn.innerHTML = `${icon('play')}帮我操作`;
        abandonBtn.innerHTML = `${icon('x')}放弃任务`;
      } else if (task.status === 'interrupted') {
        const next = task.steps.findIndex((s) => s.status === 'pending' || s.status === 'failed');
        const stepNo = next >= 0 ? next + 1 : task.currentStepIndex + 1;
        hintEl.textContent = `任务已暂停，可从第 ${stepNo} 步继续。`;
        continueBtn.innerHTML = `${icon('play')}继续执行`;
        abandonBtn.innerHTML = `${icon('x')}放弃任务`;
      } else if (task.status === 'completed') {
        hintEl.textContent = '任务已完成。可展开查看步骤，或清除这条任务。';
        continueBtn.innerHTML = this.taskCardExpanded ? `${icon('message')}收起步骤` : `${icon('message')}查看步骤`;
        abandonBtn.innerHTML = `${icon('x')}清除`;
      } else {
        const next = task.steps.findIndex((s) => s.status === 'pending' || s.status === 'failed');
        const stepNo = next >= 0 ? next + 1 : task.currentStepIndex + 1;
        hintEl.textContent = `可从第 ${stepNo} 步继续。`;
        continueBtn.innerHTML = `${icon('play')}继续执行`;
        abandonBtn.innerHTML = `${icon('x')}放弃任务`;
      }
    } else {
      actionsEl.setAttribute('data-hidden', '');
    }
  }

  private stepLabel(cmd: ToolCommand): string {
    return cmd.explanation ?? cmd.action;
  }

  private commandsToTaskSteps(commands: ToolCommand[]): TaskStep[] {
    return commands.map((command, index) => createTaskStep(command, index));
  }

  private syncTaskStepsFromUi(
    steps: Array<{ label: string; ok?: boolean; error?: string }>,
    commands: ToolCommand[],
  ): void {
    if (!this.activeTask) return;
    const taskSteps = commands.map((command, i) => {
      const ui = steps[i];
      let status: TaskStep['status'] = 'pending';
      if (ui?.ok === true) status = 'ok';
      else if (ui?.ok === false) status = 'failed';
      return {
        ...createTaskStep(command, i),
        label: this.stepLabel(command),
        status,
        result: ui?.error,
      };
    });
    this.updateActiveTask({
      steps: taskSteps,
      currentStepIndex: Math.max(0, steps.findIndex((s) => s.ok === undefined)),
    });
  }

  private showRecovery(errorMessage: string, stepIndex: number, currentCmds: ToolCommand[]): void {
    const contextLost = isContextLostError(errorMessage);
    const missingRequired = parseMissingRequiredFields(errorMessage);
    const failedLabel = currentCmds[stepIndex]?.explanation ?? `步骤 ${stepIndex + 1}`;
    let displayMsg = contextLost
      ? `「${failedLabel}」失败：目标不在当前页面（可能在弹窗或未打开的界面）。建议先手动打开对应弹窗，再点「重新采集」+「重试」；或直接「重新规划」让 AI 根据现状调整。`
      : truncateText(errorMessage, 160);

    if (missingRequired?.length) {
      const question = formatRequiredFieldQuestion(missingRequired);
      this.pushMsg('assistant', question);
      displayMsg = question;
    }

    this.recoveryBar.removeAttribute('data-hidden');
    this.panel.querySelector('#im-recovery-msg')!.textContent = displayMsg;
    this.taskCardExpanded = false;
    this.updateActiveTask({
      status: 'waiting_recovery',
      waitingFor: 'recovery',
      recovery: {
        failedStepIndex: stepIndex,
        errorMessage,
        remainingCommands: currentCmds.slice(stepIndex + 1),
        contextLost,
        missingRequiredFields: missingRequired ?? undefined,
      },
    });
    this.renderTaskCard();
    this.setStatus(
      missingRequired?.length ? '等待你补充必填项' : '步骤失败，等待恢复操作',
      false,
    );
    this.setBusy(false);
    this.visual.showScreenFrame(false);
  }

  /** User replied with values for missing required fields — fill and retry failed submit step. */
  private async continueAfterRequiredFieldPrompt(userText: string): Promise<void> {
    const task = this.activeTask;
    const missing = task?.recovery?.missingRequiredFields;
    if (!task || !missing?.length) return;

    const paused = this.ensurePausedExecution();
    if (!paused) {
      this.recoveryUnavailableHint();
      return;
    }

    const snap = takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
    const snapText = formatSnapshotForAgent(snap);
    const failedCmd = paused.currentCmds[paused.stepIndex];
    const augmented = [
      `用户补充了必填项信息：${userText}`,
      `需要补全的必填项：${missing.join('、')}`,
      `当前任务：${task.goal}`,
      `失败步骤：第 ${paused.stepIndex + 1} 步（${failedCmd.explanation ?? failedCmd.action}）`,
      '请根据用户补充，只为上述必填项生成 input 或 select 操作（快照中带 [required] 的字段）。',
      '不要生成 click 提交/保存，框架会在补全后自动重试失败步骤。',
      '不要重新导航或重新打开弹窗。',
      `---\n当前页面快照：\n${snapText}`,
    ].join('\n\n');

    this.llmHistory.push({ role: 'user', content: augmented });

    const replyMsg = this.pushMsg('assistant', '', true);
    let full = '';
    this.setStatus('AI 补全必填项', true);

    this.abortCtrl = new AbortController();
    for await (const chunk of streamChat(
      this.llmHistory,
      this.settings,
      this.skills,
      this.abortCtrl.signal,
      'operate',
    )) {
      full += chunk;
      this.updateMsg(replyMsg, { text: stripToolCallBlocks(full), streaming: true });
      this.msgList.scrollTop = this.msgList.scrollHeight;
    }
    this.abortCtrl = null;

    const toolCalls = parseToolCalls(full);
    const cleanText = stripToolCallBlocks(full);
    this.llmHistory.push({ role: 'assistant', content: full });
    this.updateMsg(replyMsg, {
      text: cleanText || '收到，我来补全必填项并继续提交。',
      streaming: false,
    });

    if (!toolCalls?.length) {
      this.pushInfo('未能生成补全操作。请更明确说明，例如：联系人填 李四 13800001234');
      this.recoveryBar.removeAttribute('data-hidden');
      return;
    }

    const fillCmds = this.parsedToCommands(toolCalls).filter((c) => c.action !== 'snapshot');
    if (!fillCmds.length) {
      this.pushInfo('请提供要填写的具体内容。');
      this.recoveryBar.removeAttribute('data-hidden');
      return;
    }

    this.recoveryBar.setAttribute('data-hidden', '');
    this.visual.showScreenFrame(true);

    let currentSnap = snap;
    for (const cmd of fillCmds) {
      const result = await executeCommand(cmd, currentSnap, {
        overlaySelectors: this.pack.overlaySelectors ?? [],
        onBeforeAction: (c, el) => {
          if (el) {
            const ref = parseInt(el.getAttribute('data-im-ref') ?? '0', 10);
            this.visual.showTarget(el, ref, c.explanation);
          }
        },
        onAfterAction: () => {
          if (cmd.action === 'click') this.visual.animateClick();
          this.visual.scheduleHide(1200);
        },
      });
      if (result.snapshot) currentSnap = result.snapshot;
      if (!result.success) {
        paused.snap = currentSnap;
        this.pausedExecution = paused;
        this.showRecovery(result.message, paused.stepIndex, paused.currentCmds);
        return;
      }
    }

    paused.snap = currentSnap;
    paused.steps[paused.stepIndex] = { label: this.stepLabel(failedCmd), ok: undefined };
    this.pausedExecution = paused;
    this.updateActiveTask({
      recovery: {
        ...task.recovery!,
        missingRequiredFields: undefined,
      },
    });
    this.pushInfo('已补全必填项，正在重新提交…');
    await this.resumeExecutionFrom(paused, paused.stepIndex, currentSnap);
  }

  private recoveryUnavailableHint(): void {
    this.pushInfo('无法恢复执行上下文。请点「重新规划」，或在下方聊天说明当前页面（如「新建订单弹窗已打开」）。');
  }

  private findRecoveryExecMsg(): UIMessage {
    for (let i = this.uiMessages.length - 1; i >= 0; i--) {
      const m = this.uiMessages[i];
      if (m.role === 'assistant' && m.steps?.length) return m;
    }
    return this.pushMsg('assistant', '继续执行');
  }

  /** Rebuild runtime execution context after refresh or when recovery bar is shown without memory state */
  private ensurePausedExecution(): PausedExecution | null {
    if (this.pausedExecution) return this.pausedExecution;

    const task = this.activeTask;
    if (!task?.recovery || !task.steps.length) return null;

    const commands = task.steps.map((s) => s.command);
    const steps = commands.map((cmd, i) => {
      const ts = task.steps[i];
      let ok: boolean | undefined;
      if (ts.status === 'ok' || ts.status === 'skipped') ok = true;
      else if (ts.status === 'failed') ok = false;
      return {
        label: this.stepLabel(cmd),
        ok,
        error: ts.status === 'failed' ? ts.result : undefined,
      };
    });

    this.pausedExecution = {
      execMsg: this.findRecoveryExecMsg(),
      steps,
      stepIndex: task.recovery.failedStepIndex,
      currentCmds: commands,
      snap: takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] }),
      globalSnap: null,
      turn: 0,
      llmResultParts: [],
      errorMessage: task.recovery.errorMessage,
    };
    return this.pausedExecution;
  }

  private hideRecovery(clearPaused = true): void {
    this.recoveryBar.setAttribute('data-hidden', '');
    if (clearPaused) this.pausedExecution = null;
    this.renderTaskCard();
  }

  private async handleRecoveryReplan(): Promise<void> {
    if (this.busy) {
      this.pushInfo('正在执行中，请稍候…');
      return;
    }

    const task = this.activeTask;
    if (!task?.recovery) {
      this.pushInfo('当前没有可重新规划的任务。');
      return;
    }

    if (!isConfigured(this.settings)) {
      this.pushInfo('重新规划需要 AI API Key。你也可以在下方聊天描述：「弹窗已打开，请继续填写订单」。');
      return;
    }

    const failedCmd = task.steps[task.recovery.failedStepIndex]?.command;
    if (!failedCmd) {
      this.pushInfo('无法定位失败步骤，请在聊天中描述当前页面状态。');
      return;
    }

    this.pushInfo('正在根据当前页面重新规划…');
    this.recoveryBar.setAttribute('data-hidden', '');
    this.setBusy(true);
    const snap = takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
    const prompt = [
      `任务「${task.goal}」执行到第 ${task.recovery.failedStepIndex + 1} 步时失败。`,
      `失败步骤：${this.stepLabel(failedCmd)}`,
      `原因：${task.recovery.errorMessage}`,
      '',
      '当前页面可能已变化（例如弹窗关闭或页面跳转）。请根据下方页面快照，重新规划从**当前状态**完成任务的后续操作，不要重复已成功的步骤。',
      '',
      `---`,
      `当前页面快照：`,
      formatSnapshotForAgent(snap),
    ].join('\n');

    this.llmHistory.push({ role: 'user', content: prompt });
    this.setStatus('AI 重新规划中', true);

    let full = '';
    for await (const chunk of streamChat(this.llmHistory, this.settings, this.skills, undefined, 'operate')) {
      full += chunk;
    }
    this.llmHistory.push({ role: 'assistant', content: full });

    const toolCalls = parseToolCalls(full);
    const cleanText = stripToolCallBlocks(full);

    if (toolCalls?.length) {
      const cmds = this.parsedToCommands(toolCalls);
      this.pendingCmds = cmds;
      this.updateActiveTask({
        status: 'waiting_confirm',
        waitingFor: 'confirm',
        plan: cleanText || '已根据当前页面重新规划',
        pendingCommands: cmds,
        steps: this.commandsToTaskSteps(cmds),
        recovery: undefined,
      });
      this.pushMsg('assistant', cleanText || `已根据当前页面重新规划 ${cmds.length} 步，请确认后执行。`);
      this.confirmBar.removeAttribute('data-hidden');
      this.launcher.classList.add('im-has-notify');
    } else {
      this.updateActiveTask({ status: 'interrupted', recovery: undefined });
      this.pushMsg('assistant', cleanText || '未能自动生成新计划。请在下方说明当前页面状态（例如「新建订单弹窗已打开」）。');
    }

    this.clearStatus();
    this.setBusy(false);
    this.pausedExecution = null;
    this.persistSession();
  }

  private handleRecoveryDebug(): void {
    this.debugSnapshot();
    this.pushInfo('页面快照已输出到浏览器控制台（F12 → Console）');
  }

  private async handleRecovery(action: 'retry' | 'resnapshot' | 'skip' | 'handoff'): Promise<void> {
    if (this.busy) {
      this.pushInfo('助手正在执行中，请稍候。');
      return;
    }

    const paused = this.ensurePausedExecution();
    if (!paused) {
      this.recoveryUnavailableHint();
      return;
    }

    this.recoveryBar.setAttribute('data-hidden', '');

    if (action === 'handoff') {
      const cmd = paused.currentCmds[paused.stepIndex];
      const snap = paused.snap;
      let highlighted = false;
      if (cmd.ref != null) {
        const el = snap.elementByRef.get(cmd.ref);
        if (el) {
          this.visual.showTarget(el, cmd.ref, cmd.explanation ?? '请手动完成此步骤');
          highlighted = true;
        }
      } else if (cmd.find) {
        const found = snap.elements.find((e) =>
          cmd.find?.textContains && e.text.includes(cmd.find.textContains));
        if (found) {
          const el = snap.elementByRef.get(found.ref);
          if (el) {
            this.visual.showTarget(el, found.ref, cmd.explanation ?? '请手动完成此步骤');
            highlighted = true;
          }
        }
      }
      this.pausedExecution = paused;
      this.pushInfo(
        highlighted
          ? '已高亮目标元素。请手动完成后点「重新采集」+「重试」，或「重新规划」。'
          : '当前页面找不到目标元素。请先打开对应弹窗/页面，再「重新采集」或「重新规划」。',
      );
      this.showRecovery(
        highlighted
          ? '已切换为手动模式。完成操作后请重新采集再重试。'
          : '目标不在当前页面。请先恢复界面上下文（如打开弹窗）。',
        paused.stepIndex,
        paused.currentCmds,
      );
      return;
    }

    if (action === 'resnapshot') {
      const snap = takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
      paused.snap = snap;
      paused.globalSnap = snap;
      this.pausedExecution = paused;
      const count = snap.elementCount;
      this.pushInfo(`已重新采集页面（${count} 个可交互元素）。确认界面就绪后点「重试」。`);
      this.showRecovery(
        `已更新页面快照（${count} 个元素）。${this.activeTask?.recovery?.contextLost ? '若目标在弹窗中，请先打开弹窗再重试。' : '可点击「重试」继续。'}`,
        paused.stepIndex,
        paused.currentCmds,
      );
      return;
    }

    this.setBusy(true);
    this.visual.showScreenFrame(true);

    let snap = paused.snap;
    if (action === 'skip') {
      this.pushInfo(`已跳过第 ${paused.stepIndex + 1} 步，继续后续操作…`);
      paused.steps[paused.stepIndex] = { label: this.stepLabel(paused.currentCmds[paused.stepIndex]), ok: true };
      this.updateMsg(paused.execMsg, { steps: [...paused.steps] });
      await this.resumeExecutionFrom(paused, paused.stepIndex + 1, snap);
      return;
    }

    // retry
    const retryCmd = paused.currentCmds[paused.stepIndex];
    paused.steps[paused.stepIndex] = { label: this.stepLabel(retryCmd), ok: undefined };
    if (this.activeTask?.recovery?.contextLost) {
      snap = takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
      paused.snap = snap;
    }
    this.pushInfo(`正在重试第 ${paused.stepIndex + 1} 步：${this.stepLabel(retryCmd)}…`);
    this.setStatus(`重试第 ${paused.stepIndex + 1} 步`, true);
    await this.resumeExecutionFrom(paused, paused.stepIndex, snap);
  }

  private async resumeExecutionFrom(paused: PausedExecution, fromIndex: number, snap: PageSnapshot): Promise<void> {
    paused.snap = snap;
    this.updateActiveTask({ status: 'running', waitingFor: undefined, recovery: undefined });
    const result = await this.executeCommandLoop(paused, fromIndex);
    this.updateMsg(paused.execMsg, { steps: [...paused.steps], streaming: false });
    this.syncTaskStepsFromUi(paused.steps, paused.currentCmds);

    if (result === 'ok' && this.activeTask?.status === 'running') {
      this.finishTask('操作已完成');
    }

    this.visual.showScreenFrame(false);
    this.visual.scheduleHide(600);
    this.clearStatus();
    this.setBusy(false);
    this.persistSession();
  }

  // ── Settings form ─────────────────────────────────────────────────────────

  private fillSettingsForm(): void {
    const s = this.settings;
    const providerSel = this.panel.querySelector<HTMLSelectElement>('#im-provider-select')!;
    const endpointInput = this.panel.querySelector<HTMLInputElement>('#im-endpoint-input')!;
    const keyInput = this.panel.querySelector<HTMLInputElement>('#im-key-input')!;
    providerSel.value = s.provider;
    endpointInput.value = s.apiEndpoint;
    keyInput.value = s.apiKey;
    this.renderModelOptions(s.provider, s.model);
    this.updateSettingsStatus();
  }

  private onProviderChange(): void {
    const providerSel = this.panel.querySelector<HTMLSelectElement>('#im-provider-select')!;
    const endpointInput = this.panel.querySelector<HTMLInputElement>('#im-endpoint-input')!;
    const hint = this.panel.querySelector<HTMLDivElement>('#im-endpoint-hint')!;
    const p = providerSel.value as Provider;
    const def = PROVIDERS[p];
    if (def.endpoint) endpointInput.value = def.endpoint;
    hint.textContent = def.placeholder ?? '';
    this.renderModelOptions(p, '');
  }

  private renderModelOptions(provider: Provider, selectedModel: string): void {
    const modelSel = this.panel.querySelector<HTMLSelectElement>('#im-model-select')!;
    const models = PROVIDERS[provider].models;
    if (models.length === 0) {
      modelSel.innerHTML = '<option value="">请输入模型名称</option>';
      const input = document.createElement('input');
      input.type = 'text'; input.id = 'im-model-input'; input.placeholder = '例如: llama3';
      input.style.cssText = 'border:1.5px solid var(--im-border);border-radius:8px;padding:8px 12px;width:100%;box-sizing:border-box;font-size:13.5px;';
      input.value = selectedModel;
      modelSel.replaceWith(input);
    } else {
      modelSel.innerHTML = models.map((m) => `<option value="${m}" ${m === selectedModel ? 'selected' : ''}>${m}</option>`).join('');
    }
  }

  private saveSettingsFromForm(): void {
    const providerSel = this.panel.querySelector<HTMLSelectElement>('#im-provider-select')!;
    const endpointInput = this.panel.querySelector<HTMLInputElement>('#im-endpoint-input')!;
    const keyInput = this.panel.querySelector<HTMLInputElement>('#im-key-input')!;
    const modelEl = this.panel.querySelector<HTMLSelectElement | HTMLInputElement>('#im-model-select, #im-model-input')!;

    this.settings = {
      provider: providerSel.value as Provider,
      apiEndpoint: endpointInput.value.trim(),
      apiKey: keyInput.value.trim(),
      model: modelEl.value.trim(),
    };
    saveSettings(this.settings);
    this.updateSettingsStatus();
    this.updateNoKeyBanner();
    this.pushInfo(`设置已保存。AI 模型：${this.settings.model || '（未配置）'}`);
    setTimeout(() => this.showView('chat'), 600);
  }

  private updateSettingsStatus(): void {
    const el = this.panel.querySelector<HTMLDivElement>('#im-settings-status')!;
    if (isConfigured(this.settings)) {
      el.className = 'im-settings-status ok';
      el.textContent = `已配置：${this.settings.model}（${PROVIDERS[this.settings.provider]?.name ?? this.settings.provider}）`;
    } else {
      el.className = 'im-settings-status warn';
      el.textContent = '尚未配置 API Key，助手将使用本地演示规划器';
    }
  }

  private updateNoKeyBanner(): void {
    if (isConfigured(this.settings)) {
      this.noKeyBanner.setAttribute('data-hidden', '');
    } else {
      this.noKeyBanner.removeAttribute('data-hidden');
    }
  }

  // ── Messaging helpers ─────────────────────────────────────────────────────

  private pushInfo(text: string): UIMessage {
    const msg: UIMessage = { id: uid(), role: 'info', text };
    this.uiMessages.push(msg);
    this.renderMessage(msg);
    return msg;
  }

  private pushMsg(role: 'user' | 'assistant', text: string, streaming = false): UIMessage {
    const msg: UIMessage = { id: uid(), role, text, streaming };
    this.uiMessages.push(msg);
    this.renderMessage(msg);
    return msg;
  }

  private updateMsg(msg: UIMessage, patch: Partial<UIMessage>): void {
    Object.assign(msg, patch);
    const el = this.msgList.querySelector(`[data-msg-id="${msg.id}"]`);
    if (el) el.replaceWith(this.buildMsgEl(msg));
    else this.renderMessage(msg);
  }

  private renderMessage(msg: UIMessage): void {
    this.msgList.appendChild(this.buildMsgEl(msg));
    this.msgList.scrollTop = this.msgList.scrollHeight;
  }

  private buildMsgEl(msg: UIMessage): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `im-msg im-msg--${msg.role}`;
    wrap.setAttribute('data-msg-id', msg.id);

    const bubble = document.createElement('div');
    bubble.className = `im-msg-bubble${msg.streaming ? ' im-typing' : ''}`;

    if (msg.streaming || msg.role === 'user') {
      // During streaming or user messages: plain text to avoid markdown flicker
      bubble.textContent = msg.text;
    } else {
      // Render markdown for finalized assistant/info messages
      const mdWrap = document.createElement('div');
      mdWrap.className = 'im-md';
      mdWrap.innerHTML = renderMd(msg.text);
      bubble.appendChild(mdWrap);
    }

    wrap.appendChild(bubble);

    if (msg.steps?.length) {
      const stepsEl = document.createElement('div');
      stepsEl.className = 'im-steps';
      msg.steps.forEach((step) => {
        const stepEl = document.createElement('div');
        const cls = step.ok === undefined ? 'im-step--pending' : step.ok ? 'im-step--ok' : 'im-step--fail';
        const stepIcon = step.ok === undefined ? icon('loader') : step.ok ? icon('check') : icon('x');
        stepEl.className = `im-step ${cls}`;
        const errHtml = step.error
          ? `<div class="im-step-error">${escHtml(truncateText(step.error, 100))}</div>`
          : '';
        stepEl.innerHTML = `<div class="im-step-icon">${stepIcon}</div><div><span>${escHtml(step.label)}</span>${errHtml}</div>`;
        stepsEl.appendChild(stepEl);
      });
      wrap.appendChild(stepsEl);
    }

    // Inline action buttons when there are pending commands
    if (msg.hasPendingActions && !msg.streaming) {
      const actBar = document.createElement('div');
      actBar.className = 'im-msg-actions';
      const runBtn = document.createElement('button');
      runBtn.className = 'im-btn im-btn--primary';
      runBtn.innerHTML = `${icon('play')}帮我操作`;
      runBtn.addEventListener('click', () => {
        runBtn.disabled = true;
        runBtn.innerHTML = `${icon('loader')}执行中`;
        // Trigger confirm via the confirm bar's button (reuse existing logic)
        const confirmBtn = document.getElementById('im-confirm-btn') as HTMLButtonElement | null;
        confirmBtn?.click();
      });
      const skipBtn = document.createElement('button');
      skipBtn.className = 'im-btn';
      skipBtn.textContent = '取消';
      skipBtn.addEventListener('click', () => {
        const cancelBtn = document.getElementById('im-cancel-btn') as HTMLButtonElement | null;
        cancelBtn?.click();
        actBar.remove();
      });
      actBar.appendChild(runBtn);
      actBar.appendChild(skipBtn);
      wrap.appendChild(actBar);
    }

    return wrap;
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  private setStatus(text: string, busy = false): void {
    this.statusBar.removeAttribute('data-hidden');
    this.statusText.textContent = text;
    this.statusDot.className = busy ? 'im-status-dot im-status-dot--busy' : 'im-status-dot';
  }

  private clearStatus(): void {
    this.statusBar.setAttribute('data-hidden', '');
  }

  // ── Send / LLM flow ───────────────────────────────────────────────────────

  private handleSend(): void {
    const text = this.textarea.value.trim();
    if (!text || this.busy) return;
    this.textarea.value = '';
    this.pushMsg('user', text);
    void this.processUserMessage(text);
  }

  private async processUserMessage(userText: string): Promise<void> {
    this.setBusy(true);
    this.pendingCmds = null;
    this.confirmBar.setAttribute('data-hidden', '');

    if (this.mode === 'chat') {
      this.hideRecovery();
      await this.processChatMessage(userText);
      this.setBusy(false);
      return;
    }

    // User is answering a required-field prompt — continue the same task
    if (
      this.activeTask?.status === 'waiting_recovery' &&
      this.activeTask.recovery?.missingRequiredFields?.length &&
      isConfigured(this.settings)
    ) {
      await this.continueAfterRequiredFieldPrompt(userText);
      this.setBusy(false);
      return;
    }

    this.hideRecovery();
    this.beginTask(userText);

    // ── With LLM ────────────────────────────────────────────────────────────
    if (isConfigured(this.settings)) {
      await this.processWithLLM(userText);
    } else {
      // ── Demo / keyword-matching fallback ────────────────────────────────
      await this.processWithPlanner(userText);
    }

    this.setBusy(false);
  }

  private async processChatMessage(userText: string): Promise<void> {
    if (!isConfigured(this.settings)) {
      const replyMsg = this.pushMsg('assistant', '', true);
      await this.fakeTyping(
        replyMsg,
        '问答模式需要配置 AI API Key。当前未配置时只支持操作模式里的本地演示规划器。',
      );
      this.clearStatus();
      return;
    }

    const pageContext = `当前页面：${document.title || '(无标题)'}\nURL：${location.href}`;
    this.llmHistory.push({ role: 'user', content: `${userText}\n\n---\n${pageContext}` });

    const replyMsg = this.pushMsg('assistant', '', true);
    let full = '';
    this.setStatus('AI 回答中', true);

    this.abortCtrl = new AbortController();
    for await (const chunk of streamChat(this.llmHistory, this.settings, this.skills, this.abortCtrl.signal, 'chat')) {
      full += chunk;
      this.updateMsg(replyMsg, { text: full, streaming: true });
      this.msgList.scrollTop = this.msgList.scrollHeight;
    }
    this.abortCtrl = null;
    this.llmHistory.push({ role: 'assistant', content: full });
    this.updateMsg(replyMsg, { text: full || '没有收到回答。', streaming: false });
    this.clearStatus();
  }

  private async processWithLLM(userText: string): Promise<void> {
    const plan = planFromUserMessage(userText, this.pack);

    // Matched playbook → use site-pack steps directly; LLM handles follow-up after execution.
    if (plan.playbook && plan.commands && plan.commands.length > 0) {
      this.llmHistory.push({ role: 'user', content: userText });
      const replyMsg = this.pushMsg('assistant', '', true);
      this.setStatus('规划中', true);
      await this.fakeTyping(replyMsg, plan.reply);
      this.llmHistory.push({ role: 'assistant', content: plan.reply });

      this.pendingCmds = plan.commands;
      this.updateActiveTask({
        status: 'waiting_confirm',
        waitingFor: 'confirm',
        plan: plan.reply,
        pendingCommands: plan.commands,
        steps: this.commandsToTaskSteps(plan.commands),
      });
      this.updateMsg(replyMsg, {
        text: plan.reply,
        streaming: false,
        hasPendingActions: true,
      });
      this.confirmBar.removeAttribute('data-hidden');
      this.setStatus(`已匹配站点包流程，共 ${plan.commands.length} 步，等待确认`, false);
      this.launcher.classList.add('im-has-notify');
      return;
    }

    // No playbook match → LLM plans with site-pack context + page snapshot
    const snap = takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
    const snapText = formatSnapshotForAgent(snap);
    const packCtx = formatPackContextForAgent(this.pack);
    let augmented = `${userText}\n\n---\n${packCtx}\n\n---\n当前页面快照：\n${snapText}`;
    if (plan.playbook && plan.errors.length) {
      augmented += `\n\n---\n站点包流程「${plan.playbook.description}」预解析问题：${plan.errors.join('；')}。请按站点说明重新规划。`;
    }

    this.llmHistory.push({ role: 'user', content: augmented });

    const replyMsg = this.pushMsg('assistant', '', true); // streaming=true during LLM output
    let full = '';

    this.setStatus('AI 思考中', true);

    this.abortCtrl = new AbortController();
    for await (const chunk of streamChat(this.llmHistory, this.settings, this.skills, this.abortCtrl.signal, 'operate')) {
      full += chunk;
      const display = stripToolCallBlocks(full);
      this.updateMsg(replyMsg, { text: display, streaming: true });
      this.msgList.scrollTop = this.msgList.scrollHeight;
    }

    this.abortCtrl = null;
    const cleanText = stripToolCallBlocks(full);
    const toolCalls = parseToolCalls(full);

    this.llmHistory.push({ role: 'assistant', content: full });

    if (toolCalls && toolCalls.length > 0) {
      this.pendingCmds = this.parsedToCommands(toolCalls);
      this.updateActiveTask({
        status: 'waiting_confirm',
        waitingFor: 'confirm',
        plan: cleanText || undefined,
        pendingCommands: this.pendingCmds,
        steps: this.commandsToTaskSteps(this.pendingCmds),
      });
      // Update message: show clean text + inline action buttons
      this.updateMsg(replyMsg, {
        text: cleanText || `已规划 ${this.pendingCmds.length} 步操作，点击下方按钮执行。`,
        streaming: false,
        hasPendingActions: true,
      });
      // Also show the bottom confirm bar and launcher dot as backup
      this.confirmBar.removeAttribute('data-hidden');
      this.setStatus(`已规划 ${this.pendingCmds.length} 步操作，等待确认`, false);
      this.launcher.classList.add('im-has-notify');
    } else {
      this.updateMsg(replyMsg, { text: cleanText || '（LLM 未返回操作步骤）', streaming: false });
      this.clearStatus();
    }
  }

  private async processWithPlanner(userText: string): Promise<void> {
    this.setStatus('规划中', true);
    const plan = planFromUserMessage(userText, this.pack);

    const replyMsg = this.pushMsg('assistant', '', true); // streaming=true during fake typing
    await this.fakeTyping(replyMsg, plan.reply);

    if (plan.commands && plan.commands.length > 0) {
      this.pendingCmds = plan.commands;
      this.updateActiveTask({
        status: 'waiting_confirm',
        waitingFor: 'confirm',
        plan: plan.reply,
        pendingCommands: plan.commands,
        steps: this.commandsToTaskSteps(plan.commands),
      });
      this.confirmBar.removeAttribute('data-hidden');
      this.setStatus(`已规划 ${plan.commands.length} 步操作，等待确认`, false);
      this.launcher.classList.add('im-has-notify');
      this.updateMsg(replyMsg, {
        text: plan.reply,
        steps: plan.commands.map((c) => ({ label: c.explanation ?? `${c.action}`, ok: undefined })),
        hasPendingActions: true,
        streaming: false,
      });
    } else {
      this.clearStatus();
    }
  }

  // ── Confirm / execute ─────────────────────────────────────────────────────

  private confirmExecute(): void {
    if (!this.pendingCmds) return;
    const cmds = this.pendingCmds;
    this.pendingCmds = null;
    this.confirmBar.setAttribute('data-hidden', '');
    this.launcher.classList.remove('im-has-notify');
    this.updateActiveTask({
      status: 'running',
      waitingFor: undefined,
      pendingCommands: undefined,
      steps: this.commandsToTaskSteps(cmds),
    });
    // Remove all inline action bars to prevent double-triggering
    this.msgList.querySelectorAll('.im-msg-actions').forEach((el) => el.remove());
    void this.runCommands(cmds);
  }

  private cancelPending(): void {
    this.pendingCmds = null;
    this.confirmBar.setAttribute('data-hidden', '');
    this.msgList.querySelectorAll('.im-msg-actions').forEach((el) => el.remove());
    this.clearStatus();
    if (this.activeTask?.status === 'waiting_confirm') {
      this.updateActiveTask({ status: 'cancelled', waitingFor: undefined, pendingCommands: undefined, summary: '用户取消了操作' });
    }
    this.pushInfo('已取消操作');
  }

  /** Execute commands and loop with LLM until task is complete (agentic multi-turn). */
  private async runCommands(initialCmds: ToolCommand[], startIndex = 0): Promise<void> {
    this.setBusy(true);
    this.visual.showScreenFrame(true);
    this.hideRecovery();
    this.updateActiveTask({ status: 'running' });

    let currentCmds = initialCmds;
    let globalSnap: PageSnapshot | null = null;
    const MAX_TURNS = 10;
    let finalSummary = '操作已完成';
    let isFirstBatch = startIndex === 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const execMsg = this.pushMsg('assistant', isFirstBatch && turn === 0 ? '正在执行操作' : '继续执行');
      const steps = currentCmds.map((c, i) => {
        if (turn === 0 && i < startIndex && this.activeTask?.steps[i]) {
          const prev = this.activeTask.steps[i];
          return {
            label: prev.label,
            ok: prev.status === 'ok' || prev.status === 'skipped' ? true : prev.status === 'failed' ? false : undefined,
          };
        }
        return { label: c.explanation ?? c.action, ok: undefined as boolean | undefined };
      });
      this.updateMsg(execMsg, { steps: [...steps], streaming: true });
      this.syncTaskStepsFromUi(steps, currentCmds);

      const batchStart = turn === 0 ? startIndex : 0;
      const paused: PausedExecution = {
        execMsg,
        steps,
        stepIndex: batchStart,
        currentCmds,
        snap: globalSnap ?? takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] }),
        globalSnap,
        turn,
        llmResultParts: [],
        errorMessage: '',
      };

      const batchResult = await this.executeCommandLoop(paused, batchStart);
      if (batchResult === 'recovery') return;
      if (batchResult === 'stopped') break;
      if (batchResult === 'failed') break;

      globalSnap = paused.snap;
      this.updateMsg(execMsg, { steps: [...steps], streaming: false });
      this.syncTaskStepsFromUi(steps, currentCmds);
      this.persistSession();

      if (this.stopRequested) {
        if (this.activeTask) {
          this.activeTask = this.markTaskInterrupted(this.activeTask);
          this.updateActiveTask({ status: 'interrupted', summary: '用户已暂停执行' });
        }
        break;
      }

      if (!isConfigured(this.settings) || paused.llmResultParts.length === 0) break;

      this.llmHistory.push({
        role: 'user',
        content: `工具执行结果（第 ${turn + 1} 轮）：\n${paused.llmResultParts.join('\n')}`,
      });
      this.setStatus('AI 分析结果，规划下一步', true);

      let followUp = '';
      for await (const chunk of streamChat(this.llmHistory, this.settings, this.skills, undefined, 'operate')) {
        followUp += chunk;
      }
      this.llmHistory.push({ role: 'assistant', content: followUp });
      this.persistSession();

      const nextCalls = parseToolCalls(followUp);
      const cleanText = stripToolCallBlocks(followUp);

      if (nextCalls && nextCalls.length > 0) {
        if (cleanText) this.pushMsg('assistant', cleanText);
        currentCmds = this.parsedToCommands(nextCalls);
        this.updateActiveTask({ steps: this.commandsToTaskSteps(currentCmds) });
      } else {
        if (cleanText) {
          this.pushMsg('assistant', cleanText);
          finalSummary = cleanText;
        }
        break;
      }
      isFirstBatch = false;
    }

    if (this.activeTask?.status === 'running') {
      this.finishTask(finalSummary);
    }

    this.visual.showScreenFrame(false);
    this.visual.scheduleHide(600);
    this.clearStatus();
    this.setBusy(false);
    this.persistSession();
  }

  private async executeCommandLoop(
    paused: PausedExecution,
    fromIndex: number,
  ): Promise<'ok' | 'recovery' | 'stopped' | 'failed'> {
    const { currentCmds, steps, execMsg, turn } = paused;
    let snap = paused.snap;

    for (let i = fromIndex; i < currentCmds.length; i++) {
      paused.stepIndex = i;
      if (this.stopRequested) return 'stopped';

      const cmd = currentCmds[i];
      this.setStatus(
        `第 ${turn + 1} 轮 · 步骤 ${i + 1}/${currentCmds.length}：${cmd.explanation ?? cmd.action}`,
        true,
      );

      const policy = checkCommandPolicy(cmd, snap, this.pack);
      if (!policy.allowed) {
        steps[i] = { label: this.stepLabel(cmd), ok: false, error: policy.reason };
        this.updateMsg(execMsg, { steps: [...steps] });
        this.syncTaskStepsFromUi(steps, currentCmds);
        this.pushInfo(`操作被拦截：${policy.reason}`);
        this.updateActiveTask({ status: 'failed', summary: policy.reason });
        return 'failed';
      }
      if (policy.requireConfirm) {
        this.pendingCmds = currentCmds.slice(i);
        this.confirmBar.removeAttribute('data-hidden');
        this.updateActiveTask({
          status: 'waiting_confirm',
          waitingFor: 'confirm',
          pendingCommands: this.pendingCmds,
        });
        this.setStatus('需要再次确认才能继续', false);
        this.setBusy(false);
        this.persistSession();
        return 'stopped';
      }

      if (cmd.action === 'api') {
        steps[i] = { label: this.stepLabel(cmd), ok: undefined };
        this.updateMsg(execMsg, { steps: [...steps] });
        try {
          const res = await executeApiCommand(cmd, this.pack);
          steps[i] = { label: this.stepLabel(cmd), ok: res.success, error: res.success ? undefined : res.message };
          paused.llmResultParts.push(`API ${cmd.apiName}: ${res.message}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : '未知错误';
          steps[i] = { label: this.stepLabel(cmd), ok: false, error: msg };
        }
        this.updateMsg(execMsg, { steps: [...steps] });
        this.syncTaskStepsFromUi(steps, currentCmds);
        continue;
      }

      const result = await executeCommand(cmd, snap, {
        overlaySelectors: this.pack.overlaySelectors ?? [],
        onBeforeAction: (c, el) => {
          if (el) {
            const ref = parseInt(el.getAttribute('data-im-ref') ?? '0', 10);
            this.visual.showTarget(el, ref, c.explanation);
            steps[i] = { label: this.stepLabel(cmd), ok: undefined };
            this.updateMsg(execMsg, { steps: [...steps] });
          }
        },
        onAfterAction: () => {
          if (cmd.action === 'click') this.visual.animateClick();
          this.visual.scheduleHide(1200);
        },
      });

      if (result.snapshot) snap = result.snapshot;
      paused.snap = snap;
      paused.globalSnap = snap;
      steps[i] = {
        label: this.stepLabel(cmd),
        ok: result.success,
        error: result.success ? undefined : result.message,
      };
      this.updateMsg(execMsg, { steps: [...steps] });
      paused.llmResultParts.push(
        `${cmd.action}: ${result.success ? result.message : '失败 — ' + result.message}`,
      );
      this.syncTaskStepsFromUi(steps, currentCmds);

      if (!result.success && cmd.action !== 'snapshot') {
        paused.errorMessage = result.message;
        this.pausedExecution = paused;
        this.showRecovery(result.message, i, currentCmds);
        return 'recovery';
      }
    }

    return 'ok';
  }

  private finishTask(summary: string): void {
    this.taskCardExpanded = false;
    this.updateActiveTask({
      status: 'completed',
      summary,
      waitingFor: undefined,
      recovery: undefined,
      pendingCommands: undefined,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private setBusy(b: boolean): void {
    this.busy = b;
    this.sendBtn.disabled = b;
    this.textarea.disabled = b;
    const stopBtn = this.panel.querySelector<HTMLButtonElement>('#im-stop-btn');
    if (stopBtn) stopBtn.classList.toggle('visible', b);
    if (!b) {
      this.stopRequested = false;
      this.textarea.focus();
    }
  }

  private requestStop(): void {
    if (!this.busy) return;
    this.stopRequested = true;
    this.abortCtrl?.abort();
    this.setStatus('用户已暂停执行', false);
    this.pushInfo('任务已暂停，可点击「继续执行」从当前步骤接着做。');
    if (this.activeTask?.status === 'running') {
      this.activeTask = this.markTaskInterrupted(this.activeTask);
      this.updateActiveTask({ status: 'interrupted', summary: '用户已暂停执行' });
    }
  }

  private parsedToCommands(parsed: ParsedAction[]): ToolCommand[] {
    return parsed.map((p) => {
      const find = parsedToFindSpec(p.find)
        ?? (p.action === 'click' && p.ref == null ? inferClickFindFromText(p.explanation) : undefined);
      return {
        action: p.action as ToolCommand['action'],
        find,
        ref: p.ref,
        inputValue: p.inputValue,
        selectValue: p.selectValue,
        navigateUrl: p.navigateUrl,
        apiName: p.apiName,
        apiArgs: p.apiArgs,
        explanation: p.explanation ?? p.action,
      };
    });
  }

  private async fakeTyping(msg: UIMessage, finalText: string): Promise<void> {
    const words = finalText.split(' ');
    let acc = '';
    for (const w of words) {
      acc += (acc ? ' ' : '') + w;
      this.updateMsg(msg, { text: acc, streaming: true });
      await new Promise((r) => setTimeout(r, 24));
    }
    this.updateMsg(msg, { text: finalText, streaming: false });
  }

  /** Public API for site packs / scripts to inject a snapshot debug dump */
  debugSnapshot(): void {
    const snap = takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
    console.group('[InterfaceMode] Snapshot');
    console.log(formatSnapshotForAgent(snap));
    console.groupEnd();
  }
}
