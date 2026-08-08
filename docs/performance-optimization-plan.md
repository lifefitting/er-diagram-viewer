# ER Diagram Viewer 性能优化计划

> 基线版本：v0.3.3（`9dcc819`）与 v0.3.5（`8ec1b8a`）
> 基线采集：2026-08-05，结果生成时间 `2026-08-04T16:19:16.286Z`
> 计划状态：核心阶段已实现，正在做全量回归与最终复测（分支 `perf/optimization-plan`）
> 范围：大图导入、画布平移、表拖动、React HTML 覆盖层、正交布线与性能回归体系

## 1. 执行摘要

v0.3.5 在中、大规模图上的交互性能存在明确回归，且首要原因已可以从 A/B 数据与代码改动互相印证：字段排序功能为每个字段新增了一个常驻 DOM 控件及持续运行的 `filter/opacity` 呼吸动画。中等场景恰好多出 800 个动画，大场景恰好多出 1,920 个动画，分别等于 `80 表 × 10 字段` 与 `160 表 × 12 字段`；同时 DOM 节点数增加 45%～47%。对应地，中、大场景的平移和拖表平均 FPS 均下降约 40%，浏览器样式重算、布局树更新与预绘制成本显著上升。

优化按以下顺序推进：

1. 先修正基准工具的采样污染和动作有效性，建立可信、可重复的指标。
2. 立即消除不可见字段控件的空闲动画，并将字段操作控件改为按需挂载；这是低风险、最高收益的 P0。
3. 将画布几何同步从“每帧重建全部 React 覆盖层”拆为命令式几何更新与稳定内容渲染。
4. 将拖动中的高质量全局布线拆为轻量预览与落点后的局部高质量重算。
5. 在分段计时证实瓶颈后，再优化导入流水线、增量 Cytoscape 更新和 Web Worker 化。
6. 把小/中场景纳入 PR 性能冒烟，把大图、宽表和稠密关系纳入固定环境的夜间回归。

第一里程碑不是追求新架构，而是在不损失字段排序、拖线、键盘可访问性和布线质量的前提下，把 v0.3.5 至少恢复到 v0.3.3 的交互水平。完成 P0 后再依据新的 flame chart 决定是否启用可视区域裁剪、低缩放级别 LOD 或 Worker，避免同时改动过多变量。

### 1.1 实施进度（2026-08-08）

第一批改动已落地：

- 已将基准夹具和驱动脚本迁入 `perf/`，默认执行 1 次预热和 7 个正式样本，并输出 median、p95 与 MAD。
- 已修正跨样本状态串扰、Long Task 历史 buffer 污染、固定导入等待、硬编码 60Hz 帧预算和小图拖拽空动作问题。
- 已为表覆盖层和拖拽手柄添加稳定测试标识；平移或拖表不足 20px 时基准会失败。
- 已移除所有字段控件的空闲无限动画，改为当前行 hover/focus 时一次性、仅 `transform/opacity` 的短动画。
- 已停止 React 挂载后隐藏骨架的 `shimmer/spin`，正式样本的全局空闲动画数降为 0。
- 已补充 Chromium 交互回归测试和 Bun/Playwright CI 工作流。

第一批改动后的完整基线（字段控件按需挂载前）：

| 场景   | 导入 median | DOM 节点 | 空闲动画 |  平移 FPS / p95 | 拖表 FPS / p95 |
| ------ | ----------: | -------: | -------: | --------------: | -------------: |
| small  |    130.5 ms |    1,650 |        0 |  120.0 / 8.8 ms | 119.5 / 8.7 ms |
| medium |  1,055.6 ms |   14,644 |        0 | 101.4 / 16.7 ms | 94.1 / 16.8 ms |

以上数据使用仓库化后的严格口径，不能直接与旧脚本的绝对值相减；它作为后续分支内 A/B 的新基线。

### 1.2 字段控件按需挂载结果（2026-08-08）

第二批采用分层安全方案：阅读模式完全卸载连接点和排序按钮；编辑模式保留原生按钮命中区、Tab 顺序和 `aria-label`，将圆点、内圆及三横线改为 CSS 伪元素。字段行和 14px 排序占位始终存在，因此模式切换不会改变表尺寸或字段文字位置。

| 场景   | 阅读 DOM | 编辑 DOM | 空闲动画 | 平移 FPS / p95 |  拖表 FPS / p95 |
| ------ | -------: | -------: | -------: | -------------: | --------------: |
| small  |      913 |    1,114 |        0 | 120.0 / 8.9 ms |  120.0 / 8.9 ms |
| medium |    5,844 |    8,244 |        0 | 120.0 / 9.0 ms | 113.4 / 16.6 ms |

与按需挂载前的新口径基线相比：

- medium 阅读态 DOM 由 14,644 降至 5,844（-60.1%），编辑态降至 8,244（-43.7%）。
- medium 平移 Task 由 2,467.8 ms 降至 1,235.5 ms（-49.9%），FPS 由 101.4 升至 120.0。
- medium 拖表 Task 由 2,062.4 ms 降至 1,735.1 ms（-15.9%），FPS 由 94.1 升至 113.4。
- 5 个 Chromium 回归场景覆盖模式卸载、布局稳定、空闲动画、键盘焦点、首次外缘拖线和表拖拽；全部通过。

本批设定的阅读 DOM ≤ 6,500、编辑 DOM ≤ 9,500、Task 至少下降 10%、FPS 不回退超过 3% 均已达成。下一批可以进入覆盖层几何同步优化，不需要启用风险更高的“活动行共享控件”。

### 1.3 核心计划一次性实施结果（2026-08-08）

Phase 2～5 的非条件项已落地，最终性能数字以本轮完整复测为准：

- 覆盖层建立 `nodeId → HTMLElement` registry；表/字段内容由 React 低频更新，
  `pan/zoom/resize` 的几何经同一 rAF 调度器直接写 `translate3d/width/height`，
  表拖动只读取并更新移动组根节点。
- `TableOverlay` 已 memo 化，传入稳定且始终读取最新闭包的交互回调；Playwright
  用 MutationObserver 断言平移期间字段内容树没有 child/text mutation。
