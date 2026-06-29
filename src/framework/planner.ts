import type { PageSnapshot, Playbook, PlaybookStep, SitePack, ToolCommand } from './types';
import { findElementInSnapshot, takeSnapshot } from './snapshot';

export function matchPlaybook(userText: string, pack: SitePack): Playbook | undefined {
  const normalized = userText.trim().toLowerCase();
  return pack.playbooks?.find((pb) =>
    pb.triggers.some((t) => normalized.includes(t.toLowerCase())),
  );
}

export function resolvePlaybookSteps(
  playbook: Playbook,
  initialSnapshot: PageSnapshot,
): { commands: ToolCommand[]; errors: string[] } {
  const commands: ToolCommand[] = [];
  const errors: string[] = [];
  let currentSnap = initialSnapshot;

  for (const step of playbook.steps) {
    if (step.find || step.tool === 'snapshot') {
      currentSnap = takeSnapshot();
    }
    const cmd = stepToCommand(step, currentSnap);
    if ('error' in cmd) {
      errors.push(cmd.error);
      break;
    }
    commands.push(cmd.command);
  }

  return { commands, errors };
}

function stepToCommand(
  step: PlaybookStep,
  snapshot: PageSnapshot,
): { command: ToolCommand } | { error: string } {
  if (step.tool === 'api') {
    return {
      command: {
        action: 'api',
        apiName: step.apiName,
        apiArgs: step.apiArgs,
        explanation: step.explanation,
      },
    };
  }

  if (step.tool === 'snapshot') {
    return { command: { action: 'snapshot', explanation: step.explanation } };
  }

  if (step.tool === 'goto' && step.navigateUrl) {
    return {
      command: {
        action: 'goto',
        navigateUrl: step.navigateUrl,
        explanation: step.explanation,
      },
    };
  }

  let ref = step.ref;
  if (step.find) {
    const found = findElementInSnapshot(snapshot, step.find);
    if (!found) {
      return { error: `未在页面中找到：${JSON.stringify(step.find)}` };
    }
    ref = found.ref;
  }

  if (ref == null) {
    return { error: `步骤缺少 ref 或 find：${step.explanation ?? step.tool}` };
  }

  return {
    command: {
      action: step.tool,
      ref,
      find: step.find,
      inputValue: step.inputValue,
      selectValue: step.selectValue,
      explanation: step.explanation,
    },
  };
}

export function planFromUserMessage(
  userText: string,
  pack: SitePack,
): { playbook?: Playbook; commands?: ToolCommand[]; errors: string[]; reply: string } {
  const snapshot = takeSnapshot({ overlaySelectors: pack.overlaySelectors });
  const playbook = matchPlaybook(userText, pack);

  if (!playbook) {
    return {
      errors: [],
      reply:
        '未匹配到已配置的流程。请在站点包中添加 playbook，或由 Agent 根据 skills 动态规划。未配置 API 的能力不会自动 DOM 兜底。',
    };
  }

  const { commands, errors } = resolvePlaybookSteps(playbook, snapshot);
  if (errors.length) {
    return {
      playbook,
      errors,
      reply: `流程「${playbook.description}」规划失败：${errors.join('；')}`,
    };
  }

  return {
    playbook,
    commands: [{ action: 'snapshot', explanation: '操作前采集页面' }, ...commands],
    errors: [],
    reply: `将执行流程「${playbook.description}」，共 ${commands.length + 1} 步。需要我自动操作吗？`,
  };
}
