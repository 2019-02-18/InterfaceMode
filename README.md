# InterfaceMode

> 可嵌入网站的 **AI 界面操作助手框架**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-purple.svg)](https://vitejs.dev/)

InterfaceMode 让 AI 助手像真实用户一样操作网页界面——理解意图、规划步骤、执行点击 / 填表 / 选下拉 / 导航，并通过视觉高亮和虚拟光标实时反馈每一步动作。

框架本身**不绑定任何业务**。对每一个目标网站，编写一份 **SitePack（站点包）**，声明可自动化能力、标准操作流程（playbooks）、业务 API 与风险策略；LLM 在站点包约束下处理解释、补全与未匹配意图。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    目标网站 / 宿主页面                     │
│                                                         │
│  ┌──────────────┐   ┌──────────────────────────────┐   │
│  │  业务 HTML   │   │   InterfaceMode 框架           │   │
│  │  (不需改造)  │   │                              │   │
│  │             │   │  Runtime ←→ LLM (流式 SSE)    │   │
│  │             │   │     ↓                         │   │
│  │             │◄──│  Executor  Visual  Policy      │   │
│  │             │   │     ↑                         │   │
│  │             │   │  Snapshot (DOM 语义快照)       │   │
│  └──────────────┘   └──────────────────────────────┘   │
│                              ↑                          │
│                        SitePack（站点包）                 │
│         playbooks / entrypoints / apis / policy         │
└─────────────────────────────────────────────────────────┘
```

| 模块 | 职责 |
|------|------|
| `runtime.ts` | 悬浮窗 UI、任务状态、多轮执行、失败恢复、LLM + playbook 协作 |
| `task-state.ts` | 任务生命周期与 sessionStorage 持久化 |
| `snapshot.ts` | DOM 遍历 → 语义化 YAML 树（含 `[required]` 标记） |
| `executor.ts` | click / input / select / goto；提交前必填校验 |
| `validation.ts` | 框架级必填项解析与追问文案 |
| `visual.ts` | 高亮遮罩、虚拟光标、屏幕光环动画 |
| `policy.ts` | blockedActions / riskPolicies / requireConfirm |
| `transport.ts` | 流式 SSE LLM 调用、tool_calls 解析 |
| `settings.ts` | DeepSeek / Qwen / OpenAI 配置持久化 |
| `planner.ts` | playbook 触发匹配、步骤解析（find 延迟到执行时） |

### LLM 与站点包如何配合

1. 用户消息匹配 playbook `triggers` → **优先执行标准步骤**（可靠路径）
2. 未匹配时 → LLM 结合 `runtime-guide.md` + 页面快照 + 站点包索引自由规划
3. 弹窗内元素在规划时可能不存在 → playbook 保留 `find`，执行时再解析
4. 必填校验由框架负责（`required` / `aria-required`），缺项时向用户追问后补全

---

## 快速接入

### 第一步：安装

```bash
git clone https://github.com/your-org/interface-mode.git
cd interface-mode
npm install
```

### 第二步：创建 SitePack

```typescript
// src/site-packs/my-site/index.ts
import type { SitePack } from '../../framework/types';
import runtimeGuide from './runtime-guide.md?raw';

export const sitePack: SitePack = {
  siteId: 'my-site',
  name: '我的系统',
  version: '0.1.0',
  skillsMarkdown: runtimeGuide,

  capabilities: [
    { id: 'orders', label: '订单管理', description: '订单增删改查' },
  ],
  entrypoints: [
    { id: 'create-order', label: '创建订单', triggers: ['创建订单', '新建订单'], playbookId: 'create_order' },
  ],
  routes: [
    { path: '/orders', title: '订单管理', description: '列表与新建' },
  ],

  overlaySelectors: ['[data-im-overlay]'],

  blockedActions: [
    {
      id: 'block-delete-account',
      reason: '删除账号需用户亲自操作',
      when: { action: 'click', textContains: '注销账号' },
    },
  ],
  requireConfirm: [],

  apis: {
    getRevenue: async () => {
      const data = await window.myApp.getRevenue();
      return { success: true, message: `今日营收：¥${data.total}` };
    },
  },

  playbooks: [
    {
      id: 'create_order',
      description: '创建订单',
      triggers: ['创建订单', '新建订单', '下单'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '订单管理' }, explanation: '进入订单管理' },
        { tool: 'snapshot', explanation: '采集列表页' },
        { tool: 'click', find: { textContains: '新建订单' }, explanation: '打开弹窗' },
        { tool: 'snapshot', explanation: '采集表单' },
        { tool: 'select', find: { role: 'combobox', textContains: '客户' }, explanation: '选择客户' },
        { tool: 'input', find: { role: 'textbox', textContains: '数量' }, inputValue: '1', explanation: '填写数量' },
        { tool: 'click', find: { textContains: '提交订单' }, explanation: '提交' },
      ],
    },
  ],
};
```

`runtime-guide.md` 必须与 playbook **控件类型一致**（下拉用 `select`，文本用 `input`），并列出各表单必填项。

### 第三步：初始化助手

```typescript
import { InterfaceModeRuntime } from './framework/runtime';
import { sitePack } from './site-packs/my-site';
import runtimeGuide from './site-packs/my-site/runtime-guide.md?raw';