- 路由分为拖动/缩放中的 `preview` 与松手后的 `full`：preview 只处理 incident
  edges、使用 uniform grid 的局部障碍物查询并跳过全局 `assignTracks/fixedContext`；
  松手按旧/新 bbox 计算受影响边，超过 60% 或移动表超过 20 张时保守回退全量。
- row offsets 与结构化 route points 使用仅内存缓存，edge data 写回前比较新旧值；
  这些缓存不进入 Zustand 持久化或 `.erreview` 文件。
- SQL 流水线拆为 `parseAndMergeSql` 与 `derivePipeline`，使用有界 3 项 LRU；
  `updateSql` 只 parse/merge 一次，导入对话框不再重复 pre-flight parse，store
  在任何状态提交前完成“至少一张表”的原子校验。
- Cytoscape 改为稳定 ID 增量协调：保留未变化 node/edge 实例、位置、交互 class
  与运行时路由；fresh import 仍明确走完整替换，保持原有“新工作区”语义。
- 基准新增 wide/hub/dense/incremental 场景、绝对与相对回退门禁；PR 跑 small
  smoke，夜间跑完整矩阵并上传原始 JSON。
- 已加入 v0.3.x 字面量存档兼容测试，锁定 `formatVersion=1`、`persistVersion=2`、
  位置、手工路由和视口恢复；性能运行时字段不得出现在 archive envelope 中。

Worker 与 LOD 是原计划的条件项，不是默认架构：当前基准尚未证明局部高质量路由、
纯 pipeline 或 Dagre 连续超过 100ms，且 Phase 1 已达到 DOM/FPS 门槛，因此本轮不启用。
这样避免引入异步 generation 竞态、取消语义和低缩放视觉变化；若最终 large/hub/dense
复测跨过触发线，再以独立 feature flag 启用。

### 1.4 最终复测与条件项决策（2026-08-08）

medium 在同机、同仓库驱动下执行 1 次预热 + 5 个正式样本：

| 指标             | Phase 1 后 | 核心阶段后 | 变化   |
| ---------------- | ---------: | ---------: | ------ |
| 导入 median      | 1053.6 ms  | 933.4 ms   | -11.4% |
| 平移 Task median | 1235.5 ms  | 272.2 ms   | -78.0% |
| 平移 FPS / p95   | 120.0 / 9.0 ms | 120.0 / 8.9 ms | 持平  |
| 拖表 Task median | 1735.1 ms  | 306.5 ms   | -82.3% |
| 拖表 FPS / p95   | 113.4 / 16.6 ms | 120.0 / 8.9 ms | 明显改善 |

三正式样本扩展矩阵全部通过性能门禁：

| 场景 | 导入 median | 平移 FPS / p95 | 拖表 FPS / p95 | 拖表松手 median |
| ---- | ----------: | -------------: | -------------: | ---------------: |
| large（160×12） | 3554.1 ms | 120.0 / 9.0 ms | 120.0 / 8.9 ms | 10.8 ms |
| hub（100 表） | 1308.6 ms | 120.1 / 8.9 ms | 105.3 / 9.0 ms | 10.5 ms |
| dense（80 表） | 1411.2 ms | 120.0 / 8.9 ms | 120.0 / 8.8 ms | 9.9 ms |
| incremental（80→81） | 939.8 ms | 120.0 / 8.8 ms | 120.0 / 8.9 ms | 6.9 ms |

incremental SQL 更新提交到新增表可见为 101.4ms median；它包含 React commit、图增量
协调和双帧可见等待。额外 large 分阶段样本显示：parse+merge 6.0ms、derive 0.4ms、
arrange 14.8ms、full routing 14.6ms，均远低于 100ms Worker 触发线；large 拖表松手
也只有 10.8ms。LOD 与 Worker 因而明确“不触发”，不是遗漏实现。

最终验证：TypeScript 通过；47 个 Vitest 文件共 341 个测试通过；6 个 Playwright
Chromium 流程通过；生产构建通过；lint 为 0 error、7 个既有 warning；medium 与四场景
矩阵均通过 `perf:check`。Phase 5 的“两周趋势观察”从合入后由已配置 nightly 自然累计，
不属于本次代码实现的等待条件。

## 2. 当前基线与结论边界

### 2.1 基准来源

现有结果位于：

- 仓库严格基线（Phase 1 后）：`perf-results/2026-08-08T11-19-49.907Z/baseline.json`
- 核心优化后 medium：`perf-results/final-medium/baseline.json`
- 核心优化后 large/hub/dense/incremental：`perf-results/final-matrix/baseline.json`
- large 分阶段计时：`perf-results/stage-large/baseline.json`
- `/tmp/er-diagram-perf-tools/results/baseline.json`
- `/tmp/er-diagram-perf-tools/results/*.trace.json.gz`
- 基准驱动脚本：`/tmp/er-diagram-perf-tools/baseline.mjs`
- 动画实验脚本：`/tmp/er-diagram-perf-tools/animation-ab.mjs`

运行环境：

| 项目         | 值                                                  |
| ------------ | --------------------------------------------------- |
| Chrome       | `150.0.7871.187`，headless                          |
| 视口         | `1440 × 1000`，DPR 1                                |
| 主机刷新节奏 | 采样结果约 120 Hz                                   |
| 手势         | 72 个 mouse move，每步等待 16 ms，结束后等待 350 ms |
| 重复次数     | 每个动作 2 次                                       |
| 版本服务     | v0.3.3：`127.0.0.1:4173`；v0.3.5：`127.0.0.1:4174`  |

场景：

| 场景   |          数据规模 | 关系形态                     |
| ------ | ----------------: | ---------------------------- |
| small  | 内置样例，14 张表 | 真实样例                     |
| medium |   80 表 × 10 字段 | 相邻表链式 FK，共约 79 条边  |
| large  |  160 表 × 12 字段 | 相邻表链式 FK，共约 159 条边 |

### 2.2 页面规模与导入时间

| 场景   |      导入时间 v0.3.3 → v0.3.5 |  DOM 节点 v0.3.3 → v0.3.5 | 运行动画 v0.3.3 → v0.3.5 |
| ------ | ----------------------------: | ------------------------: | -----------------------: |
| small  |       19.9 → 19.6 ms（-1.5%） |   1,291 → 1,651（+27.9%） |      136 → 203（+49.3%） |
| medium | 2,215.1 → 2,308.5 ms（+4.2%） | 10,085 → 14,645（+45.2%） |  1,602 → 2,402（+49.9%） |
| large  | 5,860.2 → 5,873.8 ms（+0.2%） | 23,445 → 34,485（+47.1%） |  3,842 → 5,762（+50.0%） |

