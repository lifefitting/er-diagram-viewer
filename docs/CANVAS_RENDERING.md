# SQL → 画布渲染流程深度分析

本文档解析「SQL 文本 → 画布上的 ER 图」全过程，重点拆解表格 card 的尺寸测量、DOM 组合与同步机制，并在每个阶段标注可优化点（标记为 **OPT-N**），方便后续迭代取舍。

涉及文件（按数据流方向）：

- `src/store/pipeline.ts` — 解析 / 推断流水线入口
- `src/store/index.ts`、`store/selectors.ts` — Zustand 全局态 + `effectiveForeignKeys` 派生
- `src/diagram/buildGraph.ts` — Schema → Cytoscape `ElementDefinition[]`，含尺寸测量
- `src/diagram/DiagramCanvas.tsx` — Cytoscape 实例 + React overlay 主控
- `src/diagram/style.ts` — 边样式（节点为透明占位）
- `src/diagram/layout/*` — fcose / dagre 布局 + hub 二次环形整理
- `src/diagram/routing/*` — 每字段端点 + H-V-H 折线 segment 计算
- `src/diagram/selection/*` — 搜索 / 聚焦的三态选择派生
- `src/diagram/overlay/{TableOverlay,TableHeader,ColumnRow}.tsx` — 表格 card 的 HTML 组合

---

## 0. 总览：四层渲染管线

```
              ┌──────────────────────────────────────────┐
SQL 文本 ───▶ │ Pipeline (parse → mergeShards → infer)    │
              └──────────────────────────────────────────┘
                                │
                                ▼ Schema, InferredFK[], ModulesResult
              ┌──────────────────────────────────────────┐
              │ Store (Zustand)                           │
              │  + effectiveForeignKeys 派生              │
              │  + decisions / display / layout / search  │
              └──────────────────────────────────────────┘
                                │ React 订阅
                                ▼
              ┌──────────────────────────────────────────┐
              │ buildElements → ElementDefinition[]       │
              │  ├ 节点 data: boxWidth / boxHeight        │
              │  └ 边 data: srcEndpoint / segWeights ...  │
              └──────────────────────────────────────────┘
                                │
                                ▼
              ┌──────────────────────────────────────────┐
              │ Cytoscape (隐形节点 + 可见边) │ React Overlay (HTML 表格 card) │
              │   ←──── pan/zoom/position/resize 同步 ────→                    │
              └────────────────────────────────────────────────────────────────┘
```

核心设计取向：

- **Cytoscape 仅负责布局 + 边渲染**，节点 `background-opacity: 0`、`border-width: 0`、`label: ''`，只是一个不可见的"尺寸占位 + 拖拽承载体"。
- **真正的表格 card 是绝对定位的 React HTML 节点**，由 `DiagramCanvas` 通过 `cy.on('pan zoom resize position layoutstop add remove')` 同步坐标 / 尺寸。
- **每条边精确连到字段行**：边的 source/target endpoint 是 `<x>px <y>px`，y 来自 `columnRowOffsets` 计算的字段中心，x 来自 card 左/右边界（根据相对位置选择更近的一侧）。

---

## 1. Pipeline 阶段（`store/pipeline.ts`）

`runPipeline(sql, palette)` 顺序：

1. `parseSql(sql)` → `Schema`
2. `mergeShardedTables(schema)` → 折叠 `user_0…user_31` 这类水平分表为一张逻辑表
3. `inferForeignKeys(schema)` → `InferredFK[]`
4. `inferModules(schema, fks, palette)` → 模块着色信息 `{byTable, modules, ordered}`

合并 shard **必须**早于 FK 推断，否则 shard-to-shard 会产生噪声边、shard 命名会污染模块名。

**OPT-1 / Pipeline 完整重跑**：当前 `setSql` 触发完整四步重跑。对大 schema 增量编辑场景，没有"按 statement 重解析"的能力。可考虑：
- 解析层缓存 `(statement 文本 → 子 AST)`；
- 推断层按 `(fromTable, columnName) → 候选目标` 建索引避免 O(T·C·T) 扫描。
- 优先级：低（当前规模 ~50 表足够快）。

