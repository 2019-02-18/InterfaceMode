/**
 * 测试商户后台 — 演示业务应用
 *
 * 刻意约束：
 * - 无 data-testid / data-im-ref / automation hook
 * - 普通 class 命名、嵌套 DOM、hash 路由
 * - 部分操作仅能通过站点包 API 完成（如今日营收）
 */

export type ViewId =
  | 'dashboard'
  | 'orders'
  | 'customers'
  | 'products'
  | 'refunds'
  | 'billing'
  | 'admin'
  | 'settings';

export interface Order {
  id: string;
  customer: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  tier: '标准' | '企业' | 'VIP';
  contact: string;
  createdAt: string;
}

export interface Product {
  sku: string;
  name: string;
  price: number;
  stock: number;
  status: '上架' | '下架';
}

export interface RefundRequest {
  id: string;
  orderId: string;
  customer: string;
  amount: number;
  reason: string;
  status: '待审核' | '已通过' | '已拒绝';
  createdAt: string;
}

export interface UserAccount {
  id: string;
  name: string;
  role: '管理员' | '运营' | '客服' | '财务';
  email: string;
  status: '启用' | '禁用';
}

interface AppState {
  view: ViewId;
  customers: Customer[];
  products: Product[];
  orders: Order[];
  refunds: RefundRequest[];
  users: UserAccount[];
  revenueToday: number;
  orderCountToday: number;
  modal:
    | null
    | { kind: 'createOrder' }
    | { kind: 'createCustomer' }
    | { kind: 'createProduct' }
    | { kind: 'editOrder'; orderId: string }
    | { kind: 'editCustomer'; customerId: string }
    | { kind: 'editProduct'; sku: string }
    | { kind: 'refundReview'; refundId: string }
    | { kind: 'issueInvoice'; orderId: string }
    | { kind: 'inviteUser' }
    | { kind: 'confirmDelete'; entity: 'order' | 'customer' | 'product'; id: string; label: string };
}

const state: AppState = {
  view: 'dashboard',
  customers: [
    { id: 'CST-1001', name: '杭州某茶', tier: '企业', contact: '王** 138****1001', createdAt: '2026-06-12 14:10' },
    { id: 'CST-1002', name: '深圳某科技', tier: 'VIP', contact: '李** 188****2032', createdAt: '2026-06-18 09:44' },
    { id: 'CST-1003', name: '成都某文创', tier: '标准', contact: '周** 136****5531', createdAt: '2026-06-22 16:07' },
  ],
  products: [
    { sku: 'SKU-NEB-001', name: 'Nebula 云基础版', price: 199, stock: 9999, status: '上架' },
    { sku: 'SKU-NEB-002', name: 'Nebula 云专业版', price: 599, stock: 5000, status: '上架' },
    { sku: 'SKU-SVC-001', name: '上门实施服务', price: 9800, stock: 30, status: '下架' },
  ],
  orders: [
    { id: 'ORD-240601', customer: '杭州某茶', amount: 1280, status: '已完成', createdAt: '2026-06-29 09:12' },
    { id: 'ORD-240602', customer: '深圳某科技', amount: 5600, status: '待发货', createdAt: '2026-06-29 10:45' },
  ],
  revenueToday: 18420,
  orderCountToday: 7,
  refunds: [
    { id: 'RFD-77001', orderId: 'ORD-240602', customer: '深圳某科技', amount: 1200, reason: '重复下单', status: '待审核', createdAt: '2026-06-30 11:02' },
    { id: 'RFD-77002', orderId: 'ORD-240601', customer: '杭州某茶', amount: 300, reason: '部分商品破损', status: '已通过', createdAt: '2026-06-30 16:20' },
  ],
  users: [
    { id: 'USR-01', name: '演示账号', role: '运营', email: 'demo@nebula.local', status: '启用' },
    { id: 'USR-02', name: '财务同事', role: '财务', email: 'finance@nebula.local', status: '启用' },
  ],
  modal: null,
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
  const allowed: ViewId[] = ['dashboard', 'orders', 'customers', 'products', 'refunds', 'billing', 'admin', 'settings'];
  if ((allowed as string[]).includes(h)) return h as ViewId;
  return 'dashboard';
}

