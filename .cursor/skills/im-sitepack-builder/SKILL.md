---
name: im-sitepack-builder
description: >-
  引导创建 InterfaceMode 站点包（SitePack）：生成 index.ts 与 runtime-guide.md，
  配置 capabilities、entrypoints、routes、playbooks、API 与风险策略，并与框架执行机制对齐。
  适用于用户要生成站点包、接入 InterfaceMode、为网站写助手配置，或提到
  im sitepack / 站点包 / 接入 InterfaceMode / 新站点配置 / 给助手写配置。
---

# InterfaceMode 站点包构建

## 交付物

在 `src/site-packs/<site-id>/` 下生成 **两个文件**：

| 文件 | 作用 |
|------|------|
| `index.ts` | 类型化的 `SitePack`：playbooks、API、策略、元数据 |
| `runtime-guide.md` | 作为 `skillsMarkdown` 注入 LLM 操作模式系统提示 |

生成前先阅读参考实现：`src/site-packs/demo/`。

---

## 工作流清单

复制并跟踪进度：

```
站点包构建：
- [ ] 1. 站点标识（name、siteId、version）
- [ ] 2. 能力地图（各模块 + 增删改查）
- [ ] 3. 路由与导航
- [ ] 4. Playbooks（每个高频流程一条）
- [ ] 5. Entrypoints（触发词 → playbookId）
- [ ] 6. API 与 DOM 边界
- [ ] 7. 风险策略（禁止 / 需确认）
- [ ] 8. runtime-guide.md（与 playbook 一致）
- [ ] 9. 接入 main.ts / embed
- [ ] 10. 一致性检查（见「交付前校验」）
```

每轮只问 **1～2 组** 问题，不要一次性抛完所有问题。

---

## 框架如何使用站点包

理解这一点，可避免「配置看起来对、运行却失败」。

| 配置项 | 运行时行为 |
|--------|------------|
| **playbooks** | 用户消息匹配 `triggers` → 框架**直接执行** playbook 步骤（可靠路径）；LLM 负责解释、跟进与未匹配意图的规划 |
| **entrypoints** | 产品入口索引：label + triggers + `playbookId`；通过 `formatPackContextForAgent` 注入 LLM 上下文 |
| **capabilities** | 可读的能力模块列表，帮 LLM 界定可自动化范围 |
| **routes** | 页面地图，辅助导航规划 |
| **skillsMarkdown**（`runtime-guide.md`） | 始终注入操作模式系统提示；**不得与 playbook 矛盾** |
| **apis** | 有 JS/REST 暴露时优先于 DOM；未注册则无 API 兜底 |
| **blockedActions / riskPolicies** | 执行前硬拦截或要求确认 |
| **overlaySelectors** | 快照时排除助手自身 UI |

**LLM + 站点包分工（不要只设计其中一侧）：**

- 匹配 playbook → 先跑标准步骤
- 未匹配 → LLM 结合 runtime-guide + 快照 + 站点包索引规划
- 弹窗 / 晚出现的元素 → playbook 保留 `find`；框架在**执行时**再解析（规划阶段可能还看不到）

**框架已负责（站点包不要重复实现）：**

- 必填识别（控件上的 `required` / `aria-required`）
- 提交前校验、缺必填时向用户追问
- 快照中的 `[required]` 标记

站点包应在 `runtime-guide.md` 写明**哪些字段必填**，便于 LLM 主动填写；宿主页面用标准 HTML `required` / `aria-required` 即可。

---

## 信息采集问题

### A 组 — 基本信息
- 网站类型（SaaS 后台、电商、门户等）？
- `siteId` 建议（小写连字符，如 `acme-crm`）
- 显示名称与版本（默认 `0.1.0`）

### B 组 — 模块与 CRUD
对每个用户关心的模块：
- 查 / 增 / 改 / 删 — 哪些有？
- 按钮上的**可见文字**（中英文原文）
- 是否只有弹窗里才有的操作？

### C 组 — 单流程细节（每个 playbook 重复）
对每个候选自动化流程：
1. **触发词**（用户会怎么说，3～8 种说法）
2. **步骤**（用可见 UI 文字描述：菜单 → 按钮 → 字段 → 提交）
3. **控件类型**：
   - 原生 `<select>` → playbook 用 `select` + `role: combobox`
   - 文本/数字 → `input` + `role: textbox`
   - 组件库自定义下拉（Element/Ant Design）→ 在 guide 中说明，可能需要 click 打开选项