**OPT-2 / Pipeline 在主线程**：parse + infer + modules 均 sync。大型 schema（>500 表）会阻塞 UI。可改成 `requestIdleCallback` 分片或 Worker。

---

## 2. Store 派生（`store/selectors.ts`）

`effectiveForeignKeys(schema, inferred, decisions, showLowConfidence)` 是渲染所有 FK 的**唯一真相源**：

- 把 `schema.explicitForeignKeys` 与 `inferred` 合并；
- 用 `decisions[fkKey]` 覆盖：`reject` 直接过滤掉，`accept` 不论置信度都保留；
- 未决定时按 `showLowConfidence` 控制 low 边是否参与渲染。

**OPT-3 / 派生重算粒度**：`DiagramCanvas` 用 `useMemo` 包了 `effectiveFks`，依赖 `[schema, inferred, decisions, display.showLowConfidence]`。`decisions` 引用变化（accept / reject 一个 FK）会导致整张图的 `buildElements` 重跑、cy 节点 `remove` 再 `add`。可以：
- 把 FK 增删改成"diff edge"模式：只增/删/改对应的那一条边，节点保持不动；
- 这同时能消除 `cy.elements().remove(); cy.add(elements)` 引起的整图重建副作用（位置已在 `prevPositions` 中救回，但边的 class / 端点数据要 `updateEdgeEndpoints` 再补一次）。

---

## 3. buildElements：Schema → Cytoscape 元素

`buildElements(schema, fks, opts)` 是从结构化数据到 Cytoscape 元素数组的纯函数。两类元素：

### 3.1 节点（隐形占位）

```ts
{ id, type: 'table', rawName, moduleKey, moduleColor, boxWidth, boxHeight }
```

`boxWidth / boxHeight` 由 `tableBoxSize()` 计算，详见第 4 节（核心）。

### 3.2 边（可见折线 + 字段级端点）

```ts
{
  source, target,
  confidence, lineStyle, color, crossModule,
  srcRowIdx, tgtRowIdx,          // 字段索引，端点 y 由 columnRowOffsets 算出
  srcEndpoint: 'outside-to-node', // 占位，首帧后由 updateEdgeEndpoints 改写
  tgtEndpoint: 'outside-to-node',
  segWeights: '0.5 0.5',          // 占位
  segDistances: '0 0',
  meta: { source, reason, fromColumns, toColumns },
}
```

注意：
- **`accepted` 的判断**：`fk.source === 'explicit' || decisions[fkKey(fk)] === 'accept'`，决定 `lineStyle = 'solid' | 'dashed'`。
- **边颜色取 source 表的模块色**，因为 FK 是引用方的属性。

**OPT-4 / `srcRowIdx` 只取 `fromColumns[0]`**：复合外键被简化为"只挂在第一列"，多列复合 FK 视觉上看不出来。如果产品上需要清晰区分，可以为每个列对生成一条边，或者在 card 上用 badge 编号（`FK#1`、`FK#2`）。

**OPT-5 / 占位 endpoint 的副作用**：首帧 cy.add 之后到 `updateEdgeEndpoints` 跑完之间，会用 `outside-to-node` + `0.5/0` 渲染一帧。在大 schema 上肉眼可见"边跳一下"。可以：
- 在 `buildElements` 阶段就用 `srcRowIdx + boxWidth/Height` 预算端点；
- 或者在 add 节点之后、add 边之前先批量算端点写入 data。

---

## 4. 表格 Card 的尺寸测量（重点：`tableBoxSize`）

这是整个画布**视觉准确性**的基石。Card 的宽度必须恰好容下"最宽的一行内容"，否则 `whitespace-nowrap` 会把列名挤出 card 边缘；高度必须精确到像素，否则字段级 FK 端点会偏移（每行 1px 误差累加 5 行就 5px，箭头明显错位）。

### 4.1 真正用浏览器字体测量宽度

`measureText(s, sizePx, weight)` 使用一个 lazy 创建的 offscreen `<canvas>` 调用 `ctx.measureText`，字体栈 `'ui-monospace, SFMono-Regular, Menlo, monospace'` 与 card 实际渲染保持一致。

为什么不用字符数 × 估计字宽：
- CJK 字符宽度约 ASCII 的 1.7×；
- 字重 600 比 400 宽约 10%；
- Mac / Linux 字体度量差几个百分点。

