# DB ER Diagram Viewer — 代码评审与改进建议（第二轮）

> 评审范围：`src/**` 全部源码（约 7.8k 行，TS/TSX 49 个文件 + 9 个 test 文件，68 个单测）。
> 评审时间：2026-05-23
> 评审角度：架构 / 可读性 / 组件化 / 可测试性 / 健壮性 / 工程化 / 安全。
> 上一轮：2026-05-22 的初次评审（B+，约 8.0/10）。本次复审。

---

## 一、总体结论

**整体评分：A−（约 8.7 / 10），较上一轮提升 0.7**

上一轮 Sprint 1 / Sprint 2 路线图中绝大多数条目已落地，几处"高优先级 + 中优先级"问题被一次性整改。代码风格、目录划分、测试覆盖、工程化（ESLint / Prettier / CI / Bun）四个维度都有明显前进，原来那个 1148 行的 `DiagramCanvas.tsx` 也成功瘦身到 444 行。

剩下的多是"架构层面更深一层"的问题——比如 parser 仍然是规则驱动而非 token 流、UI 层仍然零测试、本地持久化仍存在敏感数据落盘的隐私风险——它们都不是阻塞性的，但要再上一个台阶必须处理。

| 维度 | 上轮 | 本轮 | 备注 |
|---|---|---|---|
| 架构分层 | A | A | 仍然是 parser → infer → diagram + UI 的单向管道；store 拆 slice 后责任更内聚。 |
| 注释质量 | A | A | 继续保持"写为什么 / 写坑"的高信噪比；新加的注释直接引用上轮 review 编号（如 `cyHandle.ts` 里的 "see review P2"），形成可追溯链。 |
| TypeScript 使用 | A− | A− | strict 全开；`as any` 缩到 3 处（全部在 `diagram/style.ts` 里，给 cytoscape stylesheet 兼容用）。 |
| 组件化 / 模块化 | B− | **A−** | `DiagramCanvas` 1148 → 444 行；`App.tsx` 320 → 92 行；store 单文件 → 7 个 slice 文件。 |
| 状态管理 | B+ | **A−** | partialize 改为 denylist、版本号迁移、`cyInstance` 单例换成生命周期绑定的 `cyHandle`，`canonicalFkKey` 全链路统一。 |
| 健壮性 | B | **B+** | 未支持 SQL 显式 warning；`''` 双引号转义正确处理；测试从 30 → 68；但 parser 仍正则驱动，对极端 DDL 易脆。 |
| 测试覆盖 | C+ | **B** | 新增 routing/selection/utils/modules/sharding 五块纯函数测试；UI 层依旧零测试。 |
| 工程化 | C | **A−** | ESLint + Prettier + GitHub Actions CI 全部到位；Bun 接管包管理与脚本入口。 |
| 安全 / 隐私 | — | **B** | 已从 `localStorage` 改为 `sessionStorage`，敏感 DDL 不再在磁盘上长期沉淀；仍有 XSS 边界与潜在加密落盘需求待评估。 |

---

## 二、上一轮问题的落地情况盘点

为了让进度可被审计，逐条列出原编号 → 当前状态。

### ✅ 已完成