现阶段不能据此认定导入性能无回归：medium/large 的 `importMs` 包含固定 1,200 ms 等待，而且没有应用内部阶段标记。它只能说明当前粗粒度指标没有显示出大于约 5% 的版本差异。

### 2.3 交互结果与优化效果（2026-08-08 更新）

#### 2.3.1 最初 v0.3.3 → v0.3.5 回归

以下均为两次动作的算术平均；`Task` 与 `Recalc Style` 是动作窗口内 CDP 累积时间。

| 场景/动作     |    FPS v0.3.3 → v0.3.5 | p95 帧时 v0.3.3 → v0.3.5 |         Task v0.3.3 → v0.3.5 | Recalc Style v0.3.3 → v0.3.5 |
| ------------- | ---------------------: | -----------------------: | ---------------------------: | ---------------------------: |
| medium / 平移 |  92.7 → 54.0（-41.8%） | 17.1 → 33.2 ms（+94.4%） |   3,973 → 5,205 ms（+31.0%） |   1,258 → 1,586 ms（+26.0%） |
| medium / 拖表 | 100.3 → 60.4（-39.8%） | 16.7 → 25.1 ms（+50.3%） |   4,069 → 7,933 ms（+94.9%） |  1,330 → 2,660 ms（+100.1%） |
| large / 平移  |  35.1 → 20.6（-41.4%） | 45.8 → 67.3 ms（+46.7%） |  7,438 → 12,159 ms（+63.5%） |   2,336 → 3,628 ms（+55.3%） |
| large / 拖表  |  42.7 → 25.7（-39.9%） | 33.6 → 54.2 ms（+61.1%） | 16,287 → 26,835 ms（+64.8%） |   5,947 → 9,270 ms（+55.9%） |

small 场景仍能维持约 120 FPS，说明回归主要在 DOM 数量放大后显现；但其样式重算时间已经增加 33%～47%，只是尚未突破帧预算。

#### 2.3.2 同口径严格 A/B：Phase 1 后 → 核心优化后

以下是本轮可以直接计算百分比的正式对比。两端均使用仓库内 `perf/benchmark.mjs`、
Chrome `151.0.7922.34`、`1440 × 1000` 视口、72 步手势、16ms 步间隔和 250ms
settle；动作顺序随机、方向交替，每轮使用独立 browser context。对比来源：

- 优化前：`perf-results/2026-08-08T11-19-49.907Z/baseline.json`，1 次预热 + 7 个正式样本。
- 优化后：`perf-results/final-medium/baseline.json`，1 次预热 + 5 个正式样本。
- 场景：medium，80 表 × 10 字段、79 条链式 FK；下表均为正式样本 median。

用户感知指标：

| 动作 | FPS 优化前 → 后 | p95 帧时优化前 → 后 | 超预算帧优化前 → 后 | 松手耗时优化前 → 后 |
| ---- | ---------------: | ------------------: | ------------------: | ------------------: |
| 平移 | 120.0 → 120.0（持平刷新上限） | 9.0 → 8.9ms（-1.1%） | 0 → 0 | 13.9 → 4.0ms（-71.5%） |
| 拖表 | 113.4 → 120.0（+5.9%） | 16.6 → 8.9ms（-46.4%） | 16 → 0（-100%） | 29.0 → 7.5ms（-74.1%） |

主线程成本：

| 动作 | 动作 wall time | Task | Script | Layout | Recalc Style |
| ---- | ---------------: | ---: | -----: | -----: | -----------: |
| 平移 | 3086.6 → 2122.1ms（-31.2%） | 1235.5 → 272.2ms（-78.0%） | 822.6 → 52.1ms（-93.7%） | 3.72 → 0ms（-100%） | 45.3 → 51.1ms（+12.9%） |
| 拖表 | 2374.1 → 2134.4ms（-10.1%） | 1735.1 → 306.5ms（-82.3%） | 1161.6 → 73.6ms（-93.7%） | 5.28 → 0.05ms（-99.1%） | 6.6 → 7.7ms（+16.9%） |

结论：覆盖层 geometry/content 分离消除了平移、拖动期间的全量 React 字段树更新，
这是 Script 降低约 94% 的主因；拖动预览路由与松手局部精修进一步把拖表超预算帧
从 median 16 帧降为 0。`Recalc Style` 没有同步下降，反而分别增加 5.8ms 和 1.1ms：
这是每帧直接写覆盖层根节点 `transform/width/height` 的固定成本。它换掉了更昂贵的
React reconciliation，最终 Task 仍下降 78%～82%，属于明确的净收益。wall time 中还包含
72 × 16ms 的预设手势节奏、Playwright 输入开销和 250ms settle，因此改善幅度小于纯主线程指标。

#### 2.3.3 与最初 v0.3.3/v0.3.5 历史结果的恢复程度

下表用于回答“是否恢复并超过旧版本体验”。历史端是旧 `/tmp` 驱动的两次算术平均，
最终端是修正后驱动的 median；由于旧驱动混入 trace、固定等待和动作串扰，只比较可感知
趋势，不对三列 Task/Recalc 做百分比推导。

| 场景/动作 | v0.3.3 FPS / p95 | v0.3.5 FPS / p95 | 最终 FPS / p95 | 结果 |
| --------- | ----------------: | ----------------: | -------------: | ---- |
| medium / 平移 | 92.7 / 17.1ms | 54.0 / 33.2ms | 120.0 / 8.9ms | 已超过 v0.3.3 |
| medium / 拖表 | 100.3 / 16.7ms | 60.4 / 25.1ms | 120.0 / 8.9ms | 已超过 v0.3.3 |
| large / 平移 | 35.1 / 45.8ms | 20.6 / 67.3ms | 120.0 / 9.0ms | 已超过 v0.3.3 |
| large / 拖表 | 42.7 / 33.6ms | 25.7 / 54.2ms | 120.0 / 8.9ms | 已超过 v0.3.3 |

最终结果不仅消除了 v0.3.5 相对 v0.3.3 约 40% 的 FPS 回归，也把 large 从持续突破
33～67ms 帧时的状态恢复到约 9ms p95。这里的“超过”表示在本机最终修正基准上的观测值
优于旧版本历史观测值，不等同于旧驱动下的严格版本 A/B。

