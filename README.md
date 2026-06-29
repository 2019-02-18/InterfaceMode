# InterfaceMode

> 可嵌入网站的 **AI 界面操作助手框架**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-purple.svg)](https://vitejs.dev/)

InterfaceMode 让 AI 助手像真实用户一样操作网页界面——理解意图、规划步骤、执行点击 / 填表 / 导航，并通过视觉高亮和虚拟光标实时反馈每一步动作。

框架本身**不绑定任何业务**。对每一个目标网站，只需编写一份轻量的 **SitePack（站点包）**，即可让助手了解该网站的可自动化功能、调用业务 API、以及哪些操作需要拦截或二次确认。

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
│  │             │   │  Snapshot (DOM 快照)           │   │
│  └──────────────┘   └──────────────────────────────┘   │
│                              ↑                          │
│                        SitePack（站点包）                 │
│                   playbooks / apis / policy             │
└─────────────────────────────────────────────────────────┘
```

| 模块 | 职责 |
|------|------|
| `runtime.ts` | 悬浮窗 UI、对话管理、多轮 Agentic 执行循环 |
| `snapshot.ts` | DOM 遍历 → 语义化 YAML 树（不依赖 testid） |
| `executor.ts` | click / input / select / goto，含视觉时序 |
| `visual.ts` | 高亮遮罩、虚拟光标、屏幕光环动画 |
| `policy.ts` | blockedActions / requireConfirm 拦截 |
| `transport.ts` | 流式 SSE LLM 调用、tool_calls 解析 |
| `settings.ts` | DeepSeek / Qwen / OpenAI 配置持久化 |
| `planner.ts` | （可选）离线 playbook 关键词匹配，无需 LLM |

---

## 快速接入

### 第一步：安装

```bash
# 将框架源码复制到你的项目，或作为子模块引入
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
  skillsMarkdown: runtimeGuide,        // AI 运行时系统提示词
  overlaySelectors: ['[data-im-overlay]'],  // 排除助手自身 UI

  // 禁止自动执行的高危操作
  blockedActions: [
    {
      id: 'block-delete-account',
      reason: '删除账号需用户亲自操作，已为您定位到按钮',
      when: { action: 'click', textContains: '注销账号' },
    },
  ],

  // 需要二次确认的操作
  requireConfirm: [
    { action: 'click', textContains: '批量删除' },
  ],

  // 调用系统内置 JS API（优先于 DOM 操作）
  apis: {
    getRevenue: async () => {
      const data = await window.myApp.getRevenue();
      return { success: true, message: `今日营收：¥${data.total}` };
    },
  },

  // 预定义操作步骤（可选，有 LLM 时可省略）
  playbooks: [
    {
      id: 'create_order',
      description: '创建订单',
      triggers: ['创建订单', '新建订单', '下单'],
      steps: [
        { tool: 'snapshot', explanation: '采集当前页面' },
        { tool: 'click', find: { textContains: '新建订单' }, explanation: '点击新建' },
        { tool: 'snapshot', explanation: '等待表单出现' },
        { tool: 'input', find: { textContains: '客户名称' }, value: '{{customerName}}', explanation: '填写客户' },
        { tool: 'click', find: { textContains: '提交' }, explanation: '提交表单' },
      ],
    },
  ],
};
```

### 第三步：初始化助手

```typescript
// main.ts（目标网站的入口）
import { InterfaceModeRuntime } from './framework/runtime';
import { sitePack } from './site-packs/my-site';

new InterfaceModeRuntime({ sitePack });
// 助手悬浮窗自动挂载，无需额外 HTML
```

> **作为独立 JS 文件嵌入**（不修改源码）：
> ```bash
> npm run build:lib          # 输出 dist/lib/im.umd.js
> ```
> ```html
> <!-- 目标网站 HTML -->
> <script src="/path/to/im.umd.js"></script>
> <script>
>   new InterfaceMode.InterfaceModeRuntime({ sitePack: window.mySitePack });
> </script>
> ```

---

## SitePack 规范

```typescript
interface SitePack {
  siteId: string;                 // 唯一标识（英文小写+连字符）
  name: string;                   // 显示名称
  version: string;                // 版本号
  skillsMarkdown: string;         // 运行时 AI 系统提示词（runtime-guide.md）
  overlaySelectors?: string[];    // 助手 UI 元素 CSS 选择器（排除快照）

  blockedActions?: PolicyRule[];  // 绝对禁止的操作
  requireConfirm?: FindSpec[];    // 执行前需用户确认的操作

  apis?: Record<string, (args?: any) => Promise<ToolResult>>;  // 业务接口
  playbooks?: Playbook[];         // 预定义操作步骤序列
}
```

完整类型定义见 [`src/framework/types.ts`](src/framework/types.ts)。

---

## 使用 Cursor Skill 生成 SitePack

项目内置了一个 **Cursor Agent Skill**，可自动引导开发者通过对话生成完整的站点包。

### 安装 Skill

```
# 项目级（仅本项目可用）
.cursor/skills/im-sitepack-builder/SKILL.md   ← 已包含

