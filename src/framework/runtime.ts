import { marked } from 'marked';
import type { PageSnapshot, SitePack, ToolCommand, ToolResult } from './types';
import { executeCommand } from './executor';
import { planFromUserMessage } from './planner';
import { checkCommandPolicy, executeApiCommand } from './policy';
import { formatSnapshotForAgent, takeSnapshot } from './snapshot';
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
  type ChatMessage,
  type ParsedAction,
  parseToolCalls,
  parsedToFindSpec,
  streamChat,
  stripToolCallBlocks,
} from './transport';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'info';
  text: string;
  steps?: Array<{ label: string; ok?: boolean }>;
  streaming?: boolean;
  /** When set, render an inline "Execute" button below the bubble */
  hasPendingActions?: boolean;
}

export interface InterfaceModeConfig {
  sitePack: SitePack;
  skillsMarkdown?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Floating Panel Styles (self-contained so the panel works anywhere)
// ─────────────────────────────────────────────────────────────────────────────

const PANEL_CSS = `
:root {
  --im-blue: #3974ff;
  --im-purple: #7c3aed;
  --im-bg: #ffffff;
  --im-bg2: #f8fafc;
  --im-border: #e2e8f0;
  --im-text: #1e293b;
  --im-text2: #64748b;
  --im-radius: 14px;
  --im-shadow: 0 12px 48px rgba(0,0,0,.14), 0 2px 8px rgba(0,0,0,.08);
}

/* ── Launcher ── */
#im-launcher {
  position: fixed; bottom: 24px; right: 24px;
  width: 52px; height: 52px; border-radius: 50%;
  background: linear-gradient(135deg, var(--im-blue), var(--im-purple));
  box-shadow: 0 4px 16px rgba(57,116,255,.42);
  border: none; outline: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  z-index: 2147483640;
  transition: transform .2s, box-shadow .2s;
}
#im-launcher:hover { transform: scale(1.1); box-shadow: 0 6px 24px rgba(57,116,255,.55); }
#im-launcher svg { width: 26px; height: 26px; fill: white; display: block; }
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
  width: 380px;
  max-height: 600px;
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
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  cursor: grab; user-select: none; flex-shrink: 0;
}
.im-panel-head:active { cursor: grabbing; }
.im-panel-head-logo {
  width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, var(--im-blue), var(--im-purple));
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.im-panel-head-logo svg { width: 16px; height: 16px; fill: white; }
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
  background: linear-gradient(135deg, var(--im-blue), #2563eb);
  color: white; border-bottom-right-radius: 4px;
}
.im-msg--assistant .im-msg-bubble {
  background: var(--im-bg2); color: var(--im-text);
  border: 1px solid var(--im-border); border-bottom-left-radius: 4px;
}
.im-msg--info .im-msg-bubble {
  background: #eff6ff; color: #1d4ed8;
  border: 1px solid #bfdbfe; font-size: 12.5px;
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
  font-size: 10px; flex-shrink: 0; margin-top: 1px;
}
.im-step--ok .im-step-icon { background: #dcfce7; color: #16a34a; }
.im-step--fail .im-step-icon { background: #fee2e2; color: #dc2626; }
.im-step--pending .im-step-icon { background: #e0e7ff; color: var(--im-blue); }
.im-step--running .im-step-icon {
  background: var(--im-blue); color: white;
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
  display: flex; gap: 6px; padding: 0 14px 10px;
  flex-shrink: 0;
}
.im-mode-pill {
  padding: 4px 12px; border-radius: 20px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  border: 1.5px solid var(--im-border); background: none;
  color: var(--im-text2); transition: .15s;
}
.im-mode-pill.active {
  background: var(--im-blue); border-color: var(--im-blue); color: white;
}

/* ── Confirm bar ── */
.im-confirm-bar {
  display: flex; gap: 8px; padding: 10px 14px;
  background: #eff6ff; border-top: 1px solid #bfdbfe;
  flex-shrink: 0;
}
.im-confirm-bar[data-hidden] { display: none; }

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
  background: var(--im-blue);
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
.im-textarea:focus { border-color: var(--im-blue); background: white; }
.im-textarea::placeholder { color: #94a3b8; }
.im-input-row {
  display: flex; align-items: center; justify-content: space-between;
}
.im-send-btn {
  background: linear-gradient(135deg, var(--im-blue), var(--im-purple));
  color: white; border: none; border-radius: 8px;
  padding: 7px 18px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: opacity .15s;
}
.im-send-btn:hover { opacity: .88; }
.im-send-btn:disabled { opacity: .45; cursor: default; }

/* ── Buttons ── */
.im-btn {
  padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1.5px solid var(--im-border);
  background: white; color: var(--im-text); transition: .15s;
}
.im-btn:hover { background: var(--im-bg2); }
.im-btn--primary { background: var(--im-blue); color: white; border-color: var(--im-blue); }
.im-btn--primary:hover { opacity: .88; background: var(--im-blue); }
.im-btn--danger { background: white; color: #dc2626; border-color: #fca5a5; }
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
.im-settings-head svg { width: 18px; height: 18px; fill: var(--im-blue); }
.im-field { display: flex; flex-direction: column; gap: 5px; }
.im-field label { font-size: 12px; font-weight: 600; color: var(--im-text2); letter-spacing: .03em; text-transform: uppercase; }
.im-field input, .im-field select {
  border: 1.5px solid var(--im-border); border-radius: 8px;
  padding: 8px 12px; font-size: 13.5px; outline: none;
  font-family: inherit; color: var(--im-text); background: var(--im-bg2);
  transition: border-color .15s; width: 100%; box-sizing: border-box;
}
.im-field input:focus, .im-field select:focus { border-color: var(--im-blue); background: white; }
.im-field input[type=password] { letter-spacing: .05em; }
.im-field-hint { font-size: 11.5px; color: var(--im-text2); }
.im-settings-save {
  width: 100%; padding: 10px; border-radius: 10px;
  background: linear-gradient(135deg, var(--im-blue), var(--im-purple));
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
  background: #dc2626; color: white; border: none; border-radius: 8px;
  padding: 7px 16px; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: opacity .15s;
  display: none;
}
#im-stop-btn.visible { display: inline-block; }
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
  border-left: 3px solid var(--im-blue); margin: 6px 0;
  padding: 4px 10px; opacity: .8; font-style: italic;
}
.im-md table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0; }
.im-md th, .im-md td { border: 1px solid var(--im-border); padding: 4px 8px; text-align: left; }
.im-md th { background: var(--im-bg2); font-weight: 600; }
.im-md a { color: var(--im-blue); text-decoration: underline; }
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
  private statusBar!: HTMLDivElement;
  private statusDot!: HTMLDivElement;
  private statusText!: HTMLSpanElement;
  private noKeyBanner!: HTMLAnchorElement;

  private viewChat!: HTMLDivElement;
  private viewSettings!: HTMLDivElement;

  private uiMessages: UIMessage[] = [];
  private pendingCmds: ToolCommand[] | null = null;
  private busy = false;
  private stopRequested = false;
  private panelOpen = false;
  private abortCtrl: AbortController | null = null;

  // drag state
  private dragging = false;
  private dragStart = { x: 0, y: 0, px: 0, py: 0 };

  constructor(config: InterfaceModeConfig) {
    this.pack = config.sitePack;
    this.skills = config.skillsMarkdown;
    this.settings = loadSettings();
    this.visual.mount();
    this.buildUI();
    this.bindEvents();
    this.pushInfo(`已加载站点包「${this.pack.name}」v${this.pack.version}\n${isConfigured(this.settings) ? `AI: ${this.settings.model}` : '⚠️ 未配置 API Key，演示模式（关键词匹配）'}`);
    this.updateNoKeyBanner();
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
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" opacity=".3"/>
        <path d="M12 1C5.93 1 1 5.93 1 12s4.93 11 11 11 11-4.93 11-11S18.07 1 12 1zm0 20c-4.96 0-9-4.04-9-9s4.04-9 9-9 9 4.04 9 9-4.04 9-9 9zm1-14h-2v6h2V7zm0 8h-2v2h2v-2z"/>
      </svg>
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
          <svg viewBox="0 0 24 24"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 3a4 4 0 110 8 4 4 0 010-8zm0 10c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/></svg>
        </div>
        <div class="im-panel-head-titles">
          <div class="im-panel-head-name">InterfaceMode</div>
          <div class="im-panel-head-site">${this.pack.name}</div>
        </div>
        <div class="im-panel-head-actions">
          <button class="im-head-btn" id="im-btn-settings" title="设置" aria-label="设置">
            <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.02 7.02 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.48.48 0 00.12.6l2.03 1.58c-.05.3-.09.63-.09.95 0 .32.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.6l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          </button>
          <button class="im-head-btn" id="im-btn-close" title="关闭" aria-label="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      </div>

      <!-- Chat view -->
      <div class="im-view" id="im-view-chat">
        <a class="im-no-key-banner" id="im-no-key-banner" href="#" tabindex="0">
          ⚠️ 未配置 AI API Key，当前使用关键词演示模式。点此配置 →
        </a>
        <div class="im-messages" id="im-messages"></div>
        <div class="im-confirm-bar" id="im-confirm-bar" data-hidden="">
          <span style="font-size:13px;color:#1d4ed8;flex:1">AI 已规划操作步骤，是否执行？</span>
          <button class="im-btn im-btn--primary im-btn-sm" id="im-confirm-btn">帮我操作</button>
          <button class="im-btn im-btn-sm" id="im-cancel-btn">取消</button>
        </div>
        <div class="im-status-bar" id="im-status-bar" data-hidden="">
          <div class="im-status-dot" id="im-status-dot"></div>
          <span id="im-status-text">就绪</span>
        </div>
        <div class="im-mode-bar">
          <button class="im-mode-pill active" data-mode="interface">操作模式</button>
          <button class="im-mode-pill" data-mode="chat">问答模式</button>
        </div>
        <div class="im-input-wrap">
          <textarea class="im-textarea" id="im-textarea" rows="2" placeholder="描述你想完成的操作，例如：查看今日营收…"></textarea>
          <div class="im-input-row">
            <span style="font-size:11.5px;color:#94a3b8">Enter 发送，Shift+Enter 换行</span>
            <div style="display:flex;gap:6px;align-items:center">
              <button id="im-stop-btn" title="停止执行" aria-label="停止执行">⏹ 停止</button>
              <button class="im-send-btn" id="im-send-btn">发送</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Settings view -->
      <div class="im-view" id="im-view-settings" data-hidden="">
        <div class="im-settings" id="im-settings-form">
          <div class="im-settings-head">
            <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.02 7.02 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.48.48 0 00.12.6l2.03 1.58c-.05.3-.09.63-.09.95 0 .32.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.6l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
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
            <input type="password" id="im-key-input" placeholder="sk-…"/>
          </div>
          <div class="im-field">
            <label>模型</label>
            <select id="im-model-select"><option value="">请先选择服务商</option></select>
          </div>
          <button class="im-settings-save" id="im-save-btn">保存设置</button>
          <button class="im-btn" id="im-back-btn" style="width:100%">← 返回对话</button>
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
    this.statusBar = panel.querySelector('#im-status-bar')!;
    this.statusDot = panel.querySelector('#im-status-dot')!;
    this.statusText = panel.querySelector('#im-status-text')!;
    this.noKeyBanner = panel.querySelector('#im-no-key-banner')!;
    this.viewChat = panel.querySelector('#im-view-chat')!;
    this.viewSettings = panel.querySelector('#im-view-settings')!;

    // Pre-fill settings form
    this.fillSettingsForm();
  }

  private bindEvents(): void {
    // Launcher toggle
    this.launcher.addEventListener('click', () => this.togglePanel());

    // Close
    this.panel.querySelector('#im-btn-close')!.addEventListener('click', () => this.togglePanel(false));

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

    // Stop execution
    this.panel.querySelector('#im-stop-btn')!.addEventListener('click', () => this.requestStop());

    // Mode pills
    this.panel.querySelectorAll('.im-mode-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        this.panel.querySelectorAll('.im-mode-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
      });
    });

    // Settings form: provider change
    const providerSel = this.panel.querySelector<HTMLSelectElement>('#im-provider-select')!;
    providerSel.addEventListener('change', () => this.onProviderChange());

    // Settings save
    this.panel.querySelector('#im-save-btn')!.addEventListener('click', () => this.saveSettingsFromForm());

    // Drag
    const head = this.panel.querySelector<HTMLDivElement>('#im-panel-head')!;
    head.addEventListener('mousedown', (e) => this.startDrag(e as MouseEvent));
    document.addEventListener('mousemove', (e) => this.onDrag(e as MouseEvent));
    document.addEventListener('mouseup', () => this.endDrag());
  }

  // ── Panel visibility ───────────────────────────────────────────────────────

  private togglePanel(open?: boolean): void {
    this.panelOpen = open ?? !this.panelOpen;
    if (this.panelOpen) {
      this.panel.removeAttribute('data-hidden');
      this.launcher.classList.remove('im-has-notify');
    } else {
      this.panel.setAttribute('data-hidden', '');
    }
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

  // ── Drag ──────────────────────────────────────────────────────────────────

  private startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    this.dragging = true;
    const r = this.panel.getBoundingClientRect();
    this.dragStart = { x: e.clientX, y: e.clientY, px: r.left, py: r.top };
    this.panel.style.transition = 'none';
    e.preventDefault();
  }
  private onDrag(e: MouseEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    this.panel.style.left = `${this.dragStart.px + dx}px`;
    this.panel.style.top = `${this.dragStart.py + dy}px`;
    this.panel.style.right = 'auto';
    this.panel.style.bottom = 'auto';
  }
  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.panel.style.transition = '';
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
      el.textContent = `✓ 已配置：${this.settings.model}（${PROVIDERS[this.settings.provider]?.name ?? this.settings.provider}）`;
    } else {
      el.className = 'im-settings-status warn';
      el.textContent = '⚠ 尚未配置 API Key，助手将使用关键词演示模式';
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
        const icon = step.ok === undefined ? '●' : step.ok ? '✓' : '✗';
        stepEl.className = `im-step ${cls}`;
        stepEl.innerHTML = `<div class="im-step-icon">${icon}</div><span>${escHtml(step.label)}</span>`;
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
      runBtn.textContent = '▶ 帮我操作';
      runBtn.addEventListener('click', () => {
        runBtn.disabled = true;
        runBtn.textContent = '执行中…';
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

    // ── With LLM ────────────────────────────────────────────────────────────
    if (isConfigured(this.settings)) {
      await this.processWithLLM(userText);
    } else {
      // ── Demo / keyword-matching fallback ────────────────────────────────
      await this.processWithPlanner(userText);
    }

    this.setBusy(false);
  }

  private async processWithLLM(userText: string): Promise<void> {
    // Snapshot page and attach to user message
    const snap = takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
    const snapText = formatSnapshotForAgent(snap);
    const augmented = `${userText}\n\n---\n当前页面快照：\n${snapText}`;

    this.llmHistory.push({ role: 'user', content: augmented });

    const replyMsg = this.pushMsg('assistant', '', true); // streaming=true during LLM output
    let full = '';

    this.setStatus('AI 思考中…', true);

    this.abortCtrl = new AbortController();
    for await (const chunk of streamChat(this.llmHistory, this.settings, this.skills, this.abortCtrl.signal)) {
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
    this.setStatus('规划中…', true);
    const plan = planFromUserMessage(userText, this.pack);

    const replyMsg = this.pushMsg('assistant', '', true); // streaming=true during fake typing
    await this.fakeTyping(replyMsg, plan.reply);

    if (plan.commands && plan.commands.length > 0) {
      this.pendingCmds = plan.commands;
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
    // Remove all inline action bars to prevent double-triggering
    this.msgList.querySelectorAll('.im-msg-actions').forEach((el) => el.remove());
    void this.runCommands(cmds);
  }

  private cancelPending(): void {
    this.pendingCmds = null;
    this.confirmBar.setAttribute('data-hidden', '');
    this.msgList.querySelectorAll('.im-msg-actions').forEach((el) => el.remove());
    this.clearStatus();
    this.pushInfo('已取消操作');
  }

  /** Execute commands and loop with LLM until task is complete (agentic multi-turn). */
  private async runCommands(initialCmds: ToolCommand[]): Promise<void> {
    this.setBusy(true);
    this.visual.showScreenFrame(true);

    let currentCmds = initialCmds;
    let globalSnap: PageSnapshot | null = null;
    const MAX_TURNS = 10; // safety ceiling

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const isFirst = turn === 0;

      // ── Execute current batch ──────────────────────────────────────────────
      const execMsg = this.pushMsg('assistant', isFirst ? '正在执行操作…' : '继续执行…');
      const steps = currentCmds.map((c) => ({
        label: c.explanation ?? c.action,
        ok: undefined as boolean | undefined,
      }));
      this.updateMsg(execMsg, { steps: [...steps], streaming: true });

      let snap: PageSnapshot = globalSnap ?? takeSnapshot({ overlaySelectors: this.pack.overlaySelectors ?? [] });
      const llmResultParts: string[] = [];
      let batchFailed = false;

      for (let i = 0; i < currentCmds.length; i++) {
        // Check stop flag before each step
        if (this.stopRequested) {
          batchFailed = true;
          break;
        }

        const cmd = currentCmds[i];
        this.setStatus(
          `第 ${turn + 1} 轮 · 步骤 ${i + 1}/${currentCmds.length}：${cmd.explanation ?? cmd.action}`,
          true,
        );

        // Policy check
        const policy = checkCommandPolicy(cmd, snap, this.pack);
        if (!policy.allowed) {
          steps[i] = { label: `🚫 ${steps[i].label}（已拦截）`, ok: false };
          this.updateMsg(execMsg, { steps: [...steps] });
          this.pushInfo(`操作被拦截：${policy.reason}`);
          batchFailed = true;
          break;
        }
        if (policy.requireConfirm) {
          this.pendingCmds = currentCmds.slice(i);
          this.confirmBar.removeAttribute('data-hidden');
          this.setStatus('⚠️ 需要再次确认才能继续', false);
          batchFailed = true;
          break;
        }

        // API action
        if (cmd.action === 'api') {
          steps[i] = { label: `⏳ ${steps[i].label}`, ok: undefined };
          this.updateMsg(execMsg, { steps: [...steps] });
          try {
            const res = await executeApiCommand(cmd, this.pack);
            steps[i] = {
              label: `${steps[i].label.replace('⏳ ', '')} → ${res.message.slice(0, 80)}`,
              ok: res.success,
            };
            llmResultParts.push(`API ${cmd.apiName}: ${res.message}`);
          } catch {
            steps[i] = { label: `${steps[i].label} [错误]`, ok: false };
          }
          this.updateMsg(execMsg, { steps: [...steps] });
          continue;
        }

        // DOM action via executor
        const result = await executeCommand(cmd, snap, {
          overlaySelectors: this.pack.overlaySelectors ?? [],
          onBeforeAction: (c, el) => {
            if (el) {
              const ref = parseInt(el.getAttribute('data-im-ref') ?? '0', 10);
              this.visual.showTarget(el, ref, c.explanation);
              steps[i] = { label: `⏳ ${steps[i].label}`, ok: undefined };
              this.updateMsg(execMsg, { steps: [...steps] });
            }
          },
          onAfterAction: (_c, _res) => {
            if (cmd.action === 'click') this.visual.animateClick();
            this.visual.scheduleHide(1200);
          },
        });

        if (result.snapshot) snap = result.snapshot;
        steps[i] = { label: steps[i].label.replace('⏳ ', ''), ok: result.success };
        if (!result.success) steps[i].label += ` [${result.message}]`;
        this.updateMsg(execMsg, { steps: [...steps] });
        llmResultParts.push(
          `${cmd.action}: ${result.success ? result.message : '失败 — ' + result.message}`,
        );

        if (!result.success && cmd.action !== 'snapshot') {
          this.setStatus(`步骤失败：${result.message}`, false);
          batchFailed = true;
          break;
        }
      }

      globalSnap = snap;
      this.updateMsg(execMsg, { steps: [...steps], streaming: false });

      if (batchFailed || this.stopRequested) break;

      // ── LLM follow-up: send results, get next batch (or done) ─────────────
      if (!isConfigured(this.settings) || llmResultParts.length === 0) break;

      this.llmHistory.push({
        role: 'user',
        content: `工具执行结果（第 ${turn + 1} 轮）：\n${llmResultParts.join('\n')}`,
      });
      this.setStatus('AI 分析结果，规划下一步…', true);

      let followUp = '';
      for await (const chunk of streamChat(this.llmHistory, this.settings, this.skills)) {
        followUp += chunk;
      }
      this.llmHistory.push({ role: 'assistant', content: followUp });

      const nextCalls = parseToolCalls(followUp);
      const cleanText = stripToolCallBlocks(followUp);

      if (nextCalls && nextCalls.length > 0) {
        // More steps — display intermediate note and continue automatically
        if (cleanText) this.pushMsg('assistant', cleanText);
        currentCmds = this.parsedToCommands(nextCalls);
        // Loop to next turn
      } else {
        // No more tool calls — task finished
        if (cleanText) this.pushMsg('assistant', cleanText);
        break;
      }
    }

    this.visual.showScreenFrame(false);
    this.visual.scheduleHide(600);
    this.clearStatus();
    this.setBusy(false);
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
    // Also abort any in-progress LLM stream
    this.abortCtrl?.abort();
    this.setStatus('⏹ 用户已停止执行', false);
    this.pushInfo('操作已由用户停止。');
  }

  private parsedToCommands(parsed: ParsedAction[]): ToolCommand[] {
    return parsed.map((p) => ({
      action: p.action as ToolCommand['action'],
      find: parsedToFindSpec(p.find),
      ref: p.ref,
      inputValue: p.inputValue,
      selectValue: p.selectValue,
      navigateUrl: p.navigateUrl,
      apiName: p.apiName,
      apiArgs: p.apiArgs,
      explanation: p.explanation ?? p.action,
    }));
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