function setView(view: ViewId): void {
  state.view = view;
  window.location.hash = view;
  render();
}

function renderDashboard(): string {
  const pendingShip = state.orders.filter((o) => o.status === '待发货').length;
  const pendingRefund = state.refunds.filter((r) => r.status === '待审核').length;
  const lowStock = state.products.filter((p) => p.status === '上架' && p.stock < 50).length;
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
          <div class="val">${pendingShip}</div>
          <div class="sub">待发货</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>运营待办</h2>
      <div class="stat-row" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-box">
          <div class="lbl">退款审核</div>
          <div class="val">${pendingRefund}</div>
        </div>
        <div class="stat-box">
          <div class="lbl">低库存预警</div>
          <div class="val">${lowStock}</div>
        </div>
        <div class="stat-box">
          <div class="lbl">活跃客户</div>
          <div class="val">${state.customers.length}</div>
        </div>
      </div>
      <p style="margin:12px 0 0;color:#64748b;line-height:1.6">
        这是一个更接近 SaaS 后台的演示：包含客户、商品、订单、退款、开票、成员与权限等模块，并刻意使用普通 DOM 结构（无自动化专用标记）。
      </p>
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
        <td>
          <button type="button" class="btn btn--sm js-edit-order" data-order-id="${o.id}">编辑</button>
          <button type="button" class="btn btn--sm btn--danger js-delete-order" data-order-id="${o.id}">删除</button>
        </td>
      </tr>`,
    )
    .join('');

  return `
    <div class="card">
      <h2>订单管理</h2>
      <div class="toolbar">
        <button type="button" class="btn btn--solid js-open-order-form"><span>新建订单</span></button>
        <button type="button" class="btn js-issue-invoice"><span>开票</span></button>
        <button type="button" class="btn js-mark-shipped"><span>标记发货</span></button>
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
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderCustomers(): string {
  const rows = state.customers.map((c) => `
    <tr class="tbl-row">
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${c.tier}</td>
      <td>${c.contact}</td>
      <td>${c.createdAt}</td>
      <td>
        <button type="button" class="btn btn--sm js-edit-customer" data-customer-id="${c.id}">编辑</button>
        <button type="button" class="btn btn--sm btn--danger js-delete-customer" data-customer-id="${c.id}">删除</button>
      </td>
    </tr>
  `).join('');
  return `
    <div class="card">
      <h2>客户管理</h2>
      <div class="toolbar">
        <button type="button" class="btn btn--solid js-open-customer-form">新增客户</button>
        <button type="button" class="btn js-refresh-list">刷新列表</button>
      </div>
      <table class="tbl">
        <thead>
          <tr><th>客户ID</th><th>名称</th><th>等级</th><th>联系方式</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderProducts(): string {
  const rows = state.products.map((p) => `
    <tr class="tbl-row">
      <td>${p.sku}</td>
      <td>${p.name}</td>
      <td>${formatMoney(p.price)}</td>
      <td>${p.stock}</td>
      <td>${p.status}</td>
      <td>
        <button type="button" class="btn btn--sm js-edit-product" data-sku="${p.sku}">编辑</button>
        <button type="button" class="btn btn--sm btn--danger js-delete-product" data-sku="${p.sku}">删除</button>
      </td>
    </tr>
  `).join('');
  return `
    <div class="card">
      <h2>商品管理</h2>
      <div class="toolbar">
        <button type="button" class="btn btn--solid js-open-product-form">新增商品</button>
        <button type="button" class="btn js-batch-import">批量导入</button>
        <button type="button" class="btn js-refresh-list">刷新列表</button>
      </div>
      <table class="tbl">
        <thead>
          <tr><th>SKU</th><th>名称</th><th>价格</th><th>库存</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:12px 0 0;color:#64748b;line-height:1.6">
        提示：批量导入会弹出一个确认对话（模拟导入流程），用于演示跨弹窗/确认的恢复能力。
      </p>
    </div>
  `;
}

function renderRefunds(): string {
  const rows = state.refunds.map((r) => `
    <tr class="tbl-row">
      <td>${r.id}</td>
      <td>${r.orderId}</td>
      <td>${r.customer}</td>
      <td>${formatMoney(r.amount)}</td>
      <td>${r.status}</td>
      <td>${r.createdAt}</td>
      <td><button type="button" class="btn js-refund-review" data-refund-id="${r.id}">审核</button></td>
    </tr>
  `).join('');
  return `
    <div class="card">
      <h2>退款与售后</h2>
      <div class="toolbar">
        <button type="button" class="btn js-refresh-list">刷新列表</button>
      </div>
      <table class="tbl">
        <thead>
          <tr><th>单号</th><th>订单</th><th>客户</th><th>金额</th><th>状态</th><th>时间</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderBilling(): string {
  return `
    <div class="card">
      <h2>账单与开票</h2>
      <div class="toolbar">
        <button type="button" class="btn btn--solid js-generate-statement">生成对账单</button>
        <button type="button" class="btn js-refresh-list">刷新</button>
      </div>
      <p style="margin:0;color:#64748b;line-height:1.6">
        此模块用于演示「生成报表 / 下载 / 开票」等偏流程操作。开票动作可从订单页触发。
      </p>
    </div>
  `;
}

function renderAdmin(): string {
  const rows = state.users.map((u) => `
    <tr class="tbl-row">
      <td>${u.name}</td>
      <td>${u.role}</td>
      <td>${u.email}</td>
      <td>${u.status}</td>
      <td>
        <button type="button" class="btn js-toggle-user" data-user-id="${u.id}">切换状态</button>
      </td>
    </tr>
  `).join('');
  return `
    <div class="card">
      <h2>成员与权限</h2>
      <div class="toolbar">
        <button type="button" class="btn btn--solid js-invite-user">邀请成员</button>
        <button type="button" class="btn js-refresh-list">刷新</button>
      </div>
      <table class="tbl">
        <thead><tr><th>成员</th><th>角色</th><th>邮箱</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="danger-block">
        <h3>高危配置</h3>
        <p style="margin:0 0 12px;font-size:13px;color:#742a2a">
          修改支付回调、重置密钥等操作需要更高权限（演示环境不执行）。
        </p>
        <button type="button" class="btn btn--danger js-rotate-key">轮换 API 密钥</button>
      </div>
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
  if (!state.modal) return '';
  const kind = state.modal.kind;
  const titleMap: Record<string, string> = {
    createOrder: '填写订单信息',
    createCustomer: '新增客户',
    createProduct: '新增商品',
    editOrder: '编辑订单',
    editCustomer: '编辑客户',
    editProduct: '编辑商品',
    refundReview: '退款审核',
    issueInvoice: '开具发票',
    inviteUser: '邀请成员',
    confirmDelete: '确认删除',
  };
  const title = titleMap[kind] ?? '操作';

  if (kind === 'createOrder') {
    const custOptions = state.customers.map((c) => `<option value="${c.name}">${c.name}（${c.tier}）</option>`).join('');
    const prodOptions = state.products.filter((p) => p.status === '上架').map((p) => `<option value="${p.sku}">${p.name} - ${formatMoney(p.price)}</option>`).join('');
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="form-grid">
              <label>
                客户
                <select name="customerSelect" required aria-required="true">
                  <option value="">请选择客户</option>
                  ${custOptions}
                </select>
              </label>
              <label>
                商品
                <select name="productSku" required aria-required="true">
                  <option value="">请选择商品</option>
                  ${prodOptions}
                </select>
              </label>
              <label>
                数量
                <input type="number" name="qty" min="1" value="1" />
              </label>
              <label>
                订单金额（元）
                <input type="number" name="amount" min="1" placeholder="自动计算或手填" required aria-required="true" />
              </label>
              <label>
                备注
                <textarea name="note" placeholder="选填"></textarea>
              </label>
            </div>
            <p style="margin:12px 0 0;color:#64748b;line-height:1.6">
              提示：可选择商品与数量自动填充金额（用于演示表单联动 + 继续执行时上下文丢失问题）。
            </p>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--solid js-submit-order">提交订单</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'createCustomer') {
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="form-grid">
              <label>客户名称 <input type="text" name="custName" placeholder="例如：武汉某制造" required aria-required="true" /></label>
              <label>客户等级
                <select name="custTier" required aria-required="true">
                  <option value="标准">标准</option>
                  <option value="企业">企业</option>
                  <option value="VIP">VIP</option>
                </select>
              </label>
              <label>联系人 <input type="text" name="custContact" placeholder="姓名 + 手机" required aria-required="true" /></label>
            </div>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--solid js-submit-customer">保存</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'createProduct') {
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="form-grid">
              <label>商品名称 <input type="text" name="prodName" placeholder="例如：Nebula 云旗舰版" required aria-required="true" /></label>
              <label>SKU <input type="text" name="prodSku" placeholder="例如：SKU-NEB-003" required aria-required="true" /></label>
              <label>价格（元） <input type="number" name="prodPrice" min="1" required aria-required="true" /></label>
              <label>库存 <input type="number" name="prodStock" min="0" /></label>
              <label>状态
                <select name="prodStatus"><option value="上架">上架</option><option value="下架">下架</option></select>
              </label>
            </div>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--solid js-submit-product">保存</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'editOrder') {
    const orderId = (state.modal as { kind: 'editOrder'; orderId: string }).orderId;
    const o = state.orders.find((x) => x.id === orderId);
    const custOptions = state.customers
      .map((c) => `<option value="${c.name}" ${c.name === o?.customer ? 'selected' : ''}>${c.name}（${c.tier}）</option>`)
      .join('');
    const statusOptions = ['待发货', '已完成', '已取消']
      .map((s) => `<option value="${s}" ${s === o?.status ? 'selected' : ''}>${s}</option>`)
      .join('');
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="form-grid">
              <label>
                订单号
                <input type="text" name="editOrderId" value="${o?.id ?? ''}" readonly />
              </label>
              <label>
                客户
                <select name="editOrderCustomer">
                  ${custOptions}
                </select>
              </label>
              <label>
                金额（元）
                <input type="number" name="editOrderAmount" min="1" value="${o?.amount ?? 1}" required aria-required="true" />
              </label>
              <label>
                状态
                <select name="editOrderStatus">${statusOptions}</select>
              </label>
            </div>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--solid js-submit-edit-order">保存</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'editCustomer') {
    const customerId = (state.modal as { kind: 'editCustomer'; customerId: string }).customerId;
    const c = state.customers.find((x) => x.id === customerId);
    const tierOptions = ['标准', '企业', 'VIP']
      .map((t) => `<option value="${t}" ${t === c?.tier ? 'selected' : ''}>${t}</option>`)
      .join('');
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="form-grid">
              <label>
                客户ID
                <input type="text" name="editCustId" value="${c?.id ?? ''}" readonly />
              </label>
              <label>客户名称 <input type="text" name="editCustName" value="${c?.name ?? ''}" required aria-required="true" /></label>
              <label>客户等级
                <select name="editCustTier">${tierOptions}</select>
              </label>
              <label>联系人 <input type="text" name="editCustContact" value="${c?.contact ?? ''}" required aria-required="true" /></label>
            </div>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--solid js-submit-edit-customer">保存</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'editProduct') {
    const sku = (state.modal as { kind: 'editProduct'; sku: string }).sku;
    const p = state.products.find((x) => x.sku === sku);
    const statusOptions = ['上架', '下架']
      .map((s) => `<option value="${s}" ${s === p?.status ? 'selected' : ''}>${s}</option>`)
      .join('');
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="form-grid">
              <label>SKU <input type="text" name="editProdSku" value="${p?.sku ?? ''}" readonly /></label>
              <label>商品名称 <input type="text" name="editProdName" value="${p?.name ?? ''}" required aria-required="true" /></label>
              <label>价格（元） <input type="number" name="editProdPrice" min="1" value="${p?.price ?? 1}" required aria-required="true" /></label>
              <label>库存 <input type="number" name="editProdStock" min="0" value="${p?.stock ?? 0}" /></label>
              <label>状态
                <select name="editProdStatus">${statusOptions}</select>
              </label>
            </div>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--solid js-submit-edit-product">保存</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'confirmDelete') {
    const m = state.modal as { kind: 'confirmDelete'; entity: 'order' | 'customer' | 'product'; id: string; label: string };
    const entityName = m.entity === 'order' ? '订单' : m.entity === 'customer' ? '客户' : '商品';
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <p style="margin:0;color:#475569;line-height:1.7">
              你确定要删除${entityName} <b>${m.label}</b> 吗？此操作不可撤销（演示环境仅更新本地列表）。
            </p>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--danger js-confirm-delete" data-entity="${m.entity}" data-id="${m.id}">确认删除</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'refundReview') {
    const r = state.refunds.find((x) => x.id === (state.modal as { kind: 'refundReview'; refundId: string }).refundId);
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="card" style="margin:0;border-radius:8px">
              <p style="margin:0 0 6px;color:#475569">退款单：<b>${r?.id ?? '-'}</b></p>
              <p style="margin:0 0 6px;color:#475569">订单：<b>${r?.orderId ?? '-'}</b> / 客户：<b>${r?.customer ?? '-'}</b></p>
              <p style="margin:0;color:#475569">金额：<b>${r ? formatMoney(r.amount) : '-'}</b> / 原因：<b>${r?.reason ?? '-'}</b></p>
            </div>
            <div class="form-grid" style="margin-top:12px">
              <label>审核备注<textarea name="reviewNote" placeholder="选填"></textarea></label>
            </div>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn js-reject-refund">拒绝</button>
            <button type="button" class="btn btn--solid js-approve-refund">通过</button>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'issueInvoice') {
    return `
      <div class="overlay" id="order-overlay" role="presentation">
        <div class="dialog" role="dialog" aria-labelledby="dlg-title">
          <div class="dialog__head" id="dlg-title">${title}</div>
          <div class="dialog__body">
            <div class="form-grid">
              <label>抬头 <input type="text" name="invTitle" placeholder="公司名称" required aria-required="true" /></label>
              <label>税号 <input type="text" name="invTax" placeholder="统一社会信用代码" required aria-required="true" /></label>
              <label>邮箱 <input type="text" name="invEmail" placeholder="用于接收发票" required aria-required="true" /></label>
            </div>
          </div>
          <div class="dialog__foot">
            <button type="button" class="btn js-close-dialog">取消</button>
            <button type="button" class="btn btn--solid js-submit-invoice">提交开票</button>
          </div>
        </div>
      </div>
    `;
  }

  // inviteUser
  return `
    <div class="overlay" id="order-overlay" role="presentation">
      <div class="dialog" role="dialog" aria-labelledby="dlg-title">
        <div class="dialog__head" id="dlg-title">${title}</div>
        <div class="dialog__body">
          <div class="form-grid">
            <label>
              邮箱
              <input type="text" name="inviteEmail" placeholder="name@company.com" required aria-required="true" />
            </label>
            <label>
              角色
              <select name="inviteRole">
                <option value="运营">运营</option>
                <option value="客服">客服</option>
                <option value="财务">财务</option>
                <option value="管理员">管理员</option>
              </select>
            </label>
            <label>
              备注
              <textarea name="note" placeholder="选填"></textarea>
            </label>
          </div>
        </div>
        <div class="dialog__foot">
          <button type="button" class="btn js-close-dialog">取消</button>
          <button type="button" class="btn btn--solid js-submit-invite">发送邀请</button>
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
    customers: 'CRM / 客户管理',
    products: '商品 / 商品管理',
    refunds: '售后 / 退款审核',
    billing: '财务 / 账单与开票',
    admin: '系统 / 成员与权限',
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
  else if (state.view === 'customers') html = renderCustomers();
  else if (state.view === 'products') html = renderProducts();
  else if (state.view === 'refunds') html = renderRefunds();
  else if (state.view === 'billing') html = renderBilling();
  else if (state.view === 'admin') html = renderAdmin();
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
    state.modal = { kind: 'createOrder' };
    renderMain();
  });
  document.querySelector('.js-open-customer-form')?.addEventListener('click', () => {
    state.modal = { kind: 'createCustomer' };
    renderMain();
  });
  document.querySelector('.js-open-product-form')?.addEventListener('click', () => {
    state.modal = { kind: 'createProduct' };
    renderMain();
  });

  document.querySelectorAll<HTMLButtonElement>('.js-edit-order').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-order-id') ?? '';
      state.modal = { kind: 'editOrder', orderId: id };
      renderMain();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.js-delete-order').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-order-id') ?? '';
      const o = state.orders.find((x) => x.id === id);
      state.modal = { kind: 'confirmDelete', entity: 'order', id, label: o?.id ?? id };
      renderMain();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.js-edit-customer').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-customer-id') ?? '';
      state.modal = { kind: 'editCustomer', customerId: id };
      renderMain();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.js-delete-customer').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-customer-id') ?? '';
      const c = state.customers.find((x) => x.id === id);
      state.modal = { kind: 'confirmDelete', entity: 'customer', id, label: c?.name ?? id };
      renderMain();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.js-edit-product').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sku = btn.getAttribute('data-sku') ?? '';
      state.modal = { kind: 'editProduct', sku };
      renderMain();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.js-delete-product').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sku = btn.getAttribute('data-sku') ?? '';
      const p = state.products.find((x) => x.sku === sku);
      state.modal = { kind: 'confirmDelete', entity: 'product', id: sku, label: p?.name ?? sku };
      renderMain();
    });
  });

  document.querySelector('.js-close-dialog')?.addEventListener('click', () => {
    state.modal = null;
    renderMain();
  });

  document.querySelector('.js-refresh-list')?.addEventListener('click', () => {
    showToast('列表已刷新');
  });

  // form linkage: product+qty → fill amount
  document.querySelector('select[name="productSku"]')?.addEventListener('change', () => {
    const sku = (document.querySelector('select[name="productSku"]') as HTMLSelectElement)?.value;
    const qty = Number((document.querySelector('input[name="qty"]') as HTMLInputElement)?.value || '1');
    const prod = state.products.find((p) => p.sku === sku);
    const amountEl = document.querySelector('input[name="amount"]') as HTMLInputElement | null;
    if (prod && amountEl) amountEl.value = String(prod.price * Math.max(1, qty));
  });
  document.querySelector('input[name="qty"]')?.addEventListener('input', () => {
    const sku = (document.querySelector('select[name="productSku"]') as HTMLSelectElement)?.value;
    const qty = Number((document.querySelector('input[name="qty"]') as HTMLInputElement)?.value || '1');
    const prod = state.products.find((p) => p.sku === sku);
    const amountEl = document.querySelector('input[name="amount"]') as HTMLInputElement | null;
    if (prod && amountEl) amountEl.value = String(prod.price * Math.max(1, qty));
  });

  document.querySelector('.js-submit-order')?.addEventListener('click', () => {
    const customer = (document.querySelector('select[name="customerSelect"]') as HTMLSelectElement)?.value.trim();
    const amount = Number((document.querySelector('input[name="amount"]') as HTMLInputElement)?.value);
    if (!customer || !amount) {
      showToast('请先选择客户并填写金额');
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
    state.modal = null;
    renderMain();
    showToast(`订单 ${id} 已创建，进入待发货`);
  });

  document.querySelector('.js-submit-customer')?.addEventListener('click', () => {
    const name = (document.querySelector('input[name="custName"]') as HTMLInputElement)?.value.trim();
    const tier = (document.querySelector('select[name="custTier"]') as HTMLSelectElement)?.value as Customer['tier'];
    const contact = (document.querySelector('input[name="custContact"]') as HTMLInputElement)?.value.trim();
    if (!name || !contact) { showToast('请填写客户名称与联系人'); return; }
    const id = `CST-${Math.floor(1000 + Math.random() * 9000)}`;
    state.customers.unshift({
      id,
      name,
      tier: tier || '标准',
      contact,
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    });
    state.modal = null;
    renderMain();
    showToast(`客户 ${name} 已创建`);
  });

  document.querySelector('.js-submit-product')?.addEventListener('click', () => {
    const name = (document.querySelector('input[name="prodName"]') as HTMLInputElement)?.value.trim();
    const sku = (document.querySelector('input[name="prodSku"]') as HTMLInputElement)?.value.trim();
    const price = Number((document.querySelector('input[name="prodPrice"]') as HTMLInputElement)?.value);
    const stock = Number((document.querySelector('input[name="prodStock"]') as HTMLInputElement)?.value);
    const status = (document.querySelector('select[name="prodStatus"]') as HTMLSelectElement)?.value as Product['status'];
    if (!name || !sku || !price) { showToast('请填写商品名称、SKU、价格'); return; }
    state.products.unshift({ sku, name, price, stock: Number.isFinite(stock) ? stock : 0, status: status || '上架' });
    state.modal = null;
    renderMain();
    showToast(`商品 ${name} 已保存`);
  });

  document.querySelector('.js-submit-edit-order')?.addEventListener('click', () => {
    const id = (document.querySelector('input[name="editOrderId"]') as HTMLInputElement | null)?.value.trim() ?? '';
    const customer = (document.querySelector('select[name="editOrderCustomer"]') as HTMLSelectElement | null)?.value.trim() ?? '';
    const amount = Number((document.querySelector('input[name="editOrderAmount"]') as HTMLInputElement | null)?.value ?? '0');
    const status = (document.querySelector('select[name="editOrderStatus"]') as HTMLSelectElement | null)?.value.trim() ?? '';
    const o = state.orders.find((x) => x.id === id);
    if (!o) { showToast('未找到订单'); return; }
    if (!customer || !amount) { showToast('请填写客户与金额'); return; }
    const delta = amount - o.amount;
    o.customer = customer;
    o.amount = amount;
    o.status = status || o.status;
    state.revenueToday += delta;
    state.modal = null;
    renderMain();
    showToast(`订单 ${id} 已更新`);
  });

  document.querySelector('.js-submit-edit-customer')?.addEventListener('click', () => {
    const id = (document.querySelector('input[name="editCustId"]') as HTMLInputElement | null)?.value.trim() ?? '';
    const name = (document.querySelector('input[name="editCustName"]') as HTMLInputElement | null)?.value.trim() ?? '';
    const tier = (document.querySelector('select[name="editCustTier"]') as HTMLSelectElement | null)?.value as Customer['tier'];
    const contact = (document.querySelector('input[name="editCustContact"]') as HTMLInputElement | null)?.value.trim() ?? '';
    const c = state.customers.find((x) => x.id === id);
    if (!c) { showToast('未找到客户'); return; }
    if (!name || !contact) { showToast('请填写客户名称与联系人'); return; }
    c.name = name;
    c.tier = tier || c.tier;
    c.contact = contact;
    state.modal = null;
    renderMain();
    showToast(`客户 ${name} 已更新`);
  });

  document.querySelector('.js-submit-edit-product')?.addEventListener('click', () => {
    const sku = (document.querySelector('input[name="editProdSku"]') as HTMLInputElement | null)?.value.trim() ?? '';
    const name = (document.querySelector('input[name="editProdName"]') as HTMLInputElement | null)?.value.trim() ?? '';
    const price = Number((document.querySelector('input[name="editProdPrice"]') as HTMLInputElement | null)?.value ?? '0');
    const stock = Number((document.querySelector('input[name="editProdStock"]') as HTMLInputElement | null)?.value ?? '0');
    const status = (document.querySelector('select[name="editProdStatus"]') as HTMLSelectElement | null)?.value as Product['status'];
    const p = state.products.find((x) => x.sku === sku);
    if (!p) { showToast('未找到商品'); return; }
    if (!name || !price) { showToast('请填写商品名称与价格'); return; }
    p.name = name;
    p.price = price;
    p.stock = Number.isFinite(stock) ? stock : p.stock;
    p.status = status || p.status;
    state.modal = null;
    renderMain();
    showToast(`商品 ${name} 已更新`);
  });

  document.querySelector('.js-confirm-delete')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const entity = (btn.getAttribute('data-entity') ?? '') as 'order' | 'customer' | 'product';
    const id = btn.getAttribute('data-id') ?? '';
    if (!entity || !id) return;
    if (entity === 'order') {
      const idx = state.orders.findIndex((x) => x.id === id);
      if (idx >= 0) {
        const [removed] = state.orders.splice(idx, 1);
        state.orderCountToday = Math.max(0, state.orderCountToday - 1);
        state.revenueToday = Math.max(0, state.revenueToday - removed.amount);
      }
      showToast(`订单 ${id} 已删除`);
    } else if (entity === 'customer') {
      const idx = state.customers.findIndex((x) => x.id === id);
      const removed = idx >= 0 ? state.customers.splice(idx, 1)[0] : null;
      showToast(`客户 ${removed?.name ?? id} 已删除`);
    } else {
      const idx = state.products.findIndex((x) => x.sku === id);
      const removed = idx >= 0 ? state.products.splice(idx, 1)[0] : null;
      showToast(`商品 ${removed?.name ?? id} 已删除`);
    }
    state.modal = null;
    renderMain();
  });

  document.querySelectorAll<HTMLButtonElement>('.js-refund-review').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-refund-id') ?? '';
      state.modal = { kind: 'refundReview', refundId: id };
      renderMain();
    });
  });
  document.querySelector('.js-approve-refund')?.addEventListener('click', () => {
    const id = (state.modal as { kind: 'refundReview'; refundId: string }).refundId;
    const r = state.refunds.find((x) => x.id === id);
    if (r) r.status = '已通过';
    state.modal = null;
    renderMain();
    showToast(`退款 ${id} 已通过`);
  });
  document.querySelector('.js-reject-refund')?.addEventListener('click', () => {
    const id = (state.modal as { kind: 'refundReview'; refundId: string }).refundId;
    const r = state.refunds.find((x) => x.id === id);
    if (r) r.status = '已拒绝';
    state.modal = null;
    renderMain();
    showToast(`退款 ${id} 已拒绝`);
  });

  document.querySelector('.js-invite-user')?.addEventListener('click', () => {
    state.modal = { kind: 'inviteUser' };
    renderMain();
  });
  document.querySelector('.js-submit-invite')?.addEventListener('click', () => {
    const email = (document.querySelector('input[name="inviteEmail"]') as HTMLInputElement)?.value.trim();
    const role = (document.querySelector('select[name="inviteRole"]') as HTMLSelectElement)?.value as UserAccount['role'];
    if (!email) { showToast('请填写邮箱'); return; }
    const id = `USR-${Math.floor(10 + Math.random() * 90)}`;
    state.users.unshift({ id, name: email.split('@')[0], role: role || '运营', email, status: '启用' });
    state.modal = null;
    renderMain();
    showToast(`已发送邀请：${email}`);
  });

  document.querySelector('.js-toggle-user')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const id = btn.getAttribute('data-user-id') ?? '';
    const u = state.users.find((x) => x.id === id);
    if (!u) return;
    u.status = u.status === '启用' ? '禁用' : '启用';
    renderMain();
    showToast(`成员 ${u.name} 已${u.status === '启用' ? '启用' : '禁用'}`);
  });

  document.querySelector('.js-rotate-key')?.addEventListener('click', () => {
    showToast('该操作需管理员二次确认（演示环境不执行）');
  });

  document.querySelector('.js-generate-statement')?.addEventListener('click', () => {
    showToast('对账单已生成（演示：下载链接已发送到消息中心）');
  });

  document.querySelector('.js-issue-invoice')?.addEventListener('click', () => {
    const first = state.orders[0];
    if (!first) { showToast('暂无订单'); return; }
    state.modal = { kind: 'issueInvoice', orderId: first.id };
    renderMain();
  });
  document.querySelector('.js-submit-invoice')?.addEventListener('click', () => {
    showToast('开票申请已提交（演示）');
    state.modal = null;
    renderMain();
  });

  document.querySelector('.js-mark-shipped')?.addEventListener('click', () => {
    const target = state.orders.find((o) => o.status === '待发货');
    if (!target) { showToast('没有待发货订单'); return; }
    target.status = '已完成';
    renderMain();
    showToast(`订单 ${target.id} 已标记为已完成`);
  });

  document.querySelector('.js-batch-import')?.addEventListener('click', () => {
    showToast('批量导入：请先下载模板 → 填写 → 上传（演示环境省略上传）');
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
        <div class="mch-side__brand">测试商户后台</div>
        <ul class="mch-side__nav">
          <li><a href="#dashboard">经营概览</a></li>
          <li class="sep">交易</li>
          <li><a href="#orders">订单管理</a></li>
          <li><a href="#refunds">退款售后</a></li>
          <li class="sep">CRM</li>
          <li><a href="#customers">客户管理</a></li>
          <li class="sep">商品</li>
          <li><a href="#products">商品管理</a></li>
          <li class="sep">财务</li>
          <li><a href="#billing">账单开票</a></li>
          <li class="sep">系统</li>
          <li><a href="#admin">成员权限</a></li>
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