#### 2.3.4 复杂拓扑泛化结果

为避免链式 FK 对路由局部化过于友好，最终矩阵还覆盖 large、hub、dense 和 incremental，
每项 1 次预热 + 3 个正式样本：

| 场景 | 平移 FPS / p95 / 超预算帧 | 拖表 FPS / p95 / 超预算帧 | 拖表 Task | 松手耗时 |
| ---- | --------------------------: | --------------------------: | --------: | --------: |
| large（160×12，链式） | 120.0 / 9.0ms / 0 | 120.0 / 8.9ms / 0 | 452.0ms | 10.8ms |
| hub（100 表，星型） | 120.1 / 8.9ms / 0 | 105.3 / 9.0ms / 1 | 976.0ms | 10.5ms |
| dense（80 表，稠密） | 120.0 / 8.9ms / 0 | 120.0 / 8.8ms / 0 | 374.0ms | 9.9ms |
| incremental（80→81） | 120.0 / 8.8ms / 0 | 120.0 / 8.9ms / 0 | 296.6ms | 6.9ms |

hub 是当前最重的交互场景：高出度中心表使拖动窗口累计 Task 达到 976.0ms，median
估算 FPS 为 105.3，并出现 1 个超预算帧；但 p95 仍为 9.0ms，松手高质量路由为
10.5ms，没有跨过 100ms Worker 触发线。它应作为后续 nightly 的首要观察对象，而不是
当前启用 Worker 的理由。

### 2.4 最初 v0.3.3/v0.3.5 Trace 证据

第一轮带 trace 的样本中，主导成本是 `UpdateLayoutTree` 与 `PrePaint`，不是 CDP 的 `LayoutDuration`：

| 场景/动作     | UpdateLayoutTree v0.3.3 → v0.3.5 |   PrePaint v0.3.3 → v0.3.5 |
| ------------- | -------------------------------: | -------------------------: |
| medium / 平移 |       1,242 → 1,588 ms（+27.8%） |   941 → 1,204 ms（+28.0%） |
| medium / 拖表 |       1,390 → 2,642 ms（+90.1%） |   891 → 1,658 ms（+86.1%） |
| large / 平移  |       2,293 → 3,623 ms（+58.0%） | 1,545 → 2,641 ms（+71.0%） |
| large / 拖表  |       5,851 → 9,290 ms（+58.8%） | 3,198 → 5,506 ms（+72.1%） |

`RecalcStyleCount` 在 medium/large 平移中没有同步增加，部分样本反而下降，但总耗时明显增加。这说明主要问题不是“触发次数更多”，而是每次样式/布局树更新要处理的 DOM 和动画集合更大。

### 2.5 最初 `/tmp` 基准的已知缺陷（已由仓库基准修复）

当前结果适合确定方向和 P0 优先级，不应直接成为发布门禁：

1. 每个动作只有 2 次样本，无法估计方差、置信区间或冷热抖动。
2. 每个场景固定先平移后拖表，且复用同一页面上下文，动作顺序与 GC/缓存状态没有随机化。
3. 每个动作第一轮开启 trace、第二轮不开启，trace 开销被混入平均值。
4. Long Task Observer 使用 `{ buffered: true }`，会把导入和此前动作的 long task 重复计入后续动作，因此现有 `longTaskCount/TotalMs` 不能用于动作间比较。
5. small 场景两版本的拖表都记录 `movedPixels = 0`，动作未真正移动节点，应判为失败样本而不是性能样本。
6. medium/large 的导入计时包含固定 1,200 ms 稳定等待；small 使用另一条路径且不包含该等待，三种规模不可横向比较。
7. “导入完成”依赖文本和 canvas 可见，没有区分解析、推断、图构建、Dagre、布线、React commit 和可交互时刻。
8. 仅覆盖链式 FK。它能放大 DOM 问题，但不能覆盖高出度 hub、平行边和稠密图的布线复杂度。
9. 只覆盖一台机器、一个 Chrome 版本和一个视口；FPS 绝对值受 120 Hz 刷新率影响，应同时报告相对掉帧率。
10. `v0.3.4` 没有发布，本次实际是 v0.3.3 与 v0.3.5 两端对比。

## 3. 热点判断与优先级

### 3.1 P0：隐藏控件仍常驻 DOM 并持续动画

证据强度：高，已由数据和版本 diff 互证。

- `ColumnRow` 为每个字段常驻渲染一个排序 button、握手容器和三条 bar；控件虽 `opacity-0`，仍参与样式匹配、命中测试和动画。
- `.column-reorder-grip` 在 `prefers-reduced-motion: no-preference` 下对所有字段持续执行 `filter: drop-shadow(...)` 与 `opacity` 动画。
- v0.3.5 比 v0.3.3 多出的动画数精确等于字段数：medium `+800`，large `+1,920`。
- 两侧连线触点也对每个字段常驻两个 button，并在不可见时持续运行 `box-shadow/opacity` 动画；这是 v0.3.3 已有成本，应在本轮一并清理，而不是只恢复到旧版本。

相关代码：

- `src/diagram/overlay/ColumnRow.tsx`
- `src/diagram/overlay/TableOverlay.tsx`
- `src/styles.css`

### 3.2 P0/P1：平移与缩放全量重建 React 覆盖层

证据强度：高，代码路径明确；具体收益需在 P0 后重新采样。

`DiagramCanvas.syncPositions()` 在每次 `pan/zoom/resize` 和每帧节点拖动中：

1. 遍历全部 Cytoscape 节点。
2. 对每个节点读取 `renderedBoundingBox()`。
3. 新建全部 `NodePos` 对象与数组。
4. `setPositions()` 触发 `DiagramCanvas` 及所有 `TableOverlay/ColumnRow` 的 React reconciliation。
5. 父组件又为每张表、每个字段创建新的内联回调，阻碍后续 `React.memo` 获益。

节点拖动已用 rAF 合并 `position` 事件，这是正确基础；但 `pan/zoom` 仍同步执行全量更新，且 rAF 只减少触发次数，没有减少每次处理的 DOM/React 规模。

相关代码：