`measureCache` 用 `weight\0size\0text` 作 key 缓存——`id`、`BIGINT`、`created_at` 等在一张 schema 内重复几十次。

**OPT-6 / measureCache 不限大小**：cache 是模块级 `Map`，永不清理。一次会话内重复测同串没问题，但如果反复粘贴不同 schema 累计长字符串多，cache 会持续增长。可：加 LRU、或在 `setSql` 时清空。

**OPT-7 / SSR / Vitest 路径的退化估算**：`ch.charCodeAt(0) > 0x7f ? 12 : 7` 这一行假设了 12px 字号；调用方传 10.5px 时会被换算回去，但 `weight` 信息丢失。对单测够用，但如果未来想做 SSR 预渲染，要走 satori/skia 等离屏度量。

### 4.2 宽度算法

宽度取以下四者中最大，再截到 `[MIN_WIDTH=240, MAX_WIDTH=560]`（手动 override 允许到 `DRAG_MAX_WIDTH=1200`）：

| 候选 | 公式 |
| --- | --- |
| `headerWidth` | `HEADER_PADDING(16) + name(13px,600) + shardsBadge + moduleLabel + 12 + 6 安全余量` |
| `rowsWidth` | 列循环最大值：`BADGE_COL_WIDTH(38) + name(12) + (TYPE_GAP(12) + type(10.5)?) + ROW_HPADDING(28)` |
| `commentMaxW` | 列循环最大值：`comment(10.5) + COMMENT_HPADDING(24)`（仅当 `showComment`） |
| `subtitleW` | `tableComment(10.5) + 24`（折叠时为 0） |

**OPT-8 / header 的"+6 安全余量"是经验值**：注释里写明是"sub-pixel rounding + chevron hover padding"。这种 magic number 一旦其它元素（如未来加 lock 图标）多了又得人工调。可以：
- 改成把所有 header 子元素 inline 渲染到一个离屏 div 用 `getBoundingClientRect` 真测；
- 但代价是要等 DOM 挂载，破坏当前"纯函数算尺寸"的好处。

**OPT-9 / `rowsWidth` 每行重算**：当前是 N 次循环。如果 card 内列数很多（>200，极端情况）会慢。可以排序列字宽缓存最大者，但实际收益微薄。

### 4.3 高度算法

折叠：`height = HEADER_HEIGHT(28)`。
展开：

```
height = HEADER_HEIGHT
       + (hasSubtitle ? SUBTITLE_HEIGHT(18) + SUBTITLE_BORDER(1) : 0)
       + Σ_col [ ROW_BORDER(1) + FIELD_ROW_HEIGHT(20)
                 + (showComment && col.comment ? COMMENT_LINE_HEIGHT(14) : 0) ]
       + 4   // 底部留白
```

**关键不变量**：DOM 中每行 wrapper 用 `border-t border-ink-100`，浏览器把 1px **加在** `height: 20px` 之外，所以真实视觉高度是 21px。`ROW_BORDER`、`SUBTITLE_BORDER` 就是把这个 1px 显式加回 cy 节点尺寸，否则字段级 FK 端点会一行 1px 累计偏移。

**OPT-10 / 行高常量与 DOM 强耦合**：常量 `HEADER_HEIGHT / FIELD_ROW_HEIGHT / COMMENT_LINE_HEIGHT` 与 `TableHeader`、`ColumnRow` 中的 `style={{ height: FIELD_ROW_HEIGHT }}`、`height: 18`、`height: 14` 必须人工同步。任何一个 className 改了 padding（如 `py-[2px]`）但忘了改常量，FK 端点就会偏。可以：
- 把所有"高度敏感"的样式集中到一个 `tableLayoutConstants.ts`，CSS module 用 var 注入；
- 或者写一个 vitest 单测，挂载一个真表，断言 `getBoundingClientRect().height === tableBoxSize().height`，防回归。

### 4.4 列行垂直偏移：`columnRowOffsets`

为给每个 FK 算 y 端点，`columnRowOffsets(table, display)` 返回**每一列的行中心 Y**（自 card 顶部）：

