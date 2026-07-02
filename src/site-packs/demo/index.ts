import type { SitePack } from '../../framework/types';
import { getTodayRevenue } from '../../demo-app/app';
import runtimeGuide from './runtime-guide.md?raw';

export const demoSitePack: SitePack = {
  siteId: 'nebula-merchant-demo',
  name: '测试商户后台',
  version: '0.1.0',
  skillsMarkdown: runtimeGuide,
  theme: {
    accent: '#2563eb',
    accent2: '#0f766e',
    success: '#15803d',
  },
  capabilities: [
    { id: 'orders', label: '订单管理', description: '订单增删改查、开票、发货', apis: [] },
    { id: 'revenue', label: '营收查询', description: '今日营收数据', apis: ['getTodayRevenue'] },
    { id: 'settings', label: '门店设置', description: '查看门店配置' },
    { id: 'crm', label: '客户管理', description: '客户增删改查' },
    { id: 'products', label: '商品管理', description: '商品增删改查、批量导入' },
    { id: 'refunds', label: '退款售后', description: '退款审核与审批流程' },
    { id: 'billing', label: '财务开票', description: '生成对账单、开票流程' },
    { id: 'admin', label: '成员权限', description: '邀请成员、角色分配与启停用' },
  ],
  entrypoints: [
    { id: 'create-order', label: '创建订单', triggers: ['创建订单', '新建订单'], playbookId: 'create_order' },
    { id: 'edit-order', label: '编辑订单', triggers: ['编辑订单', '修改订单'], playbookId: 'edit_order', route: '/orders' },
    { id: 'delete-order', label: '删除订单', triggers: ['删除订单'], playbookId: 'delete_order', route: '/orders' },
    { id: 'view-revenue', label: '查看营收', triggers: ['今日营收', '查看营收'], playbookId: 'view_revenue' },
    { id: 'full-tour', label: '全站巡检', triggers: ['全站巡检'], playbookId: 'full_tour', route: '/dashboard' },
    { id: 'approve-refund', label: '退款审批', triggers: ['通过退款', '审核退款'], playbookId: 'approve_refund', route: '/refunds' },
    { id: 'invite-user', label: '邀请成员', triggers: ['邀请成员', '新增成员'], playbookId: 'invite_user', route: '/admin' },
    { id: 'create-customer', label: '新增客户', triggers: ['新增客户', '创建客户'], playbookId: 'create_customer', route: '/customers' },
    { id: 'edit-customer', label: '编辑客户', triggers: ['编辑客户', '修改客户'], playbookId: 'edit_customer', route: '/customers' },
    { id: 'delete-customer', label: '删除客户', triggers: ['删除客户'], playbookId: 'delete_customer', route: '/customers' },
    { id: 'create-product', label: '新增商品', triggers: ['新增商品', '创建商品'], playbookId: 'create_product', route: '/products' },
    { id: 'edit-product', label: '编辑商品', triggers: ['编辑商品', '修改商品'], playbookId: 'edit_product', route: '/products' },
    { id: 'delete-product', label: '删除商品', triggers: ['删除商品'], playbookId: 'delete_product', route: '/products' },
  ],
  routes: [
    { path: '/dashboard', title: '经营概览', description: '首页，展示今日营收与快捷入口' },
    { path: '/orders', title: '订单管理', description: '订单列表与新建订单' },
    { path: '/settings', title: '门店设置', description: '门店基础配置' },
    { path: '/refunds', title: '退款售后', description: '退款审核与审批' },
    { path: '/customers', title: '客户管理', description: '客户列表与新增客户' },
    { path: '/products', title: '商品管理', description: '商品列表、导入与新增' },
    { path: '/billing', title: '账单开票', description: '对账单生成与开票流程' },
    { path: '/admin', title: '成员权限', description: '邀请成员、角色与状态' },
  ],
  permissions: [
    { id: 'read-revenue', scope: 'revenue:read', description: '读取今日营收' },
    { id: 'write-orders', scope: 'orders:write', description: '创建订单' },
  ],
  riskPolicies: [
    {
      id: 'block-delete-merchant',
      level: 'high',
      blocked: true,
      reason: '注销商户账号属于高危操作，站点包禁止自动执行，请手动操作。',
      when: { action: 'click', textContains: '注销商户' },
    },
  ],
  overlaySelectors: ['[data-im-overlay]'],
  blockedActions: [
    {
      id: 'block-delete-merchant',
      reason: '注销商户账号属于高危操作，站点包禁止自动执行，请手动操作。',
      when: { action: 'click', textContains: '注销商户' },
    },
  ],
  requireConfirm: [],
  apis: {
    getTodayRevenue: async () => {
      const data = getTodayRevenue();
      return {
        success: true,
        message: `今日营收 **¥${data.revenue.toLocaleString('zh-CN')}**，共 **${data.orders}** 笔订单`,
        data,
      };
    },
  },
  playbooks: [
    // ── 1. 创建新订单（跨页面：首页 → 订单管理 → 弹窗填表 → 提交） ──────────────
    {
      id: 'create_order',
      description: '创建一笔新订单',
      triggers: ['创建订单', '新建订单', '下一单', '创建一笔订单', '下个订单'],
      steps: [
        {
          tool: 'snapshot',
          explanation: '采集当前页面',
        },
        {
          tool: 'click',
          find: { textContains: '订单管理' },
          explanation: '导航到订单管理页',
        },
        {
          tool: 'snapshot',
          explanation: '页面跳转后重新采集',
        },
        {
          tool: 'click',
          find: { textContains: '新建订单' },
          explanation: '点击「新建订单」打开弹窗',
        },
        {
          tool: 'snapshot',
          explanation: '弹窗打开后采集表单元素',
        },
        {
          tool: 'select',
          find: { role: 'combobox', textContains: '客户' },
          explanation: '选择一个客户（默认选择第一个可用项）',
        },
        {
          tool: 'select',
          find: { role: 'combobox', textContains: '商品' },
          explanation: '选择一个商品（默认选择第一个可用项）',
        },
        {
          tool: 'input',
          find: { role: 'textbox', textContains: '数量' },
          inputValue: '2',
          explanation: '填写数量 2（触发金额联动）',
        },
        {
          tool: 'click',
          find: { textContains: '提交订单' },
          explanation: '提交订单',
        },
      ],
    },

    // ── 2. 查看今日营收（纯 API） ──────────────────────────────────────────────
    {
      id: 'view_revenue',
      description: '查看今日营收（API）',
      triggers: ['今日营收', '查看营收', '今天赚了', '查看今日营收', '营收'],
      steps: [
        {
          tool: 'api',
          apiName: 'getTodayRevenue',
          explanation: '调用数据接口获取今日营收',
        },
      ],
    },

    // ── 3. 全站巡检（跨多页面） ────────────────────────────────────────────────
    {
      id: 'full_tour',
      description: '依次巡视经营概览、订单、退款、客户、商品、财务、成员、设置页面',
      triggers: ['全站巡检', '全页面巡检', '依次打开所有页面', '巡视所有页面', '遍历页面', '全部页面'],
      steps: [
        {
          tool: 'snapshot',
          explanation: '采集初始页面',
        },
        {
          tool: 'click',
          find: { textContains: '经营概览' },
          explanation: '导航到「经营概览」',
        },
        {
          tool: 'snapshot',
          explanation: '采集概览页',
        },
        {
          tool: 'click',
          find: { textContains: '订单管理' },
          explanation: '导航到「订单管理」',
        },
        {
          tool: 'snapshot',
          explanation: '采集订单管理页',
        },
        {
          tool: 'click',
          find: { textContains: '退款售后' },
          explanation: '导航到「退款售后」',
        },
        {
          tool: 'snapshot',
          explanation: '采集退款页',
        },
        {
          tool: 'click',
          find: { textContains: '客户管理' },
          explanation: '导航到「客户管理」',
        },
        {
          tool: 'snapshot',
          explanation: '采集客户页',
        },
        {
          tool: 'click',
          find: { textContains: '商品管理' },
          explanation: '导航到「商品管理」',
        },
        {
          tool: 'snapshot',
          explanation: '采集商品页',
        },
        {
          tool: 'click',
          find: { textContains: '账单开票' },
          explanation: '导航到「账单开票」',
        },
        {
          tool: 'snapshot',
          explanation: '采集财务页',
        },
        {
          tool: 'click',
          find: { textContains: '成员权限' },
          explanation: '导航到「成员权限」',
        },
        {
          tool: 'snapshot',
          explanation: '采集成员页',
        },
        {
          tool: 'click',
          find: { textContains: '门店设置' },
          explanation: '导航到「门店设置」',
        },
        {
          tool: 'snapshot',
          explanation: '采集设置页，巡检完毕',
        },
      ],
    },

    // ── 6. 退款审批（跨页面：退款列表 → 弹窗 → 通过） ──────────────────────────
    {
      id: 'approve_refund',
      description: '通过一笔待审核退款',
      triggers: ['通过退款', '审核退款', '同意退款', '退款审批'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '退款售后' }, explanation: '进入退款售后页' },
        { tool: 'snapshot', explanation: '采集退款列表' },
        { tool: 'click', find: { textContains: '审核' }, explanation: '打开第一条退款的审核弹窗' },
        { tool: 'snapshot', explanation: '采集审核弹窗' },
        { tool: 'click', find: { textContains: '通过' }, explanation: '通过退款' },
      ],
    },

    // ── 7. 邀请成员（系统 → 弹窗 → 发送邀请） ────────────────────────────────
    {
      id: 'invite_user',
      description: '邀请一名成员并选择角色',
      triggers: ['邀请成员', '新增成员', '添加成员', '邀请同事'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '成员权限' }, explanation: '进入成员权限页' },
        { tool: 'snapshot', explanation: '采集成员列表' },
        { tool: 'click', find: { textContains: '邀请成员' }, explanation: '打开邀请弹窗' },
        { tool: 'snapshot', explanation: '采集邀请表单' },
        { tool: 'input', find: { role: 'textbox', textContains: '邮箱' }, inputValue: 'new.user@nebula.local', explanation: '填写邮箱' },
        { tool: 'click', find: { textContains: '角色' }, explanation: '定位角色选择' },
        { tool: 'click', find: { textContains: '客服' }, explanation: '选择「客服」角色' },
        { tool: 'click', find: { textContains: '发送邀请' }, explanation: '发送邀请' },
      ],
    },

    // ── 4. 综合演示（API + 跨页面操作 + 表单） ───────────────────────────────
    {
      id: 'full_demo',
      description: '完整综合演示：查营收 → 去订单 → 新建订单 → 提交',
      triggers: [
        '完整演示', '综合演示', '全流程', '全流程演示',
        '演示所有功能', '帮我演示', 'demo',
      ],
      steps: [
        // Step 1: 先用 API 拿数据
        {
          tool: 'api',
          apiName: 'getTodayRevenue',
          explanation: '第 1 步：调用 API 查询今日营收',
        },
        // Step 2: 导航到订单管理
        {
          tool: 'snapshot',
          explanation: '采集当前页面',
        },
        {
          tool: 'click',
          find: { textContains: '订单管理' },
          explanation: '第 2 步：导航到订单管理页',
        },
        // Step 3: 刷新订单列表
        {
          tool: 'snapshot',
          explanation: '订单管理页重新采集',
        },
        {
          tool: 'click',
          find: { textContains: '刷新列表' },
          explanation: '第 3 步：刷新订单列表',
        },
        // Step 4: 打开新建订单弹窗
        {
          tool: 'click',
          find: { textContains: '新建订单' },
          explanation: '第 4 步：打开新建订单弹窗',
        },
        // Step 5: 填写表单
        {
          tool: 'snapshot',
          explanation: '采集弹窗内表单',
        },
        {
          tool: 'select',
          find: { role: 'combobox', textContains: '客户' },
          explanation: '第 5 步：选择一个客户（默认选择第一个可用项）',
        },
        {
          tool: 'select',
          find: { role: 'combobox', textContains: '商品' },
          explanation: '第 6 步：选择一个商品（默认选择第一个可用项）',
        },
        {
          tool: 'input',
          find: { role: 'textbox', textContains: '数量' },
          inputValue: '3',
          explanation: '第 7 步：填写数量 3（触发金额联动）',
        },
        // Step 6: 提交
        {
          tool: 'click',
          find: { textContains: '提交订单' },
          explanation: '第 8 步：提交订单',
        },
        // Step 7: 回到首页看更新后的数据
        {
          tool: 'snapshot',
          explanation: '提交后重新采集',
        },
        {
          tool: 'click',
          find: { textContains: '经营概览' },
          explanation: '第 8 步：返回经营概览查看更新数据',
        },
      ],
    },

    // ── 5. 门店设置（简单导航） ────────────────────────────────────────────────
    {
      id: 'go_settings',
      description: '打开门店设置页',
      triggers: ['门店设置', '打开设置', '查看设置', '设置页'],
      steps: [
        {
          tool: 'snapshot',
          explanation: '采集页面',
        },
        {
          tool: 'click',
          find: { textContains: '门店设置' },
          explanation: '进入门店设置页',
        },
      ],
    },

    // ── 8. 客户 CRUD ─────────────────────────────────────────────────────────
    {
      id: 'create_customer',
      description: '新增一名客户',
      triggers: ['新增客户', '创建客户', '添加客户'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '客户管理' }, explanation: '进入客户管理页' },
        { tool: 'snapshot', explanation: '采集客户列表' },
        { tool: 'click', find: { textContains: '新增客户' }, explanation: '打开新增客户弹窗' },
        { tool: 'snapshot', explanation: '采集新增客户表单' },
        { tool: 'input', find: { role: 'textbox', textContains: '客户名称' }, inputValue: '武汉某制造', explanation: '填写客户名称' },
        { tool: 'select', find: { role: 'combobox', textContains: '客户等级' }, selectValue: '企业', explanation: '选择客户等级为企业' },
        { tool: 'input', find: { role: 'textbox', textContains: '联系人' }, inputValue: '张** 139****1122', explanation: '填写联系人' },
        { tool: 'click', find: { textContains: '保存' }, explanation: '保存客户' },
      ],
    },
    {
      id: 'edit_customer',
      description: '编辑第一条客户信息',
      triggers: ['编辑客户', '修改客户'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '客户管理' }, explanation: '进入客户管理页' },
        { tool: 'snapshot', explanation: '采集客户列表' },
        { tool: 'click', find: { textContains: '编辑' }, explanation: '打开第一条客户的编辑弹窗' },
        { tool: 'snapshot', explanation: '采集编辑表单' },
        { tool: 'input', find: { role: 'textbox', textContains: '客户名称' }, inputValue: '杭州某茶（更新）', explanation: '修改客户名称' },
        { tool: 'click', find: { textContains: '保存' }, explanation: '保存修改' },
      ],
    },
    {
      id: 'delete_customer',
      description: '删除第一条客户（会弹确认）',
      triggers: ['删除客户'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '客户管理' }, explanation: '进入客户管理页' },
        { tool: 'snapshot', explanation: '采集客户列表' },
        { tool: 'click', find: { textContains: '删除' }, explanation: '点击第一条客户的删除' },
        { tool: 'snapshot', explanation: '采集确认弹窗' },
        { tool: 'click', find: { textContains: '确认删除' }, explanation: '确认删除客户' },
      ],
    },

    // ── 9. 商品 CRUD ─────────────────────────────────────────────────────────
    {
      id: 'create_product',
      description: '新增一个商品',
      triggers: ['新增商品', '创建商品', '添加商品'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '商品管理' }, explanation: '进入商品管理页' },
        { tool: 'snapshot', explanation: '采集商品列表' },
        { tool: 'click', find: { textContains: '新增商品' }, explanation: '打开新增商品弹窗' },
        { tool: 'snapshot', explanation: '采集商品表单' },
        { tool: 'input', find: { role: 'textbox', textContains: '商品名称' }, inputValue: 'Nebula 云旗舰版', explanation: '填写商品名称' },
        { tool: 'input', find: { role: 'textbox', textContains: 'SKU' }, inputValue: 'SKU-NEB-003', explanation: '填写 SKU' },
        { tool: 'input', find: { role: 'textbox', textContains: '价格' }, inputValue: '1299', explanation: '填写价格' },
        { tool: 'input', find: { role: 'textbox', textContains: '库存' }, inputValue: '1200', explanation: '填写库存' },
        { tool: 'select', find: { role: 'combobox', textContains: '状态' }, selectValue: '上架', explanation: '设置为上架' },
        { tool: 'click', find: { textContains: '保存' }, explanation: '保存商品' },
      ],
    },
    {
      id: 'edit_product',
      description: '编辑第一条商品信息',
      triggers: ['编辑商品', '修改商品'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '商品管理' }, explanation: '进入商品管理页' },
        { tool: 'snapshot', explanation: '采集商品列表' },
        { tool: 'click', find: { textContains: '编辑' }, explanation: '打开第一条商品的编辑弹窗' },
        { tool: 'snapshot', explanation: '采集编辑表单' },
        { tool: 'input', find: { role: 'textbox', textContains: '商品名称' }, inputValue: 'Nebula 云基础版（更新）', explanation: '修改商品名称' },
        { tool: 'click', find: { textContains: '保存' }, explanation: '保存修改' },
      ],
    },
    {
      id: 'delete_product',
      description: '删除第一条商品（会弹确认）',
      triggers: ['删除商品'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '商品管理' }, explanation: '进入商品管理页' },
        { tool: 'snapshot', explanation: '采集商品列表' },
        { tool: 'click', find: { textContains: '删除' }, explanation: '点击第一条商品的删除' },
        { tool: 'snapshot', explanation: '采集确认弹窗' },
        { tool: 'click', find: { textContains: '确认删除' }, explanation: '确认删除商品' },
      ],
    },

    // ── 10. 订单编辑/删除 ────────────────────────────────────────────────────
    {
      id: 'edit_order',
      description: '编辑第一条订单（客户/金额/状态）',
      triggers: ['编辑订单', '修改订单'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '订单管理' }, explanation: '进入订单管理页' },
        { tool: 'snapshot', explanation: '采集订单列表' },
        { tool: 'click', find: { textContains: '编辑' }, explanation: '打开第一条订单的编辑弹窗' },
        { tool: 'snapshot', explanation: '采集编辑表单' },
        { tool: 'select', find: { role: 'combobox', textContains: '客户' }, explanation: '选择一个客户（默认第一个有效项）' },
        { tool: 'input', find: { role: 'textbox', textContains: '金额' }, inputValue: '888', explanation: '修改金额为 888' },
        { tool: 'select', find: { role: 'combobox', textContains: '状态' }, selectValue: '已完成', explanation: '修改状态为已完成' },
        { tool: 'click', find: { textContains: '保存' }, explanation: '保存订单修改' },
      ],
    },
    {
      id: 'delete_order',
      description: '删除第一条订单（会弹确认）',
      triggers: ['删除订单'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '订单管理' }, explanation: '进入订单管理页' },
        { tool: 'snapshot', explanation: '采集订单列表' },
        { tool: 'click', find: { textContains: '删除' }, explanation: '点击第一条订单的删除' },
        { tool: 'snapshot', explanation: '采集确认弹窗' },
        { tool: 'click', find: { textContains: '确认删除' }, explanation: '确认删除订单' },
      ],
    },
  ],
};