| ID | 问题 | 解决方式 | 证据 |
|---|---|---|---|
| **P1** | `DiagramCanvas.tsx` 1148 行 | 拆为 `overlay/` (3 文件) + `routing/` (3 文件 + 2 测试) + `selection/` (2 文件 + 1 测试) + `layout/` (2 文件)；主组件骨架 444 行 | `src/diagram/{overlay,routing,selection,layout}/` |
| **P3.4** | `applyIndexFlags` 重复 | 抽到 `parser/utils.ts`，`parser/index.ts` 和 `parseCreateTable.ts` 共用 | `src/parser/utils.ts:10-19` |
| **P3.1** | `''` 双引号转义错处理 | `tokenize.ts` 现在在 `isEscapedClose` 中显式区分 `\'` 与 `''` 两种转义 | `src/parser/tokenize.ts:40-58` |
| **P4** | `App.tsx` 内联 250 行 sidebar | 抽出到 `src/ui/sidebar/{Sidebar,CollapsedSidebarRail,GroupHeading}.tsx`；`App.tsx` 缩到 92 行 | `src/ui/sidebar/` |
| **P5** | `inferForeignKeys` 死代码 + FK key 三套规约 | 删除 `InferOptions.includeLow`；全链路统一用 `parser/utils.ts:canonicalFkKey`；persist 版本号 v1 → v2 做迁移 | `src/parser/utils.ts:39-43`、`src/store/index.ts:17` |
| **P6** | `store.ts` 单文件 300 行 | 拆为 `store/{index,schemaSlice,decisionsSlice,displaySlice,canvasSlice,selectors,pipeline}.ts` 7 个文件 | `src/store/` |
| **P7** | `partialize` allowlist | 改为 denylist：`DERIVED_OR_TRANSIENT_FIELDS` 排除 `schema/inferred/modules/flashTables/flashTick/search` | `src/store/index.ts:41-48` |
| **P8** | 缺 ESLint / Prettier / CI | 全部到位；CI 在 `.github/workflows/ci.yml` 走 `bun install --frozen-lockfile` + typecheck + lint + test + build | `.eslintrc.cjs`、`.prettierrc.json`、`.github/workflows/ci.yml` |
| **P9.1** | 纯函数测试缺失 | 新增 `computeSegments` / `computeEndpointOffset` / `closedNeighborhood` / `mergeShardedTables` / `tokenize` / `utils` / `inferModules` 测试，68 / 9 个文件 | `src/**/*.test.ts` |
| **P10** | `className` 拼接冗长 | 引入 `clsx`（1.1KB gzip） | `package.json`、`src/ui/overlays/Toolbar.tsx:2` |
| **P11** | tsconfig target 与 vite 不一致 | 显式 `tsconfig.target = "ES2022"` + `vite.config.ts: build.target = 'es2022'`，两边对齐 | `tsconfig.json:3`、`vite.config.ts:6-9` |
| **P12** | Toolbar 内联 110 行图标 | 抽到 `src/ui/overlays/icons.tsx` | `src/ui/overlays/icons.tsx` |
| **P13** | `measureText` 无缓存 | `buildGraph.ts` 加 `measureCache: Map<string, number>`，按 `text\0size\0weight` 缓存 | `src/diagram/buildGraph.ts:91-113` |
| **P14** | SQL 对话框无键盘快捷键 | `⌘/Ctrl+I` 打开、`⌘/Ctrl+Enter` 提交、`Esc` 关闭、自动 focus textarea；本轮又做了"上传 / 加载样例 / 拖拽 / 字符行数统计 / 主次按钮分级"的视觉升级 | `src/ui/overlays/SqlInputDialog.tsx` |
| **P15** | PG `COMMENT ON` 等静默丢失 | `parser/index.ts` 维护 `KNOWN_UNSUPPORTED` 数组：`COMMENT ON / CREATE VIEW / TRIGGER / FUNCTION / PROCEDURE / SEQUENCE / TYPE / MATERIALIZED VIEW` 全部产出 warning | `src/parser/index.ts:14-27` |
| **新** | localStorage 敏感 SQL 隐私 | 改用 `sessionStorage` —— 刷新仍在、关页即清；详见本文件后段加密方案对比 | `src/store/index.ts:19-26,63` |

### 🟡 部分完成

| ID | 问题 | 当前状态 |
|---|---|---|
| **P2** | `cyInstance` 单例破坏 React 数据流 | 已从"导出 `let cyInstance` 让外部直接读"重构为 `cyHandle.ts` 的 `bindCy()` / `unbindCy()` 配合组件 mount/unmount 生命周期。比上一轮干净很多，但**仍是模块级单例**——多实例场景（Storybook、SSR、并行测试）依旧会冲突。是否进一步改 Context 取决于是否真的要支持多实例；当前 ROI 不高，可以暂留。 |
| **P3** | parser 仍是正则驱动 | 抽 lexer 升级 token 流的工作未做。受影响场景：复合 CHECK 子句、PG 数组类型 `int[]`、`GENERATED AS` 计算列、嵌套 `COLLATE`——这些今天会安静地解析失败或丢失元数据。但因为现在有 KNOWN_UNSUPPORTED warning 兜底，至少不会"看起来工作但实际错的"。继续延后是合理的。 |
| **P3.5** | ALTER TABLE 丢失 schema 限定符 | 未确认是否修复，建议加测试。 |
| **P9.2** | SVG 导出快照测试 | 未补；`exports/toSvg.ts` 长到 486 行了，没快照风险很大。 |
| **P9.3** | Playwright 端到端 | 未补。 |

### ❌ 未开始

- 上一轮"性能"一节里的 **搜索 debounce**、**大 schema 分批渲染**：未做。50-200 表场景拖拽仍会卡。
- 上一轮"可观测性"一节：未做（开源工具不强求）。