- `src/diagram/DiagramCanvas.tsx` 的 `syncPositions`、`flushDrag` 和 `positions.map(...)`
- `src/diagram/overlay/TableOverlay.tsx`
- `src/diagram/overlay/ColumnRow.tsx`

### 3.3 P1：拖动布线存在全图扫描和超线性后处理

证据强度：中，代码复杂度明确，但现有 trace 尚未把路由函数的 CPU 占比单独量化。

当前 `updateEdgeEndpoints()` 的主要成本：

- 每次调用先遍历所有表构建 `rectById`。
- 每条待更新边通过 `buildObstacles()` 再遍历所有表，直接路由会对多组候选线段扫描障碍物。
- live detour 会建立障碍物角点图并执行朴素 Dijkstra；局部障碍物多时成本快速上升。
- 部分边更新仍遍历所有其他边、解析 `routePoints` 作为 fixed context。
- `assignTracks()` 在拥挤 cluster 内比较多条路线，最坏接近平方级。
- 拖表松手后无条件对 `cy.edges()` 做全量高质量重算，即使大多数边不受移动节点影响。

相关代码：

- `src/diagram/routing/updateEdgeEndpoints.ts`
- `src/diagram/routing/channelRoute.ts`
- `src/diagram/routing/assignTracks.ts`
- `src/diagram/DiagramCanvas.tsx` 的 `onTableDragStart`

### 3.4 P1：导入路径重复解析/推导且图更新为全量替换

证据强度：中，代码路径明确；现有 `importMs` 无法分段验证占比。

默认“保留现有布局”导入至少存在以下重复：

1. `SqlInputDialog.submit()` 先调用 `parseSql()` 做 pre-flight。
2. `updateSql()` 调用 `runPipeline()` 得到 draft。
3. 无重叠时再进入 `setSql()` 调用一次 `runPipeline()`；有重叠时也会按协调后的设置再次调用 `runPipeline()`。

即默认更新路径会解析 SQL 三次，并至少运行完整 pipeline 两次。随后 `DiagramCanvas` 又通过 `cy.elements().remove()` + `cy.add(elements)` 替换全部图元素，即使只是边可见性或少量表变化。

相关代码：

- `src/ui/overlays/SqlInputDialog.tsx`
- `src/store/schemaSlice.ts`
- `src/store/pipeline.ts`
- `src/diagram/DiagramCanvas.tsx` 的结构重建 effect

## 4. 性能目标与验收口径

### 4.1 功能与质量约束

所有性能改造必须同时满足：

- 字段排序、字段拖线、表拖动、表缩放、多选拖动、撤销/重做、手工路由和刷新持久化行为不变。
- 鼠标、触控板和键盘路径均可用；按需挂载控件不能破坏 Tab 顺序、ARIA 名称与 `prefers-reduced-motion`。
- 连接线仍不得穿过表卡片；现有 `countCrossings`、`countOverlaps` 与路由单测不得退化。
- 暗色/亮色、15%～100% 缩放、折叠、only-PK、字段注释、搜索高亮均需视觉回归。
- 不用“降低动画速度”掩盖问题；空闲不可见控件不应有持续动画。

### 4.2 第一阶段恢复门槛

在修正后的同机 A/B 基准上，连续 7 次测量取中位数，至少达到：

| 指标                    |                                          恢复门槛 |
| ----------------------- | ------------------------------------------------: |
| 空闲 running animations | 与图规模无关，目标 0；允许全局加载提示等至多 2 个 |
| medium DOM 节点         |                             不高于 v0.3.3 的 110% |
| large DOM 节点          |                             不高于 v0.3.3 的 110% |
| medium 平移             |                           FPS ≥ 88；p95 ≤ 18.8 ms |
| medium 拖表             |                           FPS ≥ 95；p95 ≤ 18.4 ms |
| large 平移              |                           FPS ≥ 33；p95 ≤ 50.4 ms |
| large 拖表              |                           FPS ≥ 40；p95 ≤ 37.0 ms |

这些阈值约等于 v0.3.3 FPS 的 95% 与 p95 的 110%，用于判断“回归是否被消除”，不是最终性能上限。

### 4.3 第二阶段改进目标

完成覆盖层与路由改造后：

- medium 平移/拖表 p95 控制在一个 60 Hz 帧预算附近（≤ 16.7 ms）。
- large 平移/拖表 p95 ≤ 33.3 ms，平均 FPS 较修正后的 v0.3.5 基线提升至少 50%。
- 平移期间 React Profiler 不再显示每一帧重渲染全部字段内容；内容组件 commit 数应与数据/选择变化相关，而非与 pan/zoom 事件数相关。
- 单表拖动期间只更新移动节点和受影响边；松手后的高质量重算不产生 >100 ms 的不可中断主线程任务。
- 导入阶段完成分段基线后，将 large 的“提交到可交互”中位数降低至少 30%，并把任一纯 JS 主线程阶段控制到 100 ms 以下；若做不到则进入 Worker。
- 优化后路由交叉数、重合数不得高于优化前同 fixture；视觉抽检不得出现边穿表或端口脱离字段。

### 4.4 统计与回归判定

- 本地调优：1 次预热 + 7 次正式样本，报告 median、p75、p95、MAD。
- 夜间回归：1 次预热 + 10 次正式样本，保留原始样本和 trace。
- trace 采集与无 trace 指标采集分开，trace 样本不参与 FPS/帧时平均。
- 同一个 PR 同时跑 base commit 与 candidate commit，优先使用相对差异，减少机器噪声。
- 关键指标相对 base 回退 >10%，且 3 次独立批次中至少 2 次复现，则阻断合并。
- 优化收益小于噪声区间时不宣称改善；以 95% bootstrap CI 或 MAD 区间辅助判断。

## 5. Phase 0：修复性能基准（0.5～1 天）

### 5.1 将工具变成可复用仓库资产

- 将 `/tmp/er-diagram-perf-tools` 中有价值的 fixture、动作驱动和 trace 汇总逻辑迁入 `perf/` 或 `tests/performance/`。
- 使用项目既定的 Bun 命令，增加 `perf:baseline`、`perf:compare`、`perf:trace`；不要依赖临时目录和手工启动两个固定端口。
- 原始 trace 作为 CI artifact，不提交大体积 gzip；仓库只保留版本、环境、fixture hash 与聚合 JSON。
- 固定浏览器版本、启动参数、视口、DPR、字体和系统动画偏好，记录 CPU/OS/刷新率元数据。

