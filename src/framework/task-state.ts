import type { AssistantMode, ChatMessage } from './transport';
import type { ToolCommand } from './types';

export type TaskStatus =
  | 'planning'
  | 'waiting_confirm'
  | 'running'
  | 'interrupted'
  | 'waiting_recovery'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

export interface TaskStep {
  id: string;
  label: string;
  command: ToolCommand;
  status: TaskStepStatus;
  result?: string;
}

export interface TaskRecovery {
  failedStepIndex: number;
  errorMessage: string;
  remainingCommands: ToolCommand[];
  /** 目标元素不在当前页面（常见于弹窗已关闭） */
  contextLost?: boolean;
  /** 提交前校验发现未填写的必填项（框架通用，非站点绑定） */
  missingRequiredFields?: string[];
}

export interface TaskState {
  id: string;
  goal: string;
  status: TaskStatus;
  plan?: string;
  steps: TaskStep[];
  currentStepIndex: number;
  pendingCommands?: ToolCommand[];
  waitingFor?: 'confirm' | 'recovery';
  recovery?: TaskRecovery;
  summary?: string;
  url: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedSession {
  task: TaskState | null;
  llmHistory: ChatMessage[];
  mode: AssistantMode;
}

let _taskSeq = 0;

export function createTaskId(): string {
  return `task-${Date.now()}-${++_taskSeq}`;
}

export function createTaskStep(command: ToolCommand, index: number): TaskStep {
  return {
    id: `step-${index}`,
    label: command.explanation ?? command.action,
    command,
    status: 'pending',
  };
}

export function createTask(goal: string): TaskState {
  const now = Date.now();
  return {
    id: createTaskId(),
    goal,
    status: 'planning',
    steps: [],
    currentStepIndex: 0,
    url: typeof location !== 'undefined' ? location.href : '',
    createdAt: now,
    updatedAt: now,
  };
}

export function touchTask(task: TaskState, patch: Partial<TaskState>): TaskState {
  return { ...task, ...patch, updatedAt: Date.now() };
}

export function taskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    planning: '规划中',
    waiting_confirm: '等待确认',
    running: '执行中',
    interrupted: '已中断',
    waiting_recovery: '等待恢复',
    completed: '已完成',
    failed: '已失败',
    cancelled: '已取消',
  };
  return labels[status];
}

export function sessionStorageKey(siteId: string): string {
  return `im:${siteId}:session`;
}

export function loadSession(siteId: string): PersistedSession | null {
  try {
    const raw = sessionStorage.getItem(sessionStorageKey(siteId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    sessionStorage.removeItem(sessionStorageKey(siteId));
    return null;
  }
}

export function saveSession(siteId: string, session: PersistedSession): void {
  sessionStorage.setItem(sessionStorageKey(siteId), JSON.stringify(session));
}

export function clearSession(siteId: string): void {
  sessionStorage.removeItem(sessionStorageKey(siteId));
}
