import type { PageSnapshot, SitePack, ToolCommand, ToolResult } from './types';
import { findElementInSnapshot } from './snapshot';

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requireConfirm?: boolean;
}

export function checkCommandPolicy(
  cmd: ToolCommand,
  snapshot: PageSnapshot | null,
  pack: SitePack,
): PolicyCheckResult {
  if (cmd.action === 'api') {
    if (!cmd.apiName || !pack.apis?.[cmd.apiName]) {
      return {
        allowed: false,
        reason: `未配置 API「${cmd.apiName ?? '?'}」。界面模式仅执行站点包中声明的能力，不做 DOM 兜底。`,
      };
    }
    return { allowed: true };
  }

  for (const rule of pack.blockedActions) {
    const when = rule.when;
    if (when.action && when.action !== cmd.action) continue;

    if (when.textContains && cmd.ref != null && snapshot) {
      const el = snapshot.elements.find((e) => e.ref === cmd.ref);
      if (el?.text.includes(when.textContains)) {
        return { allowed: false, reason: rule.reason };
      }
    }

    if (when.selector) {
      try {
        if (cmd.ref != null && snapshot) {
          const target = snapshot.elementByRef.get(cmd.ref);
          if (target?.matches(when.selector) || target?.closest(when.selector)) {
            return { allowed: false, reason: rule.reason };
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (when.find && snapshot && cmd.ref != null) {
      const target = snapshot.elements.find((e) => e.ref === cmd.ref);
      const blocked = findElementInSnapshot(snapshot, when.find);
      if (target && blocked && target.ref === blocked.ref) {
        return { allowed: false, reason: rule.reason };
      }
    }
  }

  for (const rule of pack.requireConfirm ?? []) {
    if (rule.action !== cmd.action) continue;
    if (rule.textContains && cmd.ref != null && snapshot) {
      const el = snapshot.elements.find((e) => e.ref === cmd.ref);
      if (el?.text.includes(rule.textContains)) {
        return { allowed: true, requireConfirm: true };
      }
    }
  }

  return { allowed: true };
}

export async function executeApiCommand(
  cmd: ToolCommand,
  pack: SitePack,
): Promise<ToolResult> {
  const fn = cmd.apiName ? pack.apis?.[cmd.apiName] : undefined;
  if (!fn) {
    return {
      success: false,
      message: `API「${cmd.apiName}」未在站点包中注册`,
    };
  }
  const res = await fn(cmd.apiArgs ?? {});
  return {
    success: res.success,
    message: res.message,
  };
}
