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

export interface SitePackTheme {
  accent?: string;
  accent2?: string;
  danger?: string;
  warning?: string;
  success?: string;
}

export interface SitePackCapability {
  id: string;
  label: string;
  description?: string;
  apis?: string[];
}

export interface SitePackEntrypoint {
  id: string;
  label: string;
  description?: string;
  triggers?: string[];
  playbookId?: string;
  route?: string;
}

export interface SitePackRoute {
  path: string;
  title?: string;
  description?: string;
}

export interface SitePackPermission {
  id: string;
  scope: string;
  description?: string;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface SitePackRiskPolicy {
  id: string;
  level: RiskLevel;
  reason?: string;
  when: {
    action?: ToolAction;
    textContains?: string;
    apiName?: string;
  };
  blocked?: boolean;
  requireConfirm?: boolean;
}

export interface SitePack {
  siteId: string;
  name: string;
  version: string;
  /** 注入到 Agent 的操作文档（Markdown） */
  skillsMarkdown: string;
  /** 标准操作流程；匹配用户意图时优先于 LLM 自由规划 */
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
  /** 产品级主题色，覆盖助手默认 CSS 变量 */
  theme?: SitePackTheme;
  /** 声明站点可提供的能力（文档/权限边界） */
  capabilities?: SitePackCapability[];
  /** 产品入口：可从宿主页或助手内触发 */
  entrypoints?: SitePackEntrypoint[];
  /** 路由/页面说明，供 Agent 理解站点结构 */
  routes?: SitePackRoute[];
  /** 权限范围声明 */
  permissions?: SitePackPermission[];
  /** 分级风险策略（补充 blockedActions / requireConfirm） */
  riskPolicies?: SitePackRiskPolicy[];
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