new InterfaceModeRuntime({
  sitePack,
  skillsMarkdown: runtimeGuide,
});
```

> **作为独立 JS 文件嵌入**：
> ```bash
> npm run build:lib    # dist/lib/im.umd.js
> ```
> ```html
> <script src="/path/to/im.umd.js"></script>
> <script>
>   new InterfaceMode.InterfaceModeRuntime({ sitePack: window.mySitePack, skillsMarkdown: '...' });
> </script>
> ```

---

## SitePack 规范

```typescript
interface SitePack {
  siteId: string;
  name: string;
  version: string;
  skillsMarkdown: string;           // runtime-guide.md，注入 LLM 系统提示

  capabilities?: SitePackCapability[]; // 能力模块声明
  entrypoints?: SitePackEntrypoint[]; // 入口：triggers + playbookId
  routes?: SitePackRoute[];          // 页面路由说明
  permissions?: SitePackPermission[];

  playbooks?: Playbook[];            // 标准操作流程（匹配后优先执行）
  apis?: Record<string, ApiHandler>;
  blockedActions: PolicyRule[];
  requireConfirm?: FindSpec[];
  riskPolicies?: SitePackRiskPolicy[];
  overlaySelectors?: string[];
  theme?: SitePackTheme;
}
```

完整类型见 [`src/framework/types.ts`](src/framework/types.ts)。参考实现：[`src/site-packs/demo/`](src/site-packs/demo/)。

---

## 使用 Cursor Skill 生成 SitePack

项目内置 **im-sitepack-builder** Skill（`.cursor/skills/im-sitepack-builder/`），引导采集信息并生成 `index.ts` + `runtime-guide.md`。

在 Cursor 中：

```
为「XXX 管理系统」生成站点包，接入 InterfaceMode
```

Skill 会按模块梳理 CRUD、触发词、控件类型（combobox / textbox）、API 边界与风险策略。中文版见 `SKILL.md`，英文见 `SKILL.en.md`。

---

## AI 配置

首次打开助手，点击 **⚙ 设置** 配置大模型 API（操作模式必需）：

| 提供商 | 推荐模型 |
|--------|---------|
| DeepSeek | `deepseek-chat` |
| 通义千问 | `qwen-plus` / `qwen-max` |
| OpenAI 兼容 | 任意 OpenAI 接口 |

配置保存在 `localStorage`，不上传服务器。未配置 API Key 时仅支持本地 playbook 匹配（功能受限）。

---

## 视觉反馈

- **高亮遮罩**：目标元素蓝色轮廓
- **虚拟光标**：模拟移动轨迹
- **屏幕光环**：执行时四角渐显

通过 a11y 语义与可见文字定位元素，不依赖 `data-testid`。

---

## 演示页

`src/demo-app/` 为模拟 **SaaS 商户后台**（订单 / 客户 / 商品 / 退款 / 开票 / 成员等模块，含增删改查）。刻意不使用自动化专用标记，验证框架对真实 DOM 的适应。

```bash
npm run dev    # http://localhost:5173
```

可试指令：

| 指令 | 能力 |
|------|------|
| `创建订单` | playbook + 下拉选择 + 表单联动 |
| `新增客户` | 弹窗填表；缺必填项时框架追问 |
| `编辑客户` / `删除客户` | 列表行操作 + 确认弹窗 |
| `今日营收` | 站点包 API（不读 DOM） |
| `全站巡检` | 跨页面 snapshot |
| `注销商户` | blockedActions 拦截 |

调试：`window.__im.snapshot()` 查看元素树与 `[required]` 标记。

---

## 目录结构

```
interface-mode/
├── src/
│   ├── framework/
│   │   ├── runtime.ts           # UI、任务、执行调度
│   │   ├── task-state.ts        # 任务状态与持久化
│   │   ├── snapshot.ts          # DOM 快照
│   │   ├── executor.ts          # 命令执行
│   │   ├── validation.ts        # 必填项通用逻辑
│   │   ├── planner.ts           # playbook 匹配与解析
│   │   ├── policy.ts / transport.ts / visual.ts / ...
│   │   └── index.ts
│   ├── site-packs/demo/         # 演示站点包（参考实现）
│   ├── demo-app/                # 演示业务页
│   └── main.ts
├── .cursor/skills/im-sitepack-builder/
├── package.json
└── vite.config.ts
```

---

## 开发

```bash
npm run dev          # 演示（热更新）
npm run build        # 构建演示
npm run build:lib    # 构建框架库
npm run build:pages  # GitHub Pages 演示
```

### 为新网站开发站点包

1. 在 Cursor 中说「为 XXX 生成站点包」
2. 按 Skill 引导提供模块、按钮文案、控件类型、API、禁止操作
3. 生成 `index.ts` 与 `runtime-guide.md`，确保两者一致
4. 宿主表单使用 `required` / `aria-required` 以启用框架必填校验
5. `window.__im.snapshot()` 验证 find 条件

---

## 许可证

基于 **Apache License 2.0** 开源。详见 [LICENSE](LICENSE)。