```
cursor = HEADER_HEIGHT + subtitleBlock
for col in columns:
  cursor += ROW_BORDER
  offsets.push(cursor + FIELD_ROW_HEIGHT / 2)
  cursor += FIELD_ROW_HEIGHT
  if showComment && col.comment: cursor += COMMENT_LINE_HEIGHT
```

这是 `updateEdgeEndpoints` 算 `srcOff.y / tgtOff.y` 的基础。注意它**仅当 `showComment + col.comment`** 时才叠加 14px——必须和 `ColumnRow.tsx` 中"是否渲染 comment 行"的判断严格一致。

**OPT-11 / 两份"是否渲染 comment"判断分散**：一个在 `columnRowOffsets`，一个在 `ColumnRow.tsx`。任何 trim/空串边界条件偏差都会让端点错位。可抽 `shouldRenderColumnComment(col, display)` 共用。

---

## 5. Card 的 DOM 组合（重点：UI 元素）

每个 cy 节点上方覆盖一个 `<TableOverlay>`。文件分工：

- **`TableOverlay.tsx`** — 外壳：定位/尺寸/边框/ring。组合 header、subtitle、columns、右侧 resize 把手。
- **`TableHeader.tsx`** — 顶部彩条：chevron + 表名 + shards 徽章 + 模块名标签。整条 header 是 `cursor-grab` 拖拽热区。
- **`ColumnRow.tsx`** — 一行字段：badge 列（PK/U/I + FK）+ 列名 + 类型，下方可选 comment 子行。

### 5.1 TableOverlay 外壳

定位：

```tsx
<div style={{ left: x, top: y, width: w, height: h, border: `1px solid ${moduleColor.border}` }}>
```

`x/y/w/h` 来自 `positions: NodePos[]`，由 `DiagramCanvas` 在 `pan zoom resize position layoutstop add remove` 事件回调 `syncPositions` 中通过 `n.renderedBoundingBox({ includeLabels: false })` 读取。每次 cy 状态变化，positions 整体替换 → React 重渲染所有 card。

**OPT-12 / `syncPositions` O(N) 全量更新**：哪怕只拖了一张表，仍然遍历 cy.nodes() 重建整个 `positions` 数组、引起所有 `<TableOverlay>` 重新 reconcile。N=200 时大约 0.5–1ms，可以接受；N>500 拖动会卡。可以：
- 维护 `positionsRef` 用 mutable Map，事件回调里只更被影响 id，触发 `setRevTick` 计数；overlay 内部用 `useSyncExternalStore` 订阅自身 id 的子集；
- 或在 pan/zoom 时整体批量（一次 transform），仅在 layoutstop/position 时单个更新。

**OPT-13 / overlay 用 `left/top` 而非 `transform: translate3d`**：`transform` 会进合成层、不触发 layout/paint；在 pan/zoom 高频事件下能省可观成本。但是要确保边框/ring 的 1px 不被亚像素糊掉。

**OPT-14 / `transition-opacity` 在所有 card 上始终生效**：搜索/聚焦切换时 dim 有动效，但拖动节点位置时 `left/top` 跳变不应过渡。当前 only `opacity` 有 transition，OK；保留这一段说明避免未来误加 `transition-all`。

### 5.2 TableHeader

视觉元素：

```
[▾] table_name             [shards: 32] [module_key]
```

- chevron：4×4 按钮，`onMouseDown` 阻止冒泡（否则会触发 header 的 drag）、`onClick` 调 `onToggleCollapse`。
- 表名：`flex-1 min-w-0 truncate`，超长时显示 `…`，hover 用 `title` 出全名。
- shards 徽章：仅 `table.shardInfo` 存在时显示，title 列出所有 shard 名。
- 模块名：右侧小字，hover title 出全名。

整条 header `onMouseDown={onDragHandle}` 进入拖动流程（见 6.2）。

**OPT-15 / Header 内三个 nowrap shrink-0 元素**：在表名极长 + shards + module 同时出现时，宽度算式靠 `headerWidth`。但若 `MAX_WIDTH=560` 截断，最先 truncate 的是表名（`flex-1` 唯一 shrinkable）。当前接受表名截断比 badge 截断更合理，但要 PM 确认排序优先级。

### 5.3 ColumnRow

视觉结构：

```
| [PK FK]    col_name                int(11) |
|            备注（可选，10.5px italic）       |
```

