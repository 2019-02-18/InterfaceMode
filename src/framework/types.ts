/**
 * InterfaceMode — 通用界面模式框架类型定义
 * 站点包通过 SitePack 注入策略与能力，框架负责 snapshot / 执行 / 视觉反馈
 */

export const REF_ATTR = 'data-im-ref';

export type ToolAction =
  | 'snapshot'
  | 'click'
  | 'input'
  | 'select'
  | 'scroll'
  | 'goto'
  | 'api';

export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SnapshotElement {
  ref: number;
  tagName: string;
  text: string;
  role?: string;
  attributes: Record<string, string>;
  rect: ElementRect;
  isVisible: boolean;
  isDisabled: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  timestamp: number;
  elementCount: number;
  treeSnapshot: string;
  elements: SnapshotElement[];
  elementByRef: Map<number, Element>;
}

export interface ToolCommand {
  action: ToolAction;
  ref?: number;
  /** 执行时优先用最新 snapshot 重新解析 */
  find?: FindSpec;
  inputValue?: string;
  selectValue?: string;
  navigateUrl?: string;
  apiName?: string;
  apiArgs?: Record<string, unknown>;
  /** 自然语言说明，用于 UI 展示 */
  explanation?: string;
}

export interface ToolResult {
  success: boolean;
  message: string;
  snapshot?: PageSnapshot;
}

export interface FindSpec {
  text?: string;
  textContains?: string;
  role?: string;
  tagName?: string;
  /** CSS 选择器仅用于站点包内显式声明，框架不鼓励 demo 页预埋 */
  selector?: string;
}

export interface PlaybookStep {
  tool: Exclude<ToolAction, 'api'> | 'api';
  find?: FindSpec;
  ref?: number;
  inputValue?: string;
  selectValue?: string;
  navigateUrl?: string;
  apiName?: string;
  apiArgs?: Record<string, unknown>;
  explanation?: string;
}

export interface Playbook {
  id: string;
  description: string;
  triggers: string[];
  steps: PlaybookStep[];
}

export interface BlockedActionRule {
  id: string;
  reason: string;
  when: {
    action?: ToolAction;
    find?: FindSpec;
    selector?: string;
    textContains?: string;
  };
}

export interface SitePack {
  siteId: string;
  name: string;
  version: string;
  /** 注入到 Agent 的操作文档（Markdown） */
  skillsMarkdown: string;
  /** 演示用：关键词触发的预置流程；生产环境由 LLM + skills 动态生成 tool call */
  playbooks?: Playbook[];
  blockedActions: BlockedActionRule[];
  /** 注册的可调用 API（无 API 配置则不可用，不做 DOM 兜底） */
  apis?: Record<
    string,
    (args: Record<string, unknown>) => Promise<{ success: boolean; message: string; data?: unknown }>
  >;
  /** snapshot 时排除的容器选择器（如助手自身 UI） */
  overlaySelectors?: string[];
  /** 执行前需用户确认的操作 */
  requireConfirm?: Array<{ action: ToolAction; textContains?: string }>;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  toolSteps?: Array<{ command: ToolCommand; result?: ToolResult }>;
}

export interface InterfaceModeConfig {
  sitePack: SitePack;
  /** 生产环境替换为 SSE / WebSocket transport */
  onExecuteTools?: (commands: ToolCommand[]) => Promise<ToolResult[]>;
  container?: HTMLElement;
}
