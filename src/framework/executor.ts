import { REF_ATTR, type FindSpec, type PageSnapshot, type ToolCommand, type ToolResult } from './types';
import { findElementInSnapshot, takeSnapshot } from './snapshot';

let lastHovered: Element | null = null;

function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function focusEl(el: Element): void {
  if (el instanceof HTMLElement) {
    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch { /* */ } }
  }
}

function hoverEnter(from: Element | null, to: Element): void {
  const c = centerOf(to);
  const base = { bubbles: true, cancelable: true, composed: true, clientX: c.x, clientY: c.y };
  if (from && from !== to) {
    const fc = centerOf(from);
    const fb = { ...base, clientX: fc.x, clientY: fc.y, relatedTarget: to };
    from.dispatchEvent(new MouseEvent('mouseout', { ...fb, bubbles: true }));
    from.dispatchEvent(new MouseEvent('mouseleave', { ...fb, bubbles: false }));
  }
  to.dispatchEvent(new MouseEvent('mouseover', { ...base, relatedTarget: from }));
  to.dispatchEvent(new MouseEvent('mouseenter', { ...base, bubbles: false, relatedTarget: from }));
  try {
    to.dispatchEvent(new PointerEvent('pointerover', { ...base, bubbles: true, pointerType: 'mouse', relatedTarget: from }));
    to.dispatchEvent(new PointerEvent('pointerenter', { ...base, bubbles: false, pointerType: 'mouse', relatedTarget: from }));
  } catch { /* safari */ }
}

function dispatchClick(el: Element): void {
  const { x, y } = centerOf(el);
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
  focusEl(el);
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerType: 'mouse' }));
  } catch { /* */ }
  el.dispatchEvent(new MouseEvent('mousedown', base));
  el.dispatchEvent(new MouseEvent('mouseup', base));
  el.dispatchEvent(new MouseEvent('click', base));
}

/** Resolve element from find spec or ref, taking a fresh snapshot if find is used. */
function resolveElement(
  cmd: ToolCommand,
  snapshot: PageSnapshot | null,
  overlaySelectors: string[],
): Element | null {
  // find spec → always re-query current DOM via a fresh snapshot
  if (cmd.find) {
    const fresh = takeSnapshot({ overlaySelectors });
    const found = findElementInSnapshot(fresh, cmd.find);
    return found ? (fresh.elementByRef.get(found.ref) ?? null) : null;
  }
  if (cmd.ref == null) return null;
  // Try cached snapshot first (faster)
  if (snapshot?.elementByRef.has(cmd.ref)) return snapshot.elementByRef.get(cmd.ref)!;
  // Fall back to live DOM query
  return document.querySelector(`[${REF_ATTR}="${cmd.ref}"]`);
}

export interface ExecuteOptions {
  overlaySelectors?: string[];
  /** Called with the resolved Element RIGHT BEFORE execution — show visual here */
  onBeforeAction?: (cmd: ToolCommand, el: Element | null) => void;
  /** Called immediately after execution */
  onAfterAction?: (cmd: ToolCommand, result: ToolResult) => void;
}

