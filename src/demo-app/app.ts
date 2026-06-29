/**
 * 测试商户后台 — 演示业务应用
 *
 * 刻意约束：
 * - 无 data-testid / data-im-ref / automation hook
 * - 普通 class 命名、嵌套 DOM、hash 路由
 * - 部分操作仅能通过站点包 API 完成（如今日营收）
 */

export type ViewId = 'dashboard' | 'orders' | 'settings';

export interface Order {
  id: string;
  customer: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface AppState {
  view: ViewId;
  orders: Order[];
  revenueToday: number;
  orderCountToday: number;
  dialogOpen: boolean;
}

const state: AppState = {
  view: 'dashboard',
  orders: [
    { id: 'ORD-240601', customer: '杭州某茶', amount: 1280, status: '已完成', createdAt: '2026-06-29 09:12' },
    { id: 'ORD-240602', customer: '深圳某科技', amount: 5600, status: '待发货', createdAt: '2026-06-29 10:45' },
  ],
  revenueToday: 18420,
  orderCountToday: 7,
  dialogOpen: false,
};

let toastTimer: number | null = null;

function showToast(msg: string): void {
  const el = document.getElementById('global-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-show');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-show'), 2800);
}

function formatMoney(n: number): string {
  return `¥${n.toLocaleString('zh-CN')}`;
}

function getViewFromHash(): ViewId {
  const h = window.location.hash.replace('#', '') || 'dashboard';
  if (h === 'orders' || h === 'settings') return h;
  return 'dashboard';
}

function setView(view: ViewId): void {
  state.view = view;
  window.location.hash = view;
  render();
}

function renderDashboard(): string {
  return `
    <div class="card">
      <h2>经营概览</h2>
      <div class="stat-row">
        <div class="stat-box">
          <div class="lbl">今日营收</div>
          <div class="val" id="stat-revenue">${formatMoney(state.revenueToday)}</div>
        </div>
        <div class="stat-box">
          <div class="lbl">今日订单</div>
          <div class="val">${state.orderCountToday}</div>
        </div>
        <div class="stat-box">
          <div class="lbl">待处理</div>
          <div class="val">${state.orders.filter((o) => o.status === '待发货').length}</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>快捷说明</h2>
      <p style="margin:0;color:#64748b;line-height:1.6">
        本后台为 InterfaceMode 演示环境。订单创建走界面操作流程；
        「查看今日营收」走站点包 API，未配置则无法通过界面模式查询。
      </p>
    </div>
  `;
}

function renderOrders(): string {
  const rows = state.orders
    .map(
      (o) => `
      <tr class="tbl-row">
        <td>${o.id}</td>
        <td>${o.customer}</td>
        <td>${formatMoney(o.amount)}</td>
        <td>${o.status}</td>
        <td>${o.createdAt}</td>
      </tr>`,
    )
    .join('');

  return `
    <div class="card">
      <h2>订单管理</h2>
      <div class="toolbar">
        <button type="button" class="btn btn--solid js-open-order-form">
          <span>新建订单</span>
        </button>
        <button type="button" class="btn js-refresh-list">刷新列表</button>
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>单号</th>
            <th>客户</th>
            <th>金额</th>
            <th>状态</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSettings(): string {
  return `
    <div class="card">
      <h2>门店信息</h2>
      <div class="form-grid">
        <label>
          门店名称
          <input type="text" value="测试演示店" readonly />
        </label>
        <label>
          联系手机
          <input type="text" value="138****8821" readonly />
        </label>
      </div>
      <div class="danger-block" id="merchant-danger-zone">
        <h3>危险操作</h3>
        <p style="margin:0 0 12px;font-size:13px;color:#742a2a">
          注销后将清除所有经营数据，且不可恢复。
        </p>
        <button type="button" class="btn btn--danger js-delete-merchant">
          注销商户账号
        </button>
      </div>
    </div>
  `;
}

function renderDialog(): string {
  if (!state.dialogOpen) return '';
  return `
    <div class="overlay" id="order-overlay" role="presentation">
      <div class="dialog" role="dialog" aria-labelledby="dlg-title">
        <div class="dialog__head" id="dlg-title">填写订单信息</div>
        <div class="dialog__body">
          <div class="form-grid">
            <label>
              客户名称
              <input type="text" name="customer" placeholder="请输入客户名称" />
            </label>
            <label>
              订单金额（元）
              <input type="number" name="amount" min="1" placeholder="0" />
            </label>
            <label>
              备注
              <textarea name="note" placeholder="选填"></textarea>
            </label>
          </div>
        </div>
        <div class="dialog__foot">
          <button type="button" class="btn js-close-dialog">取消</button>
          <button type="button" class="btn btn--solid js-submit-order">提交订单</button>
        </div>
      </div>
    </div>
  `;
}

function renderNav(): void {
  document.querySelectorAll('.mch-side__nav a').forEach((a) => {
    const href = (a as HTMLAnchorElement).getAttribute('href')?.replace('#', '');
    a.classList.toggle('is-on', href === state.view);
  });
}

function renderCrumb(): void {
  const map: Record<ViewId, string> = {
    dashboard: '首页 / 经营概览',
    orders: '交易 / 订单管理',
    settings: '系统 / 门店设置',
  };
  const el = document.querySelector('.mch-top__crumb');
  if (el) el.textContent = map[state.view];
}

function renderMain(): void {
  const host = document.getElementById('mch-view-host');
  if (!host) return;
  let html = '';
  if (state.view === 'dashboard') html = renderDashboard();
  else if (state.view === 'orders') html = renderOrders();
  else html = renderSettings();
  host.innerHTML = html;

  const existing = document.getElementById('order-overlay');
  existing?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderDialog();
  const dialog = wrapper.firstElementChild;
  if (dialog) document.body.appendChild(dialog);

  bindViewEvents();
}

function bindViewEvents(): void {
  document.querySelector('.js-open-order-form')?.addEventListener('click', () => {
    state.dialogOpen = true;
    renderMain();
  });

  document.querySelector('.js-close-dialog')?.addEventListener('click', () => {
    state.dialogOpen = false;
    renderMain();
  });

  document.querySelector('.js-refresh-list')?.addEventListener('click', () => {
    showToast('列表已刷新');
  });

  document.querySelector('.js-submit-order')?.addEventListener('click', () => {
    const customer = (document.querySelector('input[name="customer"]') as HTMLInputElement)?.value.trim();
    const amount = Number((document.querySelector('input[name="amount"]') as HTMLInputElement)?.value);
    if (!customer || !amount) {
      showToast('请填写客户名称和金额');
      return;
    }
    const id = `ORD-${Date.now().toString().slice(-6)}`;
    state.orders.unshift({
      id,
      customer,
      amount,
      status: '待发货',
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    });
    state.orderCountToday += 1;
    state.revenueToday += amount;
    state.dialogOpen = false;
    renderMain();
    showToast(`订单 ${id} 已创建`);
  });

  document.querySelector('.js-delete-merchant')?.addEventListener('click', () => {
    showToast('该操作需商户主账号短信验证（演示环境不执行）');
  });
}

function render(): void {
  renderNav();
  renderCrumb();
  renderMain();
}

export function mountDemoApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="mch-shell">
      <aside class="mch-side">
        <div class="mch-side__brand">测试商户中心</div>
        <ul class="mch-side__nav">
          <li><a href="#dashboard">经营概览</a></li>
          <li><a href="#orders">订单管理</a></li>
          <li><a href="#settings">门店设置</a></li>
        </ul>
      </aside>
      <div class="mch-main">
        <header class="mch-top">
          <div class="mch-top__crumb">首页</div>
          <div class="mch-top__user">店员：演示账号</div>
        </header>
        <main class="mch-body" id="mch-view-host"></main>
      </div>
    </div>
    <div class="toast" id="global-toast" role="status"></div>
  `;

  state.view = getViewFromHash();
  window.addEventListener('hashchange', () => {
    state.view = getViewFromHash();
    render();
  });

  root.querySelectorAll('.mch-side__nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const v = (a as HTMLAnchorElement).getAttribute('href')?.replace('#', '') as ViewId;
      setView(v);
    });
  });

  render();
}

export function getTodayRevenue(): { revenue: number; orders: number } {
  return { revenue: state.revenueToday, orders: state.orderCountToday };
}
