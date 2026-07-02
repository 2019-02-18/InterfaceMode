import { REF_ATTR, type FindSpec, type PageSnapshot, type ToolCommand, type ToolResult } from './types';
import { findElementInSnapshot, takeSnapshot } from './snapshot';
import { buildRequiredFieldsError } from './validation';

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

function isRequiredControl(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el.required) return true;
  }
  const v = el.getAttribute('aria-required');
  if (v === 'true') return true;
  if (el.hasAttribute('required')) return true;
  return false;
}

function isEmptyControl(el: Element): boolean {
  if (el instanceof HTMLSelectElement) return el.value.trim() === '';
  if (el instanceof HTMLInputElement) return el.value.trim() === '';
  if (el instanceof HTMLTextAreaElement) return el.value.trim() === '';
  return false;
}

function guessFieldLabel(control: Element): string {
  const parentLabel = control.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input,select,textarea').forEach((c) => c.remove());
    const t = clone.textContent?.trim();
    if (t) return t.slice(0, 24);
  }
  const aria = control.getAttribute('aria-label');
  if (aria) return aria.trim().slice(0, 24);
  const name = control.getAttribute('name');
  if (name) return name.trim().slice(0, 24);
  return '未命名字段';
}

function validateRequiredBeforeSubmit(buttonEl: Element): string[] {
  // Generic heuristic: if this click is likely a submit/save, validate required fields in the closest dialog/form.
  const btnText = (buttonEl.textContent ?? '').trim();
  const looksLikeSubmit =
    (buttonEl instanceof HTMLButtonElement && (buttonEl.type === 'submit' || buttonEl.getAttribute('type') === 'submit')) ||
    /(保存|提交|确认|发送|创建|更新|完成)/.test(btnText);
  if (!looksLikeSubmit) return [];

  const scope =
    buttonEl.closest('form') ??
    buttonEl.closest('[role="dialog"]') ??
    buttonEl.closest('.dialog') ??
    buttonEl.closest('.overlay');
  if (!scope) return [];

  const requiredControls = Array.from(scope.querySelectorAll('input,select,textarea')).filter(isRequiredControl);
  const missing = requiredControls.filter(isEmptyControl).map(guessFieldLabel);
  // De-duplicate labels while preserving order
  return missing.filter((x, i) => missing.indexOf(x) === i);
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
      const missing = validateRequiredBeforeSubmit(el);
      if (missing.length) {
        const r: ToolResult = { success: false, message: buildRequiredFieldsError(missing) };
        options.onAfterAction?.(cmd, r);
        return r;
      }
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
      const want = (cmd.selectValue ?? '').trim();

      // If no selectValue is provided, pick the first non-empty option.
      if (!want) {
        const candidate = Array.from(el.options).find((o) => !o.disabled && o.value.trim() !== '');
        if (!candidate) {
          const r: ToolResult = { success: false, message: '下拉框没有可选项' };
          options.onAfterAction?.(cmd, r);
          return r;
        }
        el.value = candidate.value;
      } else if (Array.from(el.options).some((o) => o.value === want)) {
        // Prefer matching by option.value
        el.value = want;
      } else {
        // Fallback: match by visible option text (contains)
        const byText = Array.from(el.options).find((o) => o.text.trim().includes(want));
        if (!byText) {
          const r: ToolResult = {
            success: false,
            message: `下拉框没有匹配项：${want}`,
          };
          options.onAfterAction?.(cmd, r);
          return r;
        }
        el.value = byText.value;
      }

      // Fire both input + change to satisfy different frameworks
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);

      if (!el.value.trim()) {
        const r: ToolResult = { success: false, message: '下拉框选择失败，值仍为空' };
        options.onAfterAction?.(cmd, r);
        return r;
      }

      const snap = takeSnapshot({ overlaySelectors: overlays });
      const selected = el.options[el.selectedIndex]?.text?.trim() ?? el.value;
      const r: ToolResult = { success: true, message: `已选择：${selected}`, snapshot: snap };
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