- 左侧 38px 固定宽 badge 列：放 PK/U/I 中的一个，加上可能的 FK。同列又是 PK 又是 FK 时 `PK FK` 并列，不再丢一个。
- 列名 `flex-1 truncate`；PK 行加粗 `font-weight: 600`，整行底色 `bg-amber-50/70`，方便扫读主键。
- 类型 `shrink-0 whitespace-nowrap`，超长用 `title` 兜底。
- 注释行 `height: 14, italic, truncate`，只有 `showComment && col.comment` 时存在——和 `columnRowOffsets` 的条件必须严格一致（OPT-11）。
- `title` 工具提示拼装为 `name : type · comment · 外键 · 主键 · NOT NULL`。

**OPT-16 / `ColumnRow` 没 memo**：父组件 `TableOverlay` 每次 `positions` 变化都重渲染，子 `ColumnRow` 也全部 re-reconcile。`col` / `table` / 各 boolean 多是稳定引用，可以 `React.memo(ColumnRow)` 显著降低 reconcile 成本。配合 OPT-12 效果更好。

**OPT-17 / `roleBadge` 在每次渲染都算**：`columnRoleBadge` 是纯函数但每行调用一次。表很多列时可在 `buildElements` 阶段预算（连同 `isFk` 一起塞进 props）。收益取决于 N。

**OPT-18 / Tailwind class 字符串膨胀**：`ColumnRow` 中的 dark mode 双套 class 在每个 PK 行都重复。已经是字符串字面量、Tailwind 编译期会去重，但对运行时 className computed string allocation 仍是 GC 压力源。可以用 `clsx.lite` 或预算静态。

### 5.4 Resize 把手

```tsx
<div className="absolute top-0 right-0 h-full w-2 cursor-ew-resize"
     onMouseDown={onResizeHandle}
     onDoubleClick={...onResetWidth} />
```

8px 命中区 + 2px 视觉条，双击恢复算法宽度（仅当存在手动 override）。

`onTableResize`（DiagramCanvas.tsx:366）的关键设计：
- 拖动过程**直接 mutate cy node data**(`n.data('boxWidth', next)`)，不进 store；
- 手动 `cy.trigger('resize')` 让 overlay 同步；
- 手动 `updateEdgeEndpoints` 让该节点连接的边贴回新边界；
- 鼠标抬起才 `setTableWidth(name, lastWidth)` 入 store。

这避免了 `effectiveForeignKeys`、`buildElements`、`cy.elements().remove(); cy.add(elements)` 整条链路在每个像素都跑一次。

**OPT-19 / Drag 同样应做**：`onTableDragStart` 通过 `node.position` 直接改 cy；走 cy `position` 事件链 → `syncPositions` → React 重渲染所有 overlay。这部分目前每像素全量 reconcile，是拖动手感的主要瓶颈（见 OPT-12/13）。

---

## 6. DiagramCanvas 的同步与事件流

### 6.1 Mount-once 副作用（`useEffect(…, [])`）

- 初始化 cy、注册 fcose / dagre 插件（懒注册保护）。
- `bindCy(cy, relayoutClosure)` 让工具栏可以 `relayoutCurrent()` 而不引模块级单例。
- 装四类事件：
  1. `pan zoom resize / position node / layoutstop / add remove` → `syncPositions`
  2. `position node` → `updateEdgeEndpoints(connectedEdges)`（只算受影响边）
  3. `layoutstop add` → 全量 `updateEdgeEndpoints(cy.edges())`
  4. 边 mouseover/mousemove/mouseout → tooltip；`tap` 命中 cy 自身 → 清 focus

`tableByIdRef / modulesRef / collapsedRef / displayRef` 用来在事件回调中读取**最新值**——回调闭包是 mount 时绑的，否则会读到 stale state。

**OPT-20 / `position node` 事件 + 全量 syncPositions**：每次拖一张表，`syncPositions` 仍遍历所有节点。如 OPT-12 所述，可改成增量。

### 6.2 schema/fks/modules 变化的副作用

`useEffect(…, [schema, effectiveFks, modules])`：

