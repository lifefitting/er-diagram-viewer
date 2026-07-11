# 待办：剩余 Bug 与优化说明（中文版）

本文件是 [TODO-fix-bugs.md](TODO-fix-bugs.md) 的中文对照版，记录 v0.2.0 交互式
画布特性多智能体评审中**尚未处理**的条目。代码符号、文件名、函数名保留英文以便
检索。

> 说明：本文档仅作记录用途。其中标注「大改」的条目（尤其 P2 路由统一）**暂不
> 执行**，需要先跑应用做前后对比截图再决定。

## 当前进度

- ✅ 5 项首要问题、12 项 **P1 正确性** Bug、20 项 **P3 清理**中的 10 项、
  **P2 #5（持久化加固）**——均已修复并验证（typecheck + lint + 174 测试 + build
  全绿；每批均通过对抗式复核）。已发布 **v0.2.1**。
- ✅ **P2 #3（拖拽热路径 rAF 合帧）**——已修复并验证（单卡拖拽 + 成组拖拽均通过
  每帧一次 rAF flush 重路由；preview + Playwright 实测，0 控制台报错）。
- ✅ **手动路由 dock side 翻转（原 P2 高层级 #3）**——已修复：拖动卡片期间，实时
  逐帧重路由（`flushDrag`）忽略手动 override（`DiagramCanvas.tsx` 的
  `nodeDraggingRef`），手改连线不再随卡片中心越过 `override[0].x` 而左右翻转。
  轻量方案（不改持久化结构、不升 `PERSIST_VERSION`），详见「已完成」。
- ✅ **P2 #1（路由统一）已决定不做**（2026-07-11，理由见下）；测试规模现为
  262 用例 / 30 文件（v0.3.1）。
- ⏳ 剩余：**1 项 P2 高层级**条目（side-bracket 泛化）+ **7 项 P3**
  延期项（含延期理由）。

---

## 剩余 —— P2：高层级（深度 / 通用性）

### 1. 「卡片挡住连线」存在两套互相分叉的路由器 —— **已决定不做（2026-07-11）**
- **位置：** `updateEdgeEndpoints.ts`（`liveRoute` 开关）
- **原始担忧与复核结论：**
  - 「导出与画布路由不一致」——实际不成立：SVG 导出读 `routePoints`，与画布
    永远同源，两条路径只是决定 routePoints 怎么算，不会产生画布/导出分叉。
  - 「双路由器维护成本」——实践可控，且两条路径各有分工：静态首布局对接 dagre
    预留的通道航点（利用布局阶段留出的走线间隙，走线更直）；拖动过卡片后走
    实时 `detourRoute`（跟手，且已带端口 stub + 端点卡避让，见 v0.3.1）。
- **保留的注意事项：** 布线改进默认只落在实时路径（v0.3.1 的 stub 修复即如此）。
  若将来静态首布局也出现贴边 / 穿卡问题，再针对静态路径单独处理，而不是重启
  「统一」大改。

### 2. 侧向括号路由被限制在 `gapX < 0`，因为障碍物排除了端点卡片 —— *已确认*
- **位置：** `updateEdgeEndpoints.ts`（`sideBracketRoute` 开关）
- **问题：** 紧贴并排的卡片（`gapX` 为较小正值）且端口垂直偏移较大时，会落到
  dagre/detour 而非更整洁的侧括号——纯粹因为 `buildObstacles` 在做穿越检测时无法
  纳入端点卡片本体，于是用 gap 符号判断作为调用点的权宜之计。
- **修复方向：** 让 `buildObstacles` 可选地纳入端点卡片本体（扣掉其端口所在行）；
  之后单一括号例程即可同时服务于「上下堆叠」与「紧贴并排」两种情况。

> 注：原「手动路由 dock side 翻转」条目已修复并移至「已完成」。

---

## 剩余 —— P3 清理（延期，附理由）

这些在第一轮清理中**有意未做**：要么是「投入/风险」与收益不成比例，要么应与某项
更大的重构合并。列在此处以免遗失。

### 复用 / 简化

#### 1. 前缀重试块复制了整条查找流水线
- **位置：** `inferForeignKeys.ts`（`pickBestTarget`）
- **延期理由：** 三个解析块（直接 / 前缀 / 尾段）使用**不同**的「排除自身表」过滤
  规则，且直接块的置信度档位还取决于候选数组的**长度**——因此抽取一个干净的共享
  `resolveTarget` 并不简单，会危及（已有测试覆盖的）推断逻辑，仅换来中等的可读性
  收益。

#### 2. `mouseout edge` 内联了隐藏手柄的定时器
- **位置：** `DiagramCanvas.tsx`（mount effect），与 `scheduleHideHandles` 重复
- **延期理由：** `scheduleHideHandles` 是渲染作用域内的闭包；要在只绑定一次的
  mount-effect 处理器里调用它，得先用 `useCallback` 稳定它再塞进 `[]` 依赖（或用
  ref）——为去重约 4 行代码引入的改动/lint 面过大。

#### 3. `effectiveForeignKeys` 对 `deletedTables` 双重过滤
- **位置：** `selectors.ts`
- **延期理由：** 尾部那次 `deletedTables` 过滤对**推断 FK 仍然必需**（`visibleSchema`
  只过滤显式 FK）；只有显式 FK 被过滤了两遍——成本低、无害。消除冗余会牵动多个调
  用方（导出菜单），收益微乎其微。

### 效率（热路径）

#### 4. `buildObstacles` 每条边都重建一次
- **位置：** `updateEdgeEndpoints.ts`
- **延期理由：** 每条边要排除自己的两个端点，所以「每边一份 `Rect[]`」是固有的；
  不做更大的重新设计（如「可感知排除项的障碍物索引」）就拿不到渐进复杂度上的收益。

#### 5. 初次布局时每条边被路由两遍
- **位置：** `DiagramCanvas.tsx`：`runLayout` 触发 `layoutstop`（路由全部边），随后
  rebuild effect 又调一次 `updateEdgeEndpoints`
- **延期理由：** 频率低（仅在重建时），且触及刚被 P1 history 修复稳定下来的
  rebuild/`layoutstop` 流程——单独做的话风险大于价值。

#### 6. `syncPositions` 在 pan/zoom 时重建整个数组
- **位置：** `DiagramCanvas.tsx`
- **延期理由（前提已修正）：** overlay 的屏幕坐标（`renderedBoundingBox`）在
  pan/zoom 时**确实**会变，所以数组本就必须重建；唯一真正的浪费是每节点的
  `colorForTableModule` 查找（颜色与 pan/zoom 无关）。最好按节点缓存颜色来解决。

#### 7. `TableOverlay` 未做 memo
- **位置：** `overlay/TableOverlay.tsx`
- **延期理由：** 要让 `React.memo` 真正生效，得先用 `useCallback` 稳定每节点回调
  （`onDragHandle` 等当前每次渲染都是全新闭包）——这是更大的重构，收益一般。

---

## 已完成（请勿重开）

> **P2 #3（拖拽热路径 rAF 合帧）**、**P2 #5（持久化加固）**、**手动路由 dock side
> 翻转** 均已完成；详见英文版 [TODO-fix-bugs.md](TODO-fix-bugs.md) 的「Done」段落。
> P2 #3 还顺带解决了两个原 P3 效率项：每节点 `position` 处理器不再每个事件都重建
> 障碍物图；`manualRoutes` 订阅已移除（改为按需 `useApp.getState()` 读取，路由
> 编辑不再触发整体重渲染）。