export async function executeCommand(
  cmd: ToolCommand,
  priorSnapshot: PageSnapshot | null,
  options: ExecuteOptions = {},
): Promise<ToolResult> {
  const overlays = options.overlaySelectors ?? [];

  // ── snapshot ────────────────────────────────────────────────────────────────
  if (cmd.action === 'snapshot') {
    const snap = takeSnapshot({ overlaySelectors: overlays });
    const r: ToolResult = { success: true, message: `已采集 ${snap.elementCount} 个可交互元素`, snapshot: snap };
    options.onAfterAction?.(cmd, r);
    return r;
  }

  // ── goto ────────────────────────────────────────────────────────────────────
  if (cmd.action === 'goto') {
    if (!cmd.navigateUrl) return { success: false, message: '缺少 navigateUrl' };
    options.onBeforeAction?.(cmd, null);
    window.location.href = cmd.navigateUrl;
    await sleep(500);
    const snap = takeSnapshot({ overlaySelectors: overlays });
    const r: ToolResult = { success: true, message: `已导航到 ${cmd.navigateUrl}`, snapshot: snap };
    options.onAfterAction?.(cmd, r);
    return r;
  }

  // ── api ─────────────────────────────────────────────────────────────────────
  // api is handled in runtime before calling here; not reached normally
  if (cmd.action === 'api') {
    return { success: false, message: 'api 动作应由 runtime 处理' };
  }

  // ── element-based actions ────────────────────────────────────────────────────
  const el = resolveElement(cmd, priorSnapshot, overlays);
  if (!el) {
    const desc = cmd.find ? JSON.stringify(cmd.find) : `ref=${cmd.ref}`;
    const r: ToolResult = { success: false, message: `未找到元素：${desc}` };
    options.onAfterAction?.(cmd, r);
    return r;
  }

  // Show visual feedback BEFORE the action
  options.onBeforeAction?.(cmd, el);

  // Pause so the user can see the highlight + virtual cursor
  await sleep(480);

  try {
    // ── click ──────────────────────────────────────────────────────────────────
    if (cmd.action === 'click') {
      hoverEnter(lastHovered, el);
      await sleep(120);
      dispatchClick(el);
      lastHovered = el;
      await sleep(350); // let DOM settle
      const snap = takeSnapshot({ overlaySelectors: overlays });
      const r: ToolResult = { success: true, message: `已点击「${label(el)}」`, snapshot: snap };
      options.onAfterAction?.(cmd, r);
      return r;
    }

    // ── input ──────────────────────────────────────────────────────────────────
    if (cmd.action === 'input') {
      const val = cmd.inputValue ?? '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        focusEl(el);
        // Use nativeInputValueSetter if React/Vue is present (avoids synthetic event issues)
        const nativeSetter = Object.getOwnPropertyDescriptor(
          el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el instanceof HTMLElement && el.isContentEditable) {
        el.textContent = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const r: ToolResult = { success: false, message: '目标元素不支持文本输入' };
        options.onAfterAction?.(cmd, r);
        return r;
      }
      await sleep(150);
      const snap = takeSnapshot({ overlaySelectors: overlays });
      const r: ToolResult = { success: true, message: `已输入：${val.slice(0, 40)}`, snapshot: snap };
      options.onAfterAction?.(cmd, r);
      return r;
    }

    // ── select ─────────────────────────────────────────────────────────────────
    if (cmd.action === 'select') {
      if (!(el instanceof HTMLSelectElement)) {
        const r: ToolResult = { success: false, message: '目标元素不是 <select>' };
        options.onAfterAction?.(cmd, r);
        return r;
      }
      focusEl(el);
      el.value = cmd.selectValue ?? '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
      const snap = takeSnapshot({ overlaySelectors: overlays });
      const r: ToolResult = { success: true, message: `已选择：${cmd.selectValue}`, snapshot: snap };
      options.onAfterAction?.(cmd, r);
      return r;
    }

    const r: ToolResult = { success: false, message: `未知动作：${cmd.action}` };
    options.onAfterAction?.(cmd, r);
    return r;
  } catch (err) {
    const r: ToolResult = { success: false, message: err instanceof Error ? err.message : '执行失败' };
    options.onAfterAction?.(cmd, r);
    return r;
  }
}

export async function executeBatch(
  commands: ToolCommand[],
  initial: PageSnapshot | null,
  options: ExecuteOptions = {},
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  let snap = initial;
  for (const cmd of commands) {
    const r = await executeCommand(cmd, snap, options);
    results.push(r);
    if (r.snapshot) snap = r.snapshot;
    if (!r.success && cmd.action !== 'snapshot') break;
  }
  return results;
}

function label(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
}