### 5.2 修正采样逻辑

- Long Task Observer 改为 `buffered: false`，每个动作开始时清空数组，并按 `performance.now()` 时间窗过滤。
- traced run 与 metric run 分离；正式统计全部关闭 tracing。
- 每个版本/场景使用独立 context；版本和动作顺序随机化或拉丁方排列。
- rAF 指标同时报告 `estimatedFps`、p50/p95/p99、>1 帧预算比例与最长连续掉帧，不只报告平均 FPS。
- 以检测到的显示刷新间隔为基准计算 dropped-frame ratio，使 60/120 Hz 机器可比较。
- 使用 Event Timing 记录 pointer/mouseup 的 input delay 与 presentation delay，替代单纯的 Playwright `mouse.up()` 调用耗时。

### 5.3 加入应用内性能标记

仅在开发/性能构建开启以下 `performance.mark/measure`：

- `import:start`
- `parse:done`
- `merge-shards:done`
- `infer-fk:done`
- `infer-modules:done`
- `cy:add:done`
- `dagre:done`
- `routing:done`
- `overlay:first-commit`
- `interactive`

每个阶段同时记录表数、字段数、边数、可见字段数和缩放级别。导入基准等待 `interactive` mark，不再依赖固定 1,200 ms sleep。

### 5.4 动作有效性断言

- 为表卡片/表头提供稳定的 `data-testid` 或 `data-node-id`，直接拖动指定表，不使用通用 `.cursor-grab` 猜测目标。
- 拖表前后断言 Cytoscape/model position 与 rendered bounding box 均移动至少目标距离的 70%；否则样本失败。
- 平移前后断言 viewport pan 改变量；缩放动作断言 zoom 改变量。
- 动作期间若页面报错、元素重建、选中错误对象或样本帧数不足，整次样本无效，不以 0 参与聚合。

### 5.5 扩展 fixture 矩阵

| Fixture                   | 目的                          | PR / Nightly          |
| ------------------------- | ----------------------------- | --------------------- |
| small 14 表               | 基本功能与低端规模            | PR                    |
| medium 80×10 chain        | DOM/覆盖层基准                | PR                    |
| large 160×12 chain        | 大图交互                      | Nightly，关键 PR 手动 |
| wide 50×50                | 字段 DOM 与宽表               | Nightly               |
| hub 100 表、单点高出度    | 拖动 incident edge 与局部布线 | Nightly               |
| dense 80 表、每表 3～5 边 | assignTracks/交叉检测         | Nightly               |
| incremental +10 表        | 增量导入与图 diff             | PR                    |

每个图至少覆盖 20%、50%、100% 三档 zoom，以及阅读/编辑两种模式。低缩放用于验证 LOD，100% 用于验证字段操作体验。

Phase 0 验收：修复 small 拖表后 `movedPixels > 0`；动作 long task 不再包含导入阶段；同一 commit 连跑 7 次的主要指标 MAD/median ≤ 10%。

## 6. Phase 1：消除空闲动画与常驻字段控件（1～2 天，P0）

### 6.1 低风险止血

第一步只改动画生命周期，不改交互结构：

- `.connect-dot` 与 `.column-reorder-grip` 默认 `animation: none`。
- 仅在当前行 `:hover`、`:focus-within` 或正在拖线/排序时启用一次短提示；空闲和 `opacity: 0` 状态绝不运行动画。
- 将 `box-shadow`/`filter` 的循环动画改为 `transform` + `opacity` 的短 transition；hover 可保留静态 halo。
- `prefers-reduced-motion: reduce` 下完全禁用非必要动画。
- 在大图阈值下不自动降级功能，而是使用同一按需动画规则，确保行为一致。

先独立提交这一改动并重跑 A/B，量化“动画”本身占回归的比例。

### 6.2 减少常驻 DOM

若只停动画仍未达到恢复门槛，立即执行：

- 字段行本体保留 `data-fk-*` 与 `data-column-order-*`，左右连接点和排序握手只为当前 hover/focus 行挂载。
- 让字段行可聚焦；键盘聚焦时挂载同一组操作按钮，保证无鼠标路径可达。
- 将三条 bar 改为一个 CSS background/pseudo-element 或单一 SVG，避免每个握手再创建 3 个 span。
- 将连接点的内外两层圆改为 button 的 `::before/::after`，减少每个字段的子节点。
- 优先在 `TableOverlay` 维护 `activeColumn`，一次最多渲染一行控件；必要时再升级为画布级单例浮层。
- 行 hover 状态只重渲染当前表，不触发整个 `DiagramCanvas`。

### 6.3 Phase 1 验收

- idle `document.getAnimations().filter(running)` 与字段数无关，目标为 0。
- medium/large 的 DOM 节点达到第 4.2 节恢复门槛。
- medium/large 平移和拖表均恢复到第 4.2 节门槛。
- 鼠标 hover、字段排序、左右拖线、Tab/Enter/Space、Escape 取消、reduced-motion 全部通过。
- Chrome trace 中 `UpdateLayoutTree` 与 `PrePaint` 至少较 v0.3.5 修正基线下降 30%。

如果本阶段已恢复 v0.3.3 水平，可先发布一个小版本，再继续后续架构优化。

## 7. Phase 2：拆分覆盖层几何与内容渲染（2～4 天，P0/P1）

### 7.1 目标架构

将覆盖层拆成两条更新通道：

```text
schema/display/selection 变化 ──> React 内容树（低频）
pan/zoom/node position 变化 ──> DOM ref 几何样式（每帧，rAF 合并）
```

React 负责表/字段内容、选择状态和操作控件；Cytoscape 事件只更新 wrapper 的 `transform/width/height`，不再创建完整 `NodePos[]` 并重渲染所有字段。

### 7.2 实施步骤

