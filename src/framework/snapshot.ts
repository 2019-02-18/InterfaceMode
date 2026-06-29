import { REF_ATTR, type PageSnapshot, type SnapshotElement } from './types';

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'textbox',
  'combobox',
  'option',
]);

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'LINK',
  'META',
  'HEAD',
  'SVG',
  'PATH',
]);

let refCounter = 0;

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isDisabled(el: Element): boolean {
  if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
    return el.disabled;
  }
  return el.getAttribute('aria-disabled') === 'true';
}

function getRole(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  return undefined;
}

function getLabel(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const title = el.getAttribute('title');
  if (title) return title.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent) return labelEl.textContent.trim().slice(0, 80);
  }
  if (el.id) {
    const labelFor = document.querySelector(`label[for="${el.id}"]`);
    if (labelFor?.textContent) return labelFor.textContent.trim().slice(0, 80);
  }
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input,select,textarea').forEach((c) => c.remove());
    const t = clone.textContent?.trim();
    if (t) return t.slice(0, 80);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder.trim();
    if (el.value) return el.value.trim();
  }
  if (el instanceof HTMLSelectElement) {
    return el.options[el.selectedIndex]?.text?.trim() ?? '';
  }
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent?.trim() ?? '')
    .join(' ')
    .trim();
  if (text) return text.slice(0, 80);
  return (el.textContent ?? '').trim().slice(0, 80);
}

function isInteractive(el: Element): boolean {
  // Labels are NOT listed here — their associated inputs handle interaction.
  // Including labels causes findElementInSnapshot to return the label before
  // its inner <input> in DOM order, breaking the "input" action.
  const role = getRole(el);
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== '-1') return true;
  if (el.hasAttribute('onclick')) return true;
  return false;
}

function shouldSkip(el: Element, overlaySelectors: string[]): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.closest('[data-im-overlay]')) return true;
  for (const sel of overlaySelectors) {
    try {
      if (el.closest(sel)) return true;
    } catch {
      /* invalid selector */
    }
  }
  return false;
}

function collectAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const name of ['id', 'class', 'role', 'aria-label', 'name', 'type', 'href']) {
    const v = el.getAttribute(name);
    if (v) attrs[name] = v.slice(0, 120);
  }
  return attrs;
}

function clearRefs(root: ParentNode): void {
  root.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => el.removeAttribute(REF_ATTR));
}

function buildTreeLine(el: Element, indent: number, lines: string[], overlaySelectors: string[]): void {
  if (shouldSkip(el, overlaySelectors) && el !== document.body) return;
  const pad = '  '.repeat(indent);
  const ref = el.getAttribute(REF_ATTR);
  const role = getRole(el);
  const label = getLabel(el);
  const parts: string[] = [];
  if (role) parts.push(role);
  if (!isDisabled(el) && isVisible(el) && ref) parts.push('[cursor=pointer]');
  if (ref) parts.push(`[ref=${ref}]`);
  const meta = parts.length ? ` ${parts.join(' ')}` : '';
  const suffix = label ? `: ${label}` : '';
  if (ref || el === document.body || el.children.length > 0) {
    lines.push(`${pad}- ${el.tagName.toLowerCase()}${meta}${suffix}`);
  }
  for (const child of el.children) {
    buildTreeLine(child, indent + 1, lines, overlaySelectors);
  }
}

export interface SnapshotOptions {
  overlaySelectors?: string[];
}

export function takeSnapshot(options: SnapshotOptions = {}): PageSnapshot {
  const overlaySelectors = options.overlaySelectors ?? [];
  clearRefs(document.body);

  const elements: SnapshotElement[] = [];
  const elementByRef = new Map<number, Element>();
  refCounter = 0;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode as Element;

  while (node) {
    if (!shouldSkip(node, overlaySelectors) && isInteractive(node) && isVisible(node)) {
      refCounter += 1;
      const ref = refCounter;
      node.setAttribute(REF_ATTR, String(ref));
      const rect = node.getBoundingClientRect();
      elements.push({
        ref,
        tagName: node.tagName.toLowerCase(),
        text: getLabel(node),
        role: getRole(node),
        attributes: collectAttributes(node),
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        isVisible: true,
        isDisabled: isDisabled(node),
      });
      elementByRef.set(ref, node);
    }
    node = walker.nextNode() as Element;
  }

  const lines: string[] = [];
  buildTreeLine(document.body, 0, lines, overlaySelectors);

  return {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    elementCount: elements.length,
    treeSnapshot: lines.join('\n'),
    elements,
    elementByRef,
  };
}

export function formatSnapshotForAgent(snapshot: PageSnapshot): string {
  const header = `URL: ${snapshot.url}\nTitle: ${snapshot.title}\nElements: ${snapshot.elementCount}\n`;
  return `${header}\`\`\`yaml\n${snapshot.treeSnapshot}\n\`\`\``;
}

const INPUT_TAGS = new Set(['input', 'textarea', 'select']);

export function findElementInSnapshot(
  snapshot: PageSnapshot,
  spec: { text?: string; textContains?: string; role?: string; tagName?: string; selector?: string },
): SnapshotElement | undefined {
  if (spec.selector) {
    const el = document.querySelector(spec.selector);
    if (el) {
      const ref = el.getAttribute(REF_ATTR);
      if (ref) return snapshot.elements.find((e) => e.ref === Number(ref));
    }
  }

  const matches = snapshot.elements.filter((e) => {
    if (e.isDisabled) return false;
    if (spec.role && e.role !== spec.role) return false;
    if (spec.tagName && e.tagName !== spec.tagName.toLowerCase()) return false;
    if (spec.text && e.text !== spec.text) return false;
    if (spec.textContains && !e.text.includes(spec.textContains)) return false;
    return true;
  });

  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  // When multiple elements share the same label text (label + its inner input),
  // prefer the actual form control over any containing element.
  const formControl = matches.find((e) => INPUT_TAGS.has(e.tagName));
  return formControl ?? matches[0];
}
