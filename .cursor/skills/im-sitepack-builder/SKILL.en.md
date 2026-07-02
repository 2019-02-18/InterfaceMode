---
name: im-sitepack-builder
description: >-
  Guides creation of InterfaceMode SitePack configs (index.ts + runtime-guide.md)
  for automating a website via the assistant. Covers capabilities, entrypoints,
  routes, playbooks, APIs, and risk policies aligned with framework execution.
  Use when the user asks to generate a site pack, onboard a site to InterfaceMode,
  write assistant config for a web app, or says im sitepack / 站点包 / 接入 InterfaceMode.
---

# InterfaceMode SitePack Builder

## Deliverables

Generate **two files** under `src/site-packs/<site-id>/`:

| File | Purpose |
|------|---------|
| `index.ts` | Typed `SitePack` — playbooks, APIs, policies, metadata |
| `runtime-guide.md` | Injected into LLM system prompt as `skillsMarkdown` |

Reference implementation: `src/site-packs/demo/` (read before generating).

---

## Workflow checklist

Copy and track progress:

```
SitePack build:
- [ ] 1. Site identity (name, siteId, version)
- [ ] 2. Capability map (modules + CRUD per module)
- [ ] 3. Routes & navigation
- [ ] 4. Playbooks (one per high-frequency flow)
- [ ] 5. Entrypoints (trigger → playbookId)
- [ ] 6. APIs vs DOM boundaries
- [ ] 7. Risk policies (blocked / confirm)
- [ ] 8. runtime-guide.md (aligned with playbooks)
- [ ] 9. Wire in main.ts / embed
- [ ] 10. Consistency review (see Validation)
```

Ask **1–2 question groups per turn**. Do not dump all questions at once.

---

## How the framework uses a SitePack

Understanding this prevents configs that look correct but fail at runtime.

| Piece | Runtime behavior |
|-------|------------------|
| **playbooks** | User message matches `triggers` → framework runs playbook steps **directly** (reliable path). LLM handles explanation, follow-up, and unmatched intents. |
| **entrypoints** | Product-level index: label + triggers + `playbookId`. Documented in LLM context via `formatPackContextForAgent`. |
| **capabilities** | Human-readable module list; helps LLM scope what is automatable. |
| **routes** | Page map for navigation planning. |
| **skillsMarkdown** (`runtime-guide.md`) | Always injected into operate-mode system prompt. Must **not contradict** playbooks. |
| **apis** | Preferred over DOM when data or actions are exposed in JS. No API = no automatic API fallback. |
| **blockedActions / riskPolicies** | Hard stops or confirm gates before execution. |
| **overlaySelectors** | Exclude assistant UI from page snapshot. |

**LLM + SitePack split (do not design for either alone):**

- Matched playbook → execute standard steps first
- Unmatched intent → LLM plans using runtime-guide + snapshot + pack index
- Modal / late-appearing elements → playbook steps keep `find` specs; framework resolves at **execution** time (planning may not see the element yet)

**Framework-owned (do not duplicate in SitePack):**

- Required-field detection (`required` / `aria-required` on controls)
- Submit-time validation and asking user to supply missing values
- Snapshot `[required]` markers

SitePack should document **which fields are required** in `runtime-guide.md` so LLM fills them proactively; the host page should use standard HTML `required` / `aria-required`.

---

## Discovery questions

### Group A — Identity
- What is the site (SaaS admin, shop, portal)?
- Proposed `siteId` (lowercase-hyphen, e.g. `acme-crm`)
- Display name and version (default `0.1.0`)

### Group B — Modules & CRUD
For each module the user cares about:
- List / create / edit / delete — which exist?
- Visible button labels (exact Chinese/English text on screen)
- Any modal-only flows?

### Group C — Per-flow detail (repeat per playbook)
For each automation candidate:
1. **Trigger phrases** users actually say (3–8 variants)
2. **Steps** as visible UI text: menu → button → field → submit
3. **Control type** per field:
   - native `<select>` → playbook `select` + `role: combobox`
   - text/number → `input` + `role: textbox`
   - custom dropdown (Element/Ant Design) → note in guide; may need click-to-open pattern
4. **Required fields** and example values for demo defaults
5. Cross-page? (navigate → open modal → submit)