1. 为每个表覆盖层建立 `nodeId → HTMLElement` ref registry。
2. 将现有 `positions` 拆为低频的 overlay model 列表与高频的 geometry map；表集合变化时才更新前者。
3. `pan/zoom/resize/position` 统一进入一个 rAF scheduler，避免同帧多次同步。
4. 平移/缩放时命令式写入 `transform: translate3d(...)` 与尺寸；只读取一次 cy pan/zoom，避免 layout read/write 交错。
5. 节点拖动时只更新移动组的 DOM；pan/zoom 才更新当前已挂载节点。
6. `TableOverlay` 与 `ColumnRow` 使用 `React.memo`，同时稳定回调引用或改用携带 `data-*` 的事件委托；不能只包一层 `memo` 而继续传入每帧新对象/新箭头函数。
7. `moduleColor`、字段 FK 集合、批注 map、可见字段列表按 schema/display signature 缓存，不在每帧重新创建。
8. 拆分 `display` 依赖：网格、低置信边、字段高度、字段类型等分别订阅，避免切换网格触发节点重算和全边 reroute。

### 7.3 条件式 LOD 与裁剪

仅当上述拆分后 large 仍未达到第二阶段目标，再启用：

- 视口外扩大一屏的表只保留轻量占位或卸载 HTML 内容，但 Cytoscape 节点和边仍保留。
- zoom ≤ 0.33 时只渲染表头、模块和字段数摘要；zoom ≥ 0.5 或表被选中/hover 时渲染完整字段。
- 0.33～0.5 使用滞回区间，避免缩放临界点反复 mount/unmount。
- LOD 必须保持卡片几何尺寸和端口坐标不变，不能引起布局跳动。

### 7.4 Phase 2 验收

- React Profiler 显示：连续平移 72 步时，字段内容组件 commit 次数接近 0；几何 wrapper 通过 DOM 写入更新。
- `syncPositions` 不再每帧调用 `setPositions`；同帧 pan/zoom/position 最多一次 flush。
- medium p95 ≤ 16.7 ms；large 达到第 4.3 节目标。
- 组件卸载后没有遗留 rAF、window listener 或 stale ref。
- LOD 若启用，缩放往返 20 次不出现闪烁、焦点丢失或操作控件挂到错误字段。

## 8. Phase 3：拖动布线路由分层与局部化（3～5 天，P1）

### 8.1 先建立纯函数基准

为 `updateEdgeEndpoints` 的纯数据部分增加 micro-benchmark，分别测：

- rect/row offset 构建。
- direct route。
- live detour。
- partial fixed context。
- assignTracks。
- route encode/write。

对 chain、hub、dense 三种 fixture 报告边/秒和单次 p95，确认 CPU 时间后再改算法。

### 8.2 缓存路由上下文

- 建立随节点位置/尺寸增量更新的 `RoutingContext`，缓存 `rectById`、row offsets 与解析后的 route points。
- row offsets 以 `table + collapsed + onlyPk + showComment` 为 key 跨调用复用，不再只在单次函数内 memoize。
- 用 uniform grid/R-tree 查询边走廊附近障碍物，替代每条边构造 `V-2` 个障碍物数组。
- `routePoints` 保留结构化数组作为运行时数据，只有持久化/导出边界才编码字符串，避免部分更新反复 parse/stringify。
- 写回前比较新旧 endpoint/segments；值未变则跳过 `e.data()`，减少 Cytoscape style invalidation。

### 8.3 拆分拖动预览与落点质量

拖动中：

- 只处理移动节点的 incident edges。
- 使用固定端口 stub + 简单 H-V-H/平移旧路径作为预览。
- 不运行全局 assignTracks，不构造全部 fixed context，不运行高成本 Dijkstra。
- 保持每帧可中断，预算建议 ≤ 4 ms。

松手后：

- 受影响集合 = incident edges + 与移动表旧/新包围盒相交的边 + 共用轨道 cluster 的边。
- 先同步完成端点停靠，确保视觉不脱节；高质量 detour/track assignment 在下一帧或 idle slice 中完成。
- 只有当影响集合超过安全阈值或空间索引无法证明不相关时才退回全量 reroute。
- 手工 route override 始终优先，不因局部重算被覆盖。

### 8.4 Worker 决策点

只有当“松手高质量重算”在局部化后仍连续超过 100 ms，才把纯路由部分迁入 Web Worker：

- 主线程序列化紧凑的 node/edge typed data，不传 Cytoscape 对象。
- Worker 返回 route points 和 generation id；主线程丢弃过期结果。
- 拖动过程中不等待 Worker；预览路径始终即时。
- 先测 structured clone 成本，避免小图因 Worker 往返变慢。

### 8.5 Phase 3 验收

- hub/dense fixture 的拖动每帧路由 CPU p95 ≤ 4 ms。
- large 拖表 mouseup 到视觉稳定 p95 ≤ 100 ms，且主线程无单个 >100 ms route task。
- `countCrossings`、`countOverlaps` 不高于改造前；所有 edge-vs-node intersection 测试通过。
- 快速连续拖动同一表 20 次时，不应用过期异步路由。
- 撤销/重做、宽度调整、折叠、字段排序导致的端口变化均正确触发保守失效。

## 9. Phase 4：导入与图更新流水线（3～5 天，P1/P2）

### 9.1 消除重复解析与推导

- 将 pipeline 拆为 `parseAndMerge(sql)` 与 `deriveFromSchema(schema, settings)`。
- `SqlInputDialog` 不再单独 pre-flight 后重复工作；store action 在提交状态前完成一次原子验证并返回 Result。
- `updateSql` 用一次 parse/merge 判断表重叠，再以最终协调设置执行一次 inference/module derivation。
- 同一 SQL + derivation settings 使用 request-scope cache；不要做无限期全局缓存。
- `setSql/updateSql/importWorkspace/reparse` 共用一个可计时入口，避免四条路径继续漂移。

### 9.2 增量更新 Cytoscape

- 用稳定 node id、fkKey 计算 add/update/remove diff。
- 只增删变化元素；未变化节点保留 Cytoscape 实例、位置、class 与渲染缓存。
- 仅当影响表尺寸或拓扑时运行对应布局/路由；边的 accept/reject、主题和网格分别走样式增量路径。
- `display` 中影响几何的字段变化才重算 box size；`showGrid` 不得触发节点尺寸和全边 reroute。
- 将 full rebuild 保留为校验/回退路径，并用 fixture 断言增量结果与 full rebuild 等价。

### 9.3 Worker 化导入

先以 Phase 0 marks 决策：