1. 保留旧位置 `prevPositions = Map<id, {x, y}>`；
2. `buildElements(schema, effectiveFks, opts)`；
3. `cy.elements().remove(); cy.add(elements);`
4. 旧位置回填；只对**新增节点**走 `runLayout` 或单点偏置；
5. 全量 `updateEdgeEndpoints(cy.edges(), …)` 把 placeholder 端点改写。

`tableWidths` 故意**不在依赖**里——见 OPT-19 中描述的 resize 路径，避免整图重建。

**OPT-21 / 大依赖项粒度**：任何 `decisions` 改动都会触发 `effectiveFks` 重算 → 这块 effect 整图重建。可改成"edge diff"（OPT-3）。

### 6.3 display/collapsed/tableWidths 副作用

不重建元素，只 `cy.batch` 内更新每个节点的 `boxWidth/boxHeight`，再全量 `updateEdgeEndpoints`，最后 `cy.trigger('resize')` 让 overlay 跟上。

### 6.4 Selection / flash 副作用

- 选区 effect：对 cy.edges() 全量遍历加/去 `highlight/dimmed` class，并 `cy.animate({ center: matchNodes })` 把命中表居中。
- flash effect：模块芯片点击触发，仅 pan，不变 zoom（避免每次点击缩放感不同）。

**OPT-22 / 选区 effect O(E) 全量**：每次搜索字符变化都全量。E 不大无所谓，但可以记录上次 `(matches, neighborhood)` diff 仅改变化的边。

---

## 7. 边路由（`routing/`）

### 7.1 `updateEdgeEndpoints`

每条边：
1. 取 src/tgt 节点的 `boxWidth/Height/position`、`rawName`，从 `tableById` 取真实 `Table`；
2. 用 `columnRowOffsets`（memo 在 `offsetsCache`，同一调用内共享）算 srcY/tgtY；
3. 比较 `tgtPos.x - srcPos.x` 决定边从哪一侧出（`right`/`left`）；
4. `computeEndpointOffset` 得到相对 center 的 `(x, y)`；
5. `computeSegments(sx, sy, tx, ty)` 解析式算两个 bend 让线为 H-V-H 折线；
6. `cy.batch` 内写回 `srcEndpoint / tgtEndpoint / segWeights / segDistances`。

**OPT-23 / `offsetsCache` 只在单次调用内有效**：每次 `updateEdgeEndpoints` 重新 new。其实只要 `(table, display.showComment, display.showType)` 不变就能复用；可提到 module 级 Map，key 为 `tableName + display flag`。同 OPT-6，需要在 schema 变化时失效。

**OPT-24 / 每次拖动都全量批 batch**：单节点拖动调用 `updateEdgeEndpoints(node.connectedEdges())`，OK；但 `layoutstop` 与 schema effect 都全量。fcose 跑完通常只 layout 一次，可以接受；schema effect 应该已经在 add 后只算新增/受影响边，目前是 `cy.edges()`，理由是新增节点产生新增边。

### 7.2 `computeSegments`

数学闭式：把 `segment-weights / segment-distances` 解析式映射到 `(midX, sy)` 与 `(midX, ty)` 两个 bend，得到纯 H-V-H 折线。`edge-distances: endpoints` 确保 cy 用我们写的端点做参考线（否则用节点边界相交点 → 端点偏移时折线变斜）。

代码非常紧凑，已被两个单测覆盖（`computeSegments.test.ts` / `computeEndpointOffset.test.ts`）。无明显优化点。

**OPT-25 / 路由策略单一**：所有 FK 都走 H-V-H 三段折线，从源最近的一侧出。当源/目标在垂直方向几乎对齐（dx 很小）时，第一段近乎 0 长，看起来像直接拐弯。可以扩展：
- 同侧多边时做 lane 分配，避免叠线；
- 长距离跨多表时考虑路径绕开中间节点（需要 A* 或简化 lane grid，成本高）。

---

## 8. 布局（`layout/`）

`runLayout(cy, kind)` 跑 fcose 或 dagre，结束后：
1. 非 dagre 时调 `arrangeAroundHubs(cy)`：找 in-degree ≥3 的"枢纽表"，把它的入引用表按名字字典序排列成顺时针环。
2. `cy.fit(undefined, 60)`；若 zoom < 1 则强行 `zoom(1); center()` —— 防止 overlay 因缩小变模糊（CSS px 文本不随 zoom 缩小）。