### Group D — APIs
- Callable JS functions or REST endpoints for read/write?
- Name, args, return shape
- What must **never** be read from DOM?

### Group E — Safety
- Operations that must be blocked (delete account, wire transfer, …)
- Operations needing user confirm before run

### Group F — Navigation
- Sidebar / tabs / hash routes / path routes
- Page titles as shown in UI

If the user is vague, ask for **exact visible text** on buttons and labels — not CSS selectors, not `data-testid`.

---

## Playbook authoring rules

### Structure

```typescript
{
  id: 'create_customer',
  description: '新增一名客户',
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

### Rules

1. Start flows with `snapshot`; add `snapshot` after navigation or opening modals
2. `find.textContains` must match **on-screen text** (label area or button text)
3. Prefer `find` over `ref` — refs are ephemeral
4. Dropdowns: **`select`**, never `input` with invented text
5. Include **all required fields** in create/edit playbooks with sensible `inputValue` / `selectValue`
6. API-only flows: single `api` step, no DOM scraping for the same data
7. Delete flows: click row action → confirm dialog → `确认删除` (or site-specific confirm label)
8. One playbook per user intent; split CRUD into separate playbooks (`create_*`, `edit_*`, `delete_*`)

### Tools

| tool | When |
|------|------|
| `snapshot` | Before/after navigation or modal open |
| `click` | Buttons, links, menu items |
| `input` | textbox / textarea / number |
| `select` | native `<select>` / combobox |
| `api` | Registered `apis` in SitePack |
| `goto` | Full URL navigation (rare; prefer click nav) |

---

## runtime-guide.md rules

Must mirror `index.ts` playbooks. Sections:

1. **可自动化功能** — per module table: path + control types + required fields
2. **业务接口** — API name, when to use, never DOM for same data
3. **禁止操作** — matches `blockedActions` / `riskPolicies`
4. **页面导航** — menu labels, route notes, modal timing
5. **操作规范** — snapshot first; combobox=`select`; textbox=`input`; playbook match = standard steps

**Critical alignments (common failures):**

| Wrong in guide | Right |
|----------------|-------|
| "填写客户名称" for a dropdown | "用 select 选择客户" |
| Omit required fields | List every required field per form |
| Playbook uses select, guide says input | Same control type in both |

---

## index.ts template

```typescript
import type { SitePack } from '../../framework/types';
import runtimeGuide from './runtime-guide.md?raw';

export const mySitePack: SitePack = {
  siteId: '<site-id>',
  name: '<显示名>',
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
  blockedActions: [],
  requireConfirm: [],
  apis: {},
  playbooks: [],
};
```

---

## Wiring

```typescript
import { InterfaceModeRuntime } from './framework/runtime';
import { mySitePack } from './site-packs/<site-id>';
import runtimeGuide from './site-packs/<site-id>/runtime-guide.md?raw';

new InterfaceModeRuntime({
  sitePack: mySitePack,
  skillsMarkdown: runtimeGuide,
});
```

Debug: `window.__im.snapshot()` — verify labels, `[required]`, combobox vs textbox.

---

## Validation before delivery

- [ ] Every `entrypoints[].playbookId` exists in `playbooks`
- [ ] Every playbook `triggers` has ≥2 natural phrases
- [ ] Create/edit playbooks fill **all** required fields
- [ ] No `input` steps targeting combobox fields
- [ ] `runtime-guide.md` control types match playbook tools
- [ ] API flows have no redundant DOM read steps
- [ ] `blockedActions` text matches real button labels
- [ ] `overlaySelectors` excludes assistant chrome
- [ ] `find.textContains` strings appear in actual UI

---

## Anti-patterns

| Anti-pattern | Why |
|--------------|-----|
| Playbook + guide disagree on field types | LLM overrides good playbooks or mis-plans |
| Only LLM, no playbooks for core flows | Unreliable selects, false success |
| Hardcode demo validation in SitePack | Framework already handles `required` generically |
| CSS selectors in playbooks | Fragile; use visible text |
| Single giant playbook | Hard to match triggers |
| Skip `snapshot` after navigation | Stale element tree |

---

## Additional reference

- `src/framework/types.ts`
- `src/site-packs/demo/`
- `src/framework/planner.ts`
- `src/framework/transport.ts`