- 若 parse + merge + infer 的任一阶段 p95 > 100 ms，则把纯 pipeline 放入 Worker。
- 若 Dagre > 100 ms，单独把 layout 输入序列化到 Worker；返回稳定 node positions/waypoints。
- 主线程显示可取消的进度状态；新导入覆盖旧 generation，过期 Worker 结果不得提交 store。
- 页面首次恢复持久化 SQL 也走同一异步入口，避免启动 effect 长时间阻塞首屏。

### 9.4 Phase 4 验收

- 一次默认 SQL 更新最多解析一次、完整 inference 一次；用计数断言保护。
- incremental +10 表场景只新增 10 个 node，既有 Cytoscape node 对象和位置保持稳定。
- large “提交到可交互”较修正基线至少下降 30%。
- 导入期间 UI 可响应取消，Event Loop 不出现 >100 ms 的 pipeline/layout task。
- fresh import、overlap update、archive restore/merge、刷新 reparse 的最终 schema、布局与评审状态均保持现有语义。

## 10. Phase 5：持续性能回归防线（1～2 天）

### 10.1 测试分层

- Vitest：路由、空间索引、失效集合、pipeline 单次执行、增量 diff 等纯逻辑。
- Playwright functional：字段排序/拖线/拖表/平移动作有效性和无错误。
- Playwright/CDP performance：只在 Chromium 项目运行；Firefox/WebKit 保留功能测试，不使用 Chromium 专属指标。
- React Profiler 测试：验证 pan/zoom 不触发字段内容树全量 commit。

### 10.2 CI 策略

PR 冒烟：

- small + medium。
- 3 次样本，以明显回归门槛为主。
- 检查 idle animations、DOM 数、动作有效性、p95 和错误日志。

Nightly/发布候选：

- medium、large、wide、hub、dense、incremental。
- 10 次样本，base/candidate 同机 A/B。
- 上传 summary、原始 JSON、trace、浏览器版本与机器信息。
- 保存最近 30 次趋势，区分一次性噪声和持续漂移。

门禁分两步启用：前 1～2 周只告警并校准波动，阈值稳定后再阻断 PR。

## 11. 建议的 PR/提交顺序

| 顺序 | 变更                                                |      预计 | 可独立回退                     |
| ---- | --------------------------------------------------- | --------: | ------------------------------ |
| PR 0 | 迁移并修正 benchmark、动作断言、性能 marks          | 0.5～1 天 | 是                             |
| PR 1 | 禁止不可见控件空闲动画，移除 filter/box-shadow 循环 |    0.5 天 | 是                             |
| PR 2 | active-row 按需控件与 DOM 精简                      | 1～1.5 天 | 是                             |
| PR 3 | 覆盖层 geometry/content 拆分与 rAF scheduler        |   2～4 天 | 是，保留旧同步器开关           |
| PR 4 | RoutingContext、拖动预览、局部失效与落点重算        |   3～5 天 | 是，保留 full reroute fallback |
| PR 5 | pipeline 单次解析与 Cytoscape 增量 diff             |   2～4 天 | 是，保留 full rebuild fallback |
| PR 6 | 条件式 Worker、LOD/裁剪（仅数据证明需要时）         |   2～4 天 | 是，feature flag               |
| PR 7 | CI/nightly 门禁与趋势产物                           |   1～2 天 | 是                             |

每个 PR 只改变一个主要变量，附带同环境 before/after 原始数据。PR 1/2 达到恢复门槛后即可形成一个性能修复版本，不必等待所有长期优化完成。

## 12. 风险与回退策略

| 风险                             | 影响                | 缓解与回退                                                                                             |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| 按需挂载字段控件破坏键盘访问     | 功能/无障碍回归     | 字段行可聚焦，focus-within 挂载；加入 Playwright 键盘流程；可回退为“常驻 button、无动画、伪元素减 DOM” |
| 命令式 DOM 几何与 React 状态漂移 | 卡片错位、stale ref | React 仍拥有内容/生命周期；单一 registry；generation guard；保留旧 `syncPositions` feature flag        |
| LOD 改变端口/卡片尺寸            | 边与字段错位        | LOD 只改变内容细节，不改变 model box；未达到 Phase 2 指标不启用                                        |
| 局部 reroute 漏掉受影响边        | 边穿过移动后的卡片  | 使用旧/新 bbox 扩张查询并保守回退全量；质量测试和可视化 debug overlay                                  |
| Worker 结果过期                  | 快速连续操作回跳    | generation id + Abort/忽略旧响应；主线程只应用最新 generation                                          |
| CI 机器噪声造成误报              | 阻塞正常 PR         | 同机 base/candidate、MAD/CI、告警观察期、固定浏览器与 runner                                           |
| 性能改造降低视觉提示             | 可发现性下降        | hover/focus 短提示和静态 halo 保留；用户测试验证字段排序与拖线仍易发现                                 |
| 性能缓存污染工作区存档           | 旧存档不可读/快照膨胀 | 缓存仅放模块级 WeakMap/ref；锁定 v0.3.x 字面量 fixture、版本常量和 envelope 字段；导入仍复用迁移/清洗 |
| 增量图更新破坏旧布局             | 位置/手工路由/视口丢失 | 稳定 ID 保留实例与 runtime data；fresh import 显式 full replace；单测覆盖位置、class、route data       |

## 13. 完成定义

本计划在同时满足以下条件时完成：

1. Phase 0 基准缺陷全部修复，动作可验证、指标不串窗、结果可复现。
2. v0.3.5 的 medium/large 交互至少恢复到 v0.3.3 恢复门槛。
3. 空闲动画数量不再随字段数增长，DOM 增长受到约束。
4. pan/zoom 不再通过 React 每帧重渲染全部表字段内容。
5. 拖动预览与落点高质量布线分离，hub/dense 场景达到路由预算且质量不退化。
6. 导入路径消除重复解析，并依据阶段 marks 达到 30% large 改善或完成 Worker 化。
7. PR 冒烟与 nightly 趋势运行至少两周，阈值稳定且能捕获一次人为注入的性能回归。
8. 所有现有单元测试、类型检查、lint、构建和新增 Playwright 功能流程通过。

本计划的代码与自动化建设已完成。合入后只剩 Phase 5 规定的两周趋势观察与阈值校准；
若期间 large/hub/dense 的 full route、layout 或纯 pipeline p95 穿过 100ms，再单独启用
Worker/LOD feature flag，而不是改动现有存档与交互语义。