**OPT-26 / 布局参数硬编码且没尺度自适应**：注释里写明"~10–50 表的 schema 工作良好"。`nodeSeparation`、`idealEdgeLength` 等是定值，遇到 200+ 表时间太长或互相穿插。可以根据 `schema.tables.length` 自适应：N 大 → 增 `nodeSeparation`，减 `numIter`。

**OPT-27 / `arrangeAroundHubs` 用 fcose 平均距离做半径**：当 fcose 把 dependent 拉得太近，环会塌缩到 `FLOOR=360`；当 fcose 把它们摊得太远，环又会过大。可在拍照 / 截图时算 dependent 子 bbox 紧致度做修正，但成本高、收益视觉化。

---

## 9. 选区（`selection/`）

`deriveSearchSelection` 在 schema/fks/search 变化时 `useMemo` 重算：
- 匹配条件：表名 / 表注释 / 列名 / 列注释 includes（lowercase）。
- 命中集合通过 `closedNeighborhood(matches, fks)` 扩展为"自身 + 一跳邻居"。
- 命中为空时返回 `{ matches:∅, neighborhood:∅ }`——画布会 dim 一切，提示"无匹配"。

`deriveFocusSelection` 同理，命中只有 1 个。两者经 `focusSelection ?? searchSelection` 优先级合并。

**OPT-28 / 大 schema 下搜索每字符全量扫描**：每输入一字 → 全 schema 遍历。N=500、平均 30 列时单次约 ~15k 比较 + lowercase（已经预算了 q.toLowerCase()）。可以在 schema 变化时预生成 `tableName.toLowerCase()` + `column.name.toLowerCase()` 索引。

---

## 10. 综合优化建议（按性价比排序）

> 优先级假设：当前目标用户 schema 在 10–100 表区间，少数会到 300+。

| 优先级 | 项 | 说明 |
| --- | --- | --- |
| **高** | OPT-12, 13, 19, 20 | 位置同步从"全量数组替换"改"按 id 增量 + transform"，明显改善大 schema 拖拽体验 |
| **高** | OPT-3, 21 | FK 增删改用 edge-diff，避免整图 cy.remove+add，副作用还消除"边占位帧跳动"（OPT-5）|
| **中** | OPT-10, 11 | 把高度敏感常量与 DOM 强约束抽到一处，加 vitest "DOM 高度 == tableBoxSize 高度" 防回归 |
| **中** | OPT-16, 17 | `ColumnRow` memo + 预算 roleBadge，配合 OPT-12 / 13 抑制拖动重渲染开销 |
| **中** | OPT-23 | `offsetsCache` 提到 module 级，FK 路由更新提速 |
| **中** | OPT-26 | 布局参数按 N 自适应 |
| **低** | OPT-1, 2 | parse / infer 切片/Worker，500+ 表才能感知 |
| **低** | OPT-4 | 复合 FK 多列可视化（产品决定） |
| **低** | OPT-6 | measureCache LRU |
| **低** | OPT-15, 25, 27, 28 | 细节体验 / 视觉一致性 |

---

## 11. 一图速查：从 SQL 到一条 FK 边渲染完成的最短路径

```
SQL string
  └→ parseSql ──→ Schema (Tables + Columns + ExplicitFKs)
       └→ inferForeignKeys ──→ InferredFK[]
            └→ effectiveForeignKeys(decisions, showLowConfidence) ──→ ForeignKey[]
                 └→ buildElements ──→ [nodes(boxWidth/Height), edges(srcRowIdx/...)]
                      ├→ cy.add(elements)
                      ├→ runLayout(fcose/dagre) + arrangeAroundHubs ──→ node positions
                      ├→ updateEdgeEndpoints ──→ srcEndpoint / segWeights 真值
                      └→ cy emits pan/zoom/resize/position/layoutstop
                           └→ syncPositions ──→ NodePos[]
                                └→ React: positions.map(<TableOverlay/>)
                                     └→ TableHeader + (subtitle?) + ColumnRow[N] + ResizeHandle
                                          └→ DOM 测量 = tableBoxSize 算出来的 (w,h)
                                                ⇒ FK 端点正好落在字段行中心
```