# 用户级（所有项目可用）
~/.cursor/skills/im-sitepack-builder/SKILL.md  ← 已安装
```

### 使用方式

在 Cursor 对话框中直接描述需求：

```
为「XXX 管理系统」生成站点包，接入 InterfaceMode 助手
```

AI 将引导你完成五个阶段的信息采集，最终输出：
- `src/site-packs/<site-id>/index.ts`
- `src/site-packs/<site-id>/runtime-guide.md`

> Skill 与具体网站解耦，适用于任何系统。

---

## AI 配置

首次打开助手，点击右上角 **⚙ 设置** 配置大模型 API：

| 提供商 | 推荐模型 |
|--------|---------|
| DeepSeek | `deepseek-chat` |
| 通义千问 (Qwen) | `qwen-plus` / `qwen-max` |
| OpenAI 兼容 | 任意 OpenAI 接口 |
| 自定义 | 填入 Base URL 和 Key |

配置通过 `localStorage` 持久化，不会上传到任何服务器。

---

## 视觉反馈系统

执行操作时，框架自动在页面上叠加：

- **高亮遮罩**：目标元素边框高亮（蓝色轮廓）
- **虚拟光标**：模拟鼠标移动轨迹
- **屏幕光环**：操作时屏幕四角渐显光环，增强感知

无需任何特殊标记，框架通过 a11y 语义（`aria-label`、`label[for]`、可见文字）定位元素。

---

## 演示页

`src/demo-app/` 包含一个完整的模拟商户后台，仅供**框架功能演示**。演示页刻意不添加 `data-testid` 等自动化友好标记，验证框架对真实网站的适应能力。

```bash
npm run dev    # http://localhost:5173
```

演示指令：

| 指令 | 演示的能力 |
|------|-----------|
| `创建一笔订单` | 多步 DOM 操作（导航 → 填表 → 提交） |
| `查看今日营收` | 优先调用站点包 API |
| `注销商户` | blockedActions 拦截 |
| `帮我退款` | 未配置时明确提示，不猜测 |

> 演示页的 SitePack 位于 `src/site-packs/demo/`，可作为开发新站点包的参考。

---

## 目录结构

```
interface-mode/
├── src/
│   ├── framework/               # 框架核心（与业务无关）
│   │   ├── types.ts             # 核心数据结构
│   │   ├── runtime.ts           # UI 和执行调度中心
│   │   ├── snapshot.ts          # DOM 语义化快照
│   │   ├── executor.ts          # 命令执行器 + 视觉时序
│   │   ├── visual.ts            # 视觉反馈层
│   │   ├── policy.ts            # 操作策略检查
│   │   ├── transport.ts         # LLM SSE 流式通信
│   │   ├── settings.ts          # API 配置管理
│   │   ├── planner.ts           # 离线 playbook 匹配
│   │   ├── embed.ts             # 库构建入口（npm run build:lib）
│   │   └── index.ts             # 框架公共导出
│   ├── site-packs/
│   │   └── demo/                # 演示站点包（参考实现）
│   │       ├── index.ts         # SitePack 配置
│   │       └── runtime-guide.md # AI 运行时系统提示词
│   ├── demo-app/                # 演示业务页（仅供参考）
│   └── main.ts                  # 演示入口
├── .cursor/
│   └── skills/
│       └── im-sitepack-builder/ # 站点包生成 Cursor Skill（项目级）
├── index.html
├── package.json
└── vite.config.ts
```

---

## 开发指南

```bash
npm run dev          # 启动演示（热更新）
npm run build        # 构建演示产物
npm run build:lib    # 构建框架库（dist/lib/im.umd.js + im.es.js）
```

### 调试

```javascript
// 浏览器控制台
window.__im.runtime   // InterfaceModeRuntime 实例
window.__im.snapshot() // 手动触发 DOM 快照，查看元素树
```

### 为新网站开发站点包

1. 在 Agent 中输入「为 XXX 网站生成站点包」启动 `im-sitepack-builder` Skill
2. 按提示回答 5 组问题（功能、API、禁止操作、页面结构）
3. Skill 生成 `index.ts` 和 `runtime-guide.md`
4. 在目标网站入口引入并实例化 `InterfaceModeRuntime`
5. 打开控制台运行 `window.__im.snapshot()` 验证元素采集

---

## 许可证

本项目基于 **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** 协议开源。

- ✅ 允许：学习、研究、修改、非商业项目部署
- ❌ 禁止：商业使用、销售、作为付费产品的核心组件
- 📌 要求：保留原作者署名

详见 [LICENSE](LICENSE) 文件。如需商业授权，请联系作者。