4. **必填项**及 playbook 中的示例默认值
5. 是否跨页？（先导航 → 开弹窗 → 提交）

### D 组 — API
- 可调用的 JS 函数或 REST？
- 名称、参数、返回结构
- 哪些数据**禁止**读 DOM？

### E 组 — 安全
- 必须禁止自动执行的操作（删账号、大额转账等）
- 需用户二次确认才可执行的操作

### F 组 — 导航
- 侧栏 / Tab / hash 路由 / path 路由
- 页面上显示的标题文字

用户描述模糊时，追问**按钮和标签在屏幕上的原文**，不要猜 CSS 选择器或 `data-testid`。

---

## Playbook 编写规范

### 结构示例

```typescript
{
  id: 'create_customer',           // snake_case，稳定不变
  description: '新增一名客户',        // 确认 UI 中展示
  triggers: ['新增客户', '创建客户', '添加客户'],
  steps: [
    { tool: 'snapshot', explanation: '采集当前页面' },
    { tool: 'click', find: { textContains: '客户管理' }, explanation: '进入客户管理' },
    { tool: 'snapshot', explanation: '采集列表页' },
    { tool: 'click', find: { textContains: '新增客户' }, explanation: '打开弹窗' },
    { tool: 'snapshot', explanation: '采集表单' },
    { tool: 'input', find: { role: 'textbox', textContains: '客户名称' }, inputValue: '示例公司', explanation: '填写客户名称' },
    { tool: 'select', find: { role: 'combobox', textContains: '客户等级' }, selectValue: '标准', explanation: '选择等级' },
    { tool: 'input', find: { role: 'textbox', textContains: '联系人' }, inputValue: '张三 13800001234', explanation: '填写联系人' },
    { tool: 'click', find: { textContains: '保存' }, explanation: '保存' },
  ],
}
```

### 规则

1. 流程以 `snapshot` 开头；导航或打开弹窗后再 `snapshot`
2. `find.textContains` 必须匹配**页面上真实出现的文字**
3. 优先 `find`，少用 `ref`（ref 会随快照刷新变化）
4. 下拉框：**`select`**，禁止用 `input` 编造选项文字
5. 新增/编辑 playbook 须覆盖**全部必填项**，并给出合理 `inputValue` / `selectValue`
6. 纯 API 流程：一步 `api`，不要用 DOM 读同一份数据
7. 删除流程：行内删除 → 确认弹窗 → 点「确认删除」（或站点实际确认按钮文案）
8. 一个用户意图一条 playbook；CRUD 拆成 `create_*` / `edit_*` / `delete_*`

### 工具选用

| tool | 场景 |
|------|------|
| `snapshot` | 导航前/后、弹窗打开后 |
| `click` | 按钮、链接、菜单 |
| `input` | textbox / textarea / 数字框 |
| `select` | 原生 `<select>` / combobox |
| `api` | 站点包 `apis` 中已注册的接口 |
| `goto` | 整页 URL 跳转（少用，优先点菜单导航） |

---

## runtime-guide.md 规范

必须与 `index.ts` 中的 playbook **一致**。建议章节：

1. **可自动化功能** — 按模块表格：路径 + 控件类型 + 必填项
2. **业务接口** — API 名、何时用、禁止用 DOM 替代
3. **禁止操作** — 与 `blockedActions` / `riskPolicies` 一致
4. **页面导航** — 菜单文案、路由说明、弹窗时机
5. **操作规范** — 先 snapshot；combobox 用 select；textbox 用 input；匹配 playbook 时走标准步骤

**常见不一致（务必避免）：**

| guide 里错的写法 | 正确写法 |
|------------------|----------|
| 下拉框写「填写客户名称」 | 「用 select 选择客户」 |
| 漏写必填项 | 每个表单列出全部必填字段 |
| playbook 用 select，guide 写 input | 两侧控件类型一致 |

---

## index.ts 模板

