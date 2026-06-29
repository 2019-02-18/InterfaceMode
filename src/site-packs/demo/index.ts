import type { SitePack } from '../../framework/types';
import { getTodayRevenue } from '../../demo-app/app';
import runtimeGuide from './runtime-guide.md?raw';

export const demoSitePack: SitePack = {
  siteId: 'nebula-merchant-demo',
  name: '测试商户后台',
  version: '0.1.0',
  skillsMarkdown: runtimeGuide,
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
          tool: 'input',
          find: { role: 'textbox', textContains: '客户' },
          inputValue: 'InterfaceMode 演示客户',
          explanation: '填写客户名称',
        },
        {
          tool: 'input',
          find: { role: 'textbox', textContains: '订单金额' },
          inputValue: '1999',
          explanation: '填写订单金额 1999 元',
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
      description: '依次巡视经营概览、订单管理、门店设置三个页面',
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
          find: { textContains: '门店设置' },
          explanation: '导航到「门店设置」',
        },
        {
          tool: 'snapshot',
          explanation: '采集设置页，巡检完毕',
        },
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
          tool: 'input',
          find: { role: 'textbox', textContains: '客户' },
          inputValue: '全流程演示-自动生成',
          explanation: '第 5 步：填写客户名称',
        },
        {
          tool: 'input',
          find: { role: 'textbox', textContains: '订单金额' },
          inputValue: '8888',
          explanation: '第 6 步：填写金额 8888 元（幸运数字）',
        },
        // Step 6: 提交
        {
          tool: 'click',
          find: { textContains: '提交订单' },
          explanation: '第 7 步：提交订单',
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
  ],
};