---

## 三、本轮新发现的问题

代码变多 ≈ 表面积变大。复审中找到几处**之前没暴露**或**之前不存在**的问题。

### 🔴 高优先级

#### N1. `exports/toSvg.ts` 已达 486 行，是新的"单文件可维护性风险"

**位置**：`src/exports/toSvg.ts`

**问题**：和上一轮 P1（旧 DiagramCanvas）的剧本一样——一个文件承担了"画布 → SVG 字符串"的所有职责：度量、路径生成、字体内嵌、注释行换行、徽标 SVG、转义、文档头。SVG 输出又是用户最容易抓到 bug 的导出格式（边缘 case 极多：emoji、中文、超长列名、转义）。

**建议拆分**：
```
src/exports/svg/
├── index.ts                # 入口：toSvg(schema, fks, options)
├── header.ts               # XML 序言 / defs / 字体嵌入
├── tableCard.ts            # 单张表卡片（含徽标、列行）
├── edges.ts                # 边路径 + 箭头
├── escape.ts               # escapeText / escapeAttr（注意补全 `'`，见安全节）
└── layout.ts               # 自身的坐标布局（如果不复用 cy 的）
```

**收益**：每个文件 80–120 行，diff 友好；`escape` 单独抽出后可以加专门的单测，覆盖恶意表名注入。

---

#### N2. UI 层仍然零测试，重构 UI 时只靠 typecheck + 人眼

**位置**：`src/ui/**`、`src/diagram/overlay/**`

**问题**：上一轮 P9 已经指出，本轮纯函数测试补得很到位（68 个测试 9 个文件），但 React 组件依然零覆盖。重构 `Sidebar` / `Toolbar` / `InferencePanel`（这三个都已经过若干次大改动）时只能靠 typecheck 兜底。

**建议（性价比由高到低）**：
1. **`useApp` selectors 测试**：`effectiveForeignKeys`、`recomputeModules` 等纯函数已经能单测，把现成 selectors 跑一遍。
2. **快照测试**：`toSvg`、`toDdl` 都是纯函数返回字符串，加 snapshot test 接近零成本，能锁住输出格式。
3. **`@testing-library/react`**：`SqlInputDialog`、`InferencePanel` 这类静态结构组件，能用 RTL 测"点击接受 → store 中 decisions 多一项"。
4. **Playwright**：5 个关键路径（导入 → 渲染 → 调宽 → 接受 FK → 导出）。值得做但不急。

---

#### N3. `inferForeignKeys` 的 `explicitKeys` 只用 `fromColumns[0]`，复合 FK 上有盲点

**位置**：`src/infer/inferForeignKeys.ts:19-23`

```ts
const explicitKeys = new Set(
  schema.explicitForeignKeys.map(
    (fk) => `${fk.fromTable.toLowerCase()}.${fk.fromColumns[0]?.toLowerCase()}`,
  ),
);
```

**问题**：用户如果声明了一条复合 FK `FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)`，这里只把 `tenant_id` 标为"已显式覆盖"，而 `user_id` 还是会被推断引擎单独再造一条候选 FK。结果上画布上会同时画两条边：显式的复合边 + 推断的单列边，且两条都指向同一表。

**严重度**：用户场景里复合 FK 不常见（推断引擎本身也只推单列），但出现一次就是视觉污染。

**建议**：循环 `fk.fromColumns`，把每列都加进 `explicitKeys`：

```ts
const explicitKeys = new Set<string>();
for (const fk of schema.explicitForeignKeys) {
  const t = fk.fromTable.toLowerCase();
  for (const c of fk.fromColumns) explicitKeys.add(`${t}.${c.toLowerCase()}`);
}
```

---

### 🟡 中优先级

#### N4. `InferencePanel.tsx` 已 603 行，重新成为 UI 最大单文件

**位置**：`src/ui/sidebar/InferencePanel.tsx`

**问题**：上一轮裁掉 `DiagramCanvas` 之后，本文件接棒成为最大的 UI 文件。一个文件里掺杂了：高/中/低分组逻辑、批量操作、每条 FK 行渲染、reason 翻译、显式 FK 渲染。

**建议**：参考 `Sidebar/` 拆分模式：
```
src/ui/sidebar/inference/
├── InferencePanel.tsx          # 入口 + 分组
├── ConfidenceGroup.tsx
├── FkRow.tsx                   # 单条候选行
├── BulkActions.tsx
└── reasonTranslate.ts          # reason string → 中文描述（纯函数，可测）
```

---

#### N5. `Toolbar.tsx` 494 行：palette 弹窗、theme 选择器、搜索框三个独立功能塞在一起

**位置**：`src/ui/overlays/Toolbar.tsx`

**问题**：和 P4（App.tsx）同一个味道。toolbar 里目前同时承载：导入 / 布局切换 / 重布局 / 适配 / 清除 / 搜索 / 调色板 / 主题 / 导出 9 类按钮。

**建议**：把 palette dropdown、theme switcher、search 各自抽成独立组件，Toolbar.tsx 缩到 < 200 行。

---

#### N6. `cyHandle.ts` 同时承担"句柄存取"和"重布局命令"两件事

**位置**：`src/diagram/cyHandle.ts`

```ts
let cyInstance: unknown = null;
let relayoutFn: (() => void) | null = null;
```

**问题**：今天只有 `relayout` 这一个命令，明天可能要 `fit`、`exportPng`、`focusTable`。继续加下去 `cyHandle` 会变成"反向 store"——命令越来越多，每个都是模块级闭包。

**建议**：把"命令"挪到 store 里，由 `DiagramCanvas` 在 mount 时往 `useApp.setState` 注入：

```ts
// in DiagramCanvas useEffect:
useApp.setState({
  cmd: {
    relayout: () => runLayout(cy, ...),
    fit: () => cy.fit(),
    exportPng: (opts) => cy.png(opts),
  },
});
```

UI 层 `useApp((s) => s.cmd.relayout)()` 即可。`cyHandle` 退化为只存 `getCy()` 供 ExportMenu 抓 PNG。

---

#### N7. `decisions` 持久化版本只升过一次，缺迁移路径

**位置**：`src/store/index.ts:17`

```ts
const PERSIST_VERSION = 2;
```

注释里写"v2: `decisions` keys switched to canonical form"，但 `persist` 配置里**没看到 `migrate` 函数**——意味着老用户的 v1 状态会被 zustand 直接丢弃，决策与折叠状态全部清零。这是一次性事件，已经过去就过去了，但下一次升 v3 时如果还是"直接丢弃"，每个老用户都会感到一次状态丢失。

**建议**：补 `migrate` 钩子，至少做"读 v1 → 适配字段 → 写 v2"。

```ts
persist(..., {
  version: PERSIST_VERSION,
  migrate: (persistedState, version) => {
    if (version < 2 && persistedState && typeof persistedState === 'object') {
      // 转换老 decisions key 的 case
      ...
    }
    return persistedState as PersistedAppState;
  },
})
```

---

#### N8. `diagram/style.ts` 里 3 处 `as any`

**位置**：`src/diagram/style.ts:31, 61, 68`

**问题**：cytoscape 的 stylesheet 类型 (`StylesheetCSS` / `StylesheetJsonBlock`) 对自定义 selector 不友好。三处 `as any` 都是为了塞自定义属性。

**建议**：定义一个本地 `CySelectorBlock` 类型并 `Pick<>` 出需要的子集，或者直接用 `@ts-expect-error` + 一行说明（更显式）。两个方案都比 `as any` 友好 grep。

---

### 🟢 低优先级

#### N9. `samples.ts` 已 202 行，可拆成 `samples/ecommerce.ts` + `samples/blog.ts`

代码层面无影响，纯粹是 diff 体验。

---

#### N10. `Toolbar.tsx` 引入 `Core` 类型但只用一次

**位置**：`src/ui/overlays/Toolbar.tsx:5`

```ts
import type { Core } from 'cytoscape';
```

注释说要避免把 cytoscape 拉进主 chunk——`import type` 在编译后会被移除，不会进 chunk，但视觉上会让人误以为有依赖。建议改成内联 `as unknown as { fit: () => void; ... }` 或在 `cyHandle.ts` 里导出一个 minimal interface。

---

#### N11. `Toolbar.tsx` 中 `getCy<Core>()` 紧接判空，然后才用方法

5+ 个调用点都是"`const cy = getCy<Core>(); if (!cy) return; cy.xxx()`"。可以包成 `withCy(fn: (cy: Core) => void)` 工具。纯人体工学，不紧急。

---

## 四、安全 / 隐私层面（本轮重点）

上一轮简略提了两点（PNG/SVG 转义不全；localStorage 明文）。本轮把它单独提出来，因为：

- 项目里能放进画布的 DDL 经常来自**真实的生产数据库**，且用户可能在多人共享的设备上使用。
- "纯前端" ≠ "无安全面"——它把所有信任放在了浏览器的同源策略 + 用户的本地环境。

### 4.1 已修复

- **`localStorage` → `sessionStorage`**（本次提交）。导入的 DDL 不再在磁盘上无限期停留；刷新当前页仍然恢复，关闭标签页即清除。代价是"老用户首次升级后会丢一次状态（回退到样例 schema）"，影响一次性，可接受。

### 4.2 待修复

#### S1. `escapeText` / `escapeAttr` 没转义单引号

**位置**：`src/exports/toSvg.ts`（搜 `escapeText` / `escapeAttr`）

XML 解析器对单引号宽容，但用户若把导出的 SVG 嵌入 HTML 文档作为图片或 inline-svg，并且属性用单引号包裹（`<svg style='...'>`），表名包含 `'` 时会破出。建议给 escape 函数加 `&apos;` 转义并补单测。

#### S2. PNG 导出走 cytoscape 内部 canvas，不受 escape 控制

不太可能成为攻击面（PNG 是位图），但万一表名里有控制字符会破坏 cytoscape 内部测量；建议在 `buildGraph.ts` 入口对所有 `table.name` / `col.name` 做一次 strip-control-char。

#### S3. 没有 CSP / 没有 `Content-Security-Policy` meta

**位置**：`index.html`

纯前端项目仍然应该上 CSP。最小一条：
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';">
```
能挡住绝大多数 XSS 注入（即使 parser 哪天意外 eval 了字符串也跑不起来）。

### 4.3 持久化加密方案分析（针对"sessionStorage 仍不够安全"的场景）

如果未来用户要求**关闭标签页也保留 + 落盘内容不可读**，候选方案是 **IndexedDB + Web Crypto API**。本节给出可行性 / 兼容性分析，便于未来评估。

#### 4.3.1 浏览器兼容性

| API | 支持情况 | 限制 |
|---|---|---|
| IndexedDB | 全部常青浏览器 | Safari 私密模式 quota=0 ；Firefox 私密模式禁用 |
| `crypto.subtle` | 全部常青浏览器 | **仅在 secure context** — HTTPS 或 localhost，HTTP 域名与 Chrome `file://` 下不可用 |
| AES-GCM + PBKDF2 | 全平台 OK | iOS Safari 上 PBKDF2 600k 次迭代约 1–2s 首次解密 |
| iOS Safari ITP | — | 7 天无访问会清空 IndexedDB |

#### 4.3.2 工程改造代价

| 改动点 | 影响 |
|---|---|
| 异步化 | `localStorage`/`sessionStorage` 是同步 API，IndexedDB 是异步。zustand `persist` 切到异步存储后，hydrate 从"同步完成"变"异步进行中"——`App` mount 时 `rawSql` 仍空，要等 `onRehydrateStorage` 或 `persist.hasHydrated()` 后再调 `reparse()`。当前 `App.tsx:24-44` 的启动逻辑要重写。 |
| 口令管理 | 不要把派生 key 缓存到 sessionStorage / 内存里"避免重输"——那等于"把保险柜钥匙贴在保险柜上"。要么每次会话首次解密要输入口令，要么这个方案在 XSS 威胁模型下没比 sessionStorage 强多少。 |
| 备份 / 导出 | 加密后用户的 DDL 在浏览器之外无法恢复，必须配合"导出明文 SQL"按钮兜底；否则用户换浏览器就丢失全部历史。 |

#### 4.3.3 结论

**威胁模型 vs 收益**：

| 担心 | sessionStorage 够吗 | 需要加密？ |
|---|---|---|
| DDL 长期留在磁盘 | ✅ 关页即清 | ❌ |
| 同机器其他用户看到 | ✅ 同上 | ❌ |
| XSS 注入偷取 | ❌ | ❌ 加密也救不了，要靠 CSP |
| 离线工具取证 / disk forensics | ✅ 内存映射也可能写盘但概率极低 | ⚠️ 加密磁盘可降低 |
| 跨会话保留（关页也想留） | ❌ 需要持久化 | ⚠️ 需要 IndexedDB |

**本项目暂不建议上加密存储**：当前没有"关页保留"需求；上加密的工程代价（异步化 / 口令 UX / 备份兜底）显著大于收益。先把 CSP + escape 单引号这两件事做了，性价比高得多。等用户真的提"我想关浏览器还能回来"时再评估 IndexedDB。

---

## 五、性能层面（与上轮对比）

| 场景 | 上轮 | 本轮 |
|---|---|---|
| 首屏白屏时间 | Cytoscape 在主 bundle 里 | ✅ 已用 React.lazy + manualChunks 拆出，主 bundle ~30KB gzip |
| 表数量 ≤ 50 | 顺畅 | 顺畅 |
| 50 < 表 ≤ 200 | 拖拽明显卡顿 | 仍卡（每次 position 已只重算邻边，但 React 覆盖层全量重渲染） |
| 表数量 > 200 | 5–10s 布局 | 同 |
| 搜索 keystroke | 每次 keydown 全量重算 | 同（仍未 debounce） |
| 文本测量 | 无缓存 | ✅ measureCache 缓解 |
| 导出大 SVG | 主线程阻塞 | 同 |

剩余改进：搜索 `setSearch` 200ms debounce、`positions` state 节流（rAF）、`toSvg` 用 `requestIdleCallback` 分块。

---

## 六、改进路线图（基于本次复审）

### Sprint A（1–2 天 · 安全网与小修补）
- [ ] S1：`toSvg` escape 补 `&apos;`，加单测
- [ ] S3：`index.html` 加 CSP meta
- [ ] N3：`explicitKeys` 用循环覆盖所有 `fromColumns`
- [ ] N7：补 `persist.migrate` 钩子
- [ ] N8：消除 `style.ts` 的 3 处 `as any`

### Sprint B（3–5 天 · 可维护性进入下一阶段）
- [ ] N1：拆分 `toSvg.ts` 到 `exports/svg/` 子目录
- [ ] N4：拆分 `InferencePanel.tsx`
- [ ] N5：拆分 `Toolbar.tsx`（palette / theme / search 各自独立）
- [ ] N6：`cmd` 命令对象注入 store，`cyHandle` 退化为读取句柄
- [ ] N2.1+N2.2：`useApp` selectors + `toSvg`/`toDdl` 快照测试

### Sprint C（1–2 周 · 上限提升）
- [ ] N2.3：RTL 测试覆盖 `SqlInputDialog`、`InferencePanel`、`Sidebar`
- [ ] N2.4：Playwright 5 个关键用户路径
- [ ] P3：parser 升级为 token 流 lexer
- [ ] 性能：搜索 debounce / position 重算节流 / 大 schema 渐进渲染
- [ ] **持久化加密评估**（见 § 4.3）—— 只在用户真的需要"关页保留"后启动

---

## 七、值得长期保留的设计

复审完仍然成立的"坑过的正确决策"。新加入的开发者要先读注释再决定动它们：

1. **HTML 覆盖层渲染表卡片**（不要回到 cy native node label）。
2. **`curve-style: segments` + 手算 weights/distances**（不要回到 `taxi`）。
3. **`zoom < 1` 时 clamp 到 1**（避免文本变糊）。
4. **`<React.StrictMode>` 关闭**（cy 不耐受双 mount）。
5. **`mergeShardedTables` 跑在 parser 与 inferFK 之间**（不是 UI 层）——避免推断阶段产生分片→分片噪声边。
6. **fcose `randomize: true`**（每次"重置布局"都给用户视觉变化）。
7. **`cyHandle.ts` 不静态导入 cytoscape**（保留 React.lazy 切片效果，否则 cytoscape 又会被拖回主 chunk）。
8. **`canonicalFkKey` 全链路同源**（persist 版本号靠它保持稳定）。
9. **`partialize` denylist**（避免新加偏好字段时静默丢失）。
10. **`sessionStorage` 而非 `localStorage`**（DDL 不在磁盘上沉淀过夜）。

---

## 八、复审小结

| 维度 | 评分变化 |
|---|---|
| 架构整洁度 | A → A |
| 代码可维护性 | B− → A− |
| 测试覆盖 | C+ → B |
| 工程化 | C → A− |
| 安全 / 隐私 | — → B |
| **综合** | **B+（8.0）→ A−（8.7）** |

本轮的主要遗留风险都集中在 **UI 层测试缺失** 与 **parser 仍正则驱动**。前者可以借 RTL/snapshot 快速补足，后者要看是否真的遇到 parser 解析失败的反馈再决定是否动。其他都是渐进式优化。

下一步建议从 Sprint A 的 5 项开始，2 天内可见显著改善，且零风险。

---

*评审完成时间：2026-05-23。下一次建议在 Sprint B 完成后再做一次复审。*