```typescript
import type { SitePack } from '../../framework/types';
import runtimeGuide from './runtime-guide.md?raw';
// 按需导入宿主 API：
// import { fetchStats } from '../../host-app/api';

export const mySitePack: SitePack = {
  siteId: '<site-id>',
  name: '<显示名>',
  version: '0.1.0',
  skillsMarkdown: runtimeGuide,

  theme: { accent: '#2563eb' }, // 可选

  capabilities: [
    { id: 'orders', label: '订单管理', description: '订单增删改查' },
  ],

  entrypoints: [
    { id: 'create-order', label: '创建订单', triggers: ['创建订单', '新建订单'], playbookId: 'create_order' },
  ],

  routes: [
    { path: '/orders', title: '订单管理', description: '列表与新建' },
  ],

  permissions: [
    { id: 'write-orders', scope: 'orders:write', description: '创建订单' },
  ],

  riskPolicies: [
    {
      id: 'block-delete-account',
      level: 'high',
      blocked: true,
      reason: '删除账号需人工操作',
      when: { action: 'click', textContains: '注销' },
    },
  ],

  overlaySelectors: ['[data-im-overlay]'],

  blockedActions: [
    {
      id: 'block-delete-account',
      reason: '删除账号需人工操作',
      when: { action: 'click', textContains: '注销' },
    },
  ],

  requireConfirm: [],

  apis: {
    // getStats: async () => ({ success: true, message: '...', data: {} }),
  },

  playbooks: [
    // 见「Playbook 编写规范」
  ],
};
```

---

## 接入方式

```typescript
// src/main.ts（或宿主入口）
import { InterfaceModeRuntime } from './framework/runtime';
import { mySitePack } from './site-packs/<site-id>';
import runtimeGuide from './site-packs/<site-id>/runtime-guide.md?raw';

new InterfaceModeRuntime({
  sitePack: mySitePack,
  skillsMarkdown: runtimeGuide,
});
```

调试：在关键页面/弹窗执行 `window.__im.snapshot()`，核对标签、`[required]`、combobox 与 textbox 是否识别正确。

---

## 交付前校验

生成后逐项核对（可请用户在真实页面上确认）：

- [ ] 每个 `entrypoints[].playbookId` 在 `playbooks` 中存在
- [ ] 每条 playbook 的 `triggers` 至少 2 个自然说法
- [ ] 新增/编辑 playbook 填写了**全部**必填项
- [ ] 没有对 combobox 使用 `input`
- [ ] `runtime-guide.md` 控件类型与 playbook 工具一致
- [ ] API 流程没有多余的 DOM 读取步骤
- [ ] `blockedActions` 文案与真实按钮一致
- [ ] `overlaySelectors` 排除了助手 UI
- [ ] `find.textContains` 在真实 UI 或快照中能找到（用户确认或 snapshot 验证）

校验不通过时，**同时**修改 `index.ts` 与 `runtime-guide.md`。

---

## 反模式

| 反模式 | 后果 |
|--------|------|
| playbook 与 guide 控件类型不一致 | LLM 乱规划或覆盖可靠 playbook |
| 核心流程只靠 LLM、不写 playbook | 下拉选择失败、假成功 |
| 在站点包里硬编码必填校验逻辑 | 框架已通用处理 `required`，重复且绑死站点 |
| playbook 里写 CSS 选择器 | 易碎；除非宿主团队坚持，否则用可见文字 |
| 一条巨型 playbook 包打天下 | 触发词难匹配；应按意图拆分 |
| 导航后不做 `snapshot` | 元素树过期，find 失败 |

---

## 生成后告知用户

1. 文件路径与内容概要
2. 如何在 `main.ts` / embed 中接入
3. 每个 entrypoint 建议的测试口令
4. 提醒：宿主表单应使用 `required` / `aria-required`，框架才能做必填校验与追问
5. 建议在关键页面运行 `window.__im.snapshot()` 验证 find 条件

---

## 延伸阅读

- 类型定义：`src/framework/types.ts`（`SitePack`、`Playbook`、`PlaybookStep`）
- 演示站点包：`src/site-packs/demo/index.ts`、`runtime-guide.md`
- 规划器：`src/framework/planner.ts`（触发匹配、延迟 find）
- 操作模式系统提示：`src/framework/transport.ts`（`INTERFACE_MODE_SYSTEM`）
