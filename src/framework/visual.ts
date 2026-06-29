import { REF_ATTR } from './types';

const OVERLAY_ID = 'im-visual-root';
const CURSOR_ID = 'im-cursor';
const COLORS = ['#3974ff', '#7c3aed', '#16a34a', '#ea580c', '#dc2626'];

export class VisualLayer {
  private root: HTMLDivElement | null = null;
  private cursor: HTMLDivElement | null = null;
  private aura: HTMLDivElement | null = null;
  private hideTimer: number | null = null;
  private cursorLabel: HTMLDivElement | null = null;

  mount(): void {
    if (this.root) return;
    injectVisualStyles();

    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.setAttribute('data-im-overlay', 'true');
    Object.assign(root.style, {
      position: 'fixed', inset: '0',
      pointerEvents: 'none', zIndex: '2147483646',
    });
    document.body.appendChild(root);
    this.root = root;

    const cursor = document.createElement('div');
    cursor.id = CURSOR_ID;
    cursor.setAttribute('data-im-overlay', 'true');
    cursor.className = 'im-cursor im-cursor--hidden';
    cursor.innerHTML = `
      <svg class="im-cursor__svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.5 3.5L20 12L13 13.5L9.5 20.5L5.5 3.5Z" fill="#3974ff" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
      <div class="im-cursor__label"></div>
    `;
    document.body.appendChild(cursor);
    this.cursor = cursor;
    this.cursorLabel = cursor.querySelector('.im-cursor__label');
  }

  /** Highlight a target element and move the virtual cursor to it */
  showTarget(el: Element, ref: number, label?: string): void {
    this.mount();
    if (!this.root) return;
    this.clearHighlights();

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const color = COLORS[ref % COLORS.length];

    // Outer glow
    const glow = document.createElement('div');
    glow.className = 'im-highlight-glow';
    glow.style.setProperty('top', `${rect.top - 6}px`);
    glow.style.setProperty('left', `${rect.left - 6}px`);
    glow.style.setProperty('width', `${rect.width + 12}px`);
    glow.style.setProperty('height', `${rect.height + 12}px`);
    glow.style.setProperty('--im-color', color);
    this.root.appendChild(glow);

    // Border box
    const box = document.createElement('div');
    box.className = 'im-highlight-box';
    box.style.setProperty('top', `${rect.top - 2}px`);
    box.style.setProperty('left', `${rect.left - 2}px`);
    box.style.setProperty('width', `${rect.width + 4}px`);
    box.style.setProperty('height', `${rect.height + 4}px`);
    box.style.setProperty('--im-color', color);
    this.root.appendChild(box);

    // Ref badge
    const badge = document.createElement('div');
    badge.className = 'im-highlight-badge';
    badge.textContent = label ? `${label}` : `ref=${ref}`;
    Object.assign(badge.style, {
      top: `${Math.max(4, rect.top - 26)}px`,
      left: `${Math.min(rect.left, window.innerWidth - 120)}px`,
      background: color,
    });
    this.root.appendChild(badge);

    // Move cursor to element center-top
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    this.moveCursor(cx, cy, label);
  }

  moveCursor(x: number, y: number, label?: string): void {
    if (!this.cursor) return;
    this.cursor.classList.add('im-cursor--visible');
    this.cursor.classList.remove('im-cursor--hidden');
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
    if (this.cursorLabel) {
      this.cursorLabel.textContent = label ?? '';
      this.cursorLabel.style.display = label ? 'block' : 'none';
    }
  }

  animateClick(): void {
    if (!this.cursor) return;
    this.cursor.classList.remove('im-cursor--clicking');
    void this.cursor.offsetWidth; // reflow
    this.cursor.classList.add('im-cursor--clicking');
  }

  showScreenFrame(active: boolean): void {
    if (!active) {
      this.aura?.remove();
      this.aura = null;
      return;
    }
    if (this.aura) return;
    const aura = document.createElement('div');
    aura.className = 'im-screen-frame';
    aura.setAttribute('data-im-overlay', 'true');
    document.body.appendChild(aura);
    this.aura = aura;
  }

  clearHighlights(): void {
    if (this.root) this.root.innerHTML = '';
  }

  scheduleHide(ms = 1000): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    if (this.hideTimer !== null) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    this.clearHighlights();
    if (this.cursor) {
      this.cursor.classList.remove('im-cursor--visible', 'im-cursor--clicking');
      this.cursor.classList.add('im-cursor--hidden');
    }
  }

  destroy(): void {
    this.root?.remove(); this.cursor?.remove(); this.aura?.remove();
    this.root = null; this.cursor = null; this.aura = null;
  }
}

export function injectVisualStyles(): void {
  if (document.getElementById('im-visual-styles')) return;
  const s = document.createElement('style');
  s.id = 'im-visual-styles';
  s.textContent = `
/* ── Virtual cursor ── */
.im-cursor {
  position: fixed;
  top: 0; left: 0;
  pointer-events: none;
  z-index: 2147483647;
  will-change: transform;
  transition: transform 0.35s cubic-bezier(.22,1,.36,1);
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.3));
}
.im-cursor--visible { opacity: 1; transition: transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.2s; }
.im-cursor--hidden  { opacity: 0; transition: transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.2s; }
.im-cursor__svg {
  width: 32px; height: 32px;
  display: block;
}
.im-cursor--clicking .im-cursor__svg {
  animation: im-cursor-click 0.36s cubic-bezier(.22,1,.36,1) forwards;
}
@keyframes im-cursor-click {
  0%   { transform: scale(1) translate(0,0); }
  30%  { transform: scale(0.75) translate(2px, 2px); }
  70%  { transform: scale(1.05) translate(-1px,-1px); }
  100% { transform: scale(1) translate(0,0); }
}
.im-cursor__label {
  position: absolute;
  left: 28px; top: 16px;
  background: #1e293b;
  color: #f8fafc;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
  font-family: system-ui, sans-serif;
  line-height: 1.4;
}

/* ── Highlight box ── */
.im-highlight-box {
  position: fixed;
  border: 2px solid var(--im-color, #3974ff);
  border-radius: 6px;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--im-color, #3974ff) 20%, transparent);
  pointer-events: none;
  animation: im-highlight-in 0.2s ease-out;
  box-sizing: border-box;
}
.im-highlight-glow {
  position: fixed;
  border-radius: 10px;
  background: color-mix(in srgb, var(--im-color, #3974ff) 12%, transparent);
  pointer-events: none;
  animation: im-glow-pulse 1.2s ease-in-out infinite;
}
@keyframes im-highlight-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes im-glow-pulse {
  0%, 100% { opacity: .6; }
  50%       { opacity: 1; }
}
.im-highlight-badge {
  position: fixed;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  font-family: system-ui, sans-serif;
  box-shadow: 0 2px 6px rgba(0,0,0,.2);
}

/* ── Screen aura (active during execution) ── */
.im-screen-frame {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483645;
  box-shadow: inset 0 0 0 3px rgba(57,116,255,.5);
  animation: im-aura 2s ease-in-out infinite;
}
@keyframes im-aura {
  0%, 100% { box-shadow: inset 0 0 0 3px rgba(57,116,255,.3); }
  50%       { box-shadow: inset 0 0 0 3px rgba(57,116,255,.6), inset 0 0 40px rgba(57,116,255,.08); }
}

[${REF_ATTR}] { /* ephemeral, no style */ }
`;
  document.head.appendChild(s);
}
