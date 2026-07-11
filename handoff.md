# Handoff — 项目交接文档

> 面向：接手本仓库的开发者 / 下一次开发会话。
> 目标：10 分钟内了解项目定位、当前状态、如何跑起来、改动热区与已知坑。
> 更新时间：2026-07-11（基于 v0.3.0 之后的未发布工作区）。

---

## 1. 项目是什么

**纯前端 SPA**：粘贴/上传 SQL DDL → 解析为可交互 ER 图。核心卖点有二：

1. **推断**：脚本没写外键时，按命名/类型/索引启发式推断外键关系；
   分库分表场景下按业务键（如 `out_trade_no`）扫描逻辑关联（用户触发）。
2. **评审**：字段级批注（带时间戳）、关系逐条确认（接受/拒绝/手动连线）、
   沉淀导出为评审报告与数据库设计说明文档。

定位是 **DB 设计评审工具**，不只是画图。产品演进方向见 [roadmap.md](roadmap.md)。

技术栈：React 18 + TypeScript（strict）+ Zustand + Cytoscape（只画边，表卡是 HTML
overlay）+ dagre（分层布局）+ Tailwind 3 + Vite/Vitest，Bun 作包管理与脚本运行器。
零后端；持久化用 sessionStorage（有意不落盘——导入的可能是生产 schema）。

## 2. 快速上手

```bash
bun install          # 依赖（bun.lock）
bun run dev          # 开发（HMR 对 cytoscape 不可靠，见下文"验证方式"）
bun run test         # vitest（262 用例 / 30 文件，全绿）；勿用裸 `bun test`
bun run typecheck    # tsc -b --noEmit（strict，0 error）
bun run lint         # eslint（当前 7 条 warning，均为既有 as any / exhaustive-deps）
bun run build && bun run preview   # 端到端验证用这个，不要信 HMR
```

- 首次打开自动载入电商样例（`src/samples.ts`，特意不写显式外键以展示推断；
  含 `out_trade_no` 三表用于演示逻辑关联扫描）。
- **验证方式**：`bun run preview` + 浏览器（本仓库开发中大量使用 Playwright 驱动
  真实页面验证；cy 实例可经 `document.querySelector('.cy-container')._cyreg.cy`
  在控制台取到，用于调试）。
- CI：`.github/workflows/` 三条（typecheck+lint+test+build；GitHub Pages 部署；
  tag 触发单文件 HTML release）。

## 3. 架构 60 秒版

数据流水线（详见 [CLAUDE.md](CLAUDE.md)，那是最完整的开发者文档，请保持同步更新）：

```
SQL 文本 ──parseSql──▶ Schema ──mergeShardedTables──▶ 合并分表
        ──inferForeignKeys──▶ FK 候选（高/中/低置信度）
        ──inferLogicalLinks──▶ 逻辑关联候选（仅对用户勾选的 logicalKeys 运行）
        ──effectiveForeignKeys──▶ 实际绘制的边（决策/可见性开关过滤）
        ──buildElements──▶ cytoscape 元素 ＋ React overlay 表卡
        ──updateEdgeEndpoints──▶ 正交折线布线（direct/detour/side-bracket + 车道分配）
```

关键目录：

| 目录 | 职责 | 注意 |
| --- | --- | --- |
| `src/parser/` | 手写 DDL 解析（MySQL/PG/SQLite 公共子集） | 缺口见 roadmap 4.1；`canonicalFkKey` 是全局键空间的根 |
| `src/infer/` | FK 推断 + 逻辑关联聚类 + 模块聚色 + 分表合并 | 逻辑关联**不**自动跑 |
| `src/store/` | Zustand 分片 + persist（denylist 模式）+ 形状校验 | 新持久化字段必须同步 `persistMigrate.ts` |
| `src/diagram/` | 画布：overlay 表卡、布线、选择、自环 overlay、批注气泡 | `DiagramCanvas.tsx` ~1900 行，最大热区 |
| `src/exports/` | SVG/PNG/DDL/评审报告/说明文档，全部纯函数可单测 | 导出跟随画布可见状态 |
| `src/ui/` | 侧栏（推断/逻辑关联/手动连线三平级区块）+ 浮层 | |

**三个最重要的不变量**（破坏会产生隐蔽 bug）：

1. **fkKey 键空间**：`canonicalFkKey` 是 decisions / manualRoutes / 边路由键的统一
   身份。逻辑关联的**键**无向归一但**存储保留绘制方向**；buildGraph 依赖
   "同键冲突计数只由 rawSql 决定"——新增任何 FK 来源都必须先过键冲突守卫
   （`addManualFk` / `validateManualFk` 有现成实现）。
2. **持久化形状**：sessionStorage 每次加载都过 `sanitizePersisted` 逐字段校验；
   加字段要同时改：slice 默认值 + 校验器 + （若有旧格式）升级逻辑 + 测试。
3. **自环不走 cytoscape**：`segments` 曲线画不了 self-loop，`edge:loop` 样式为
   display:none，由 DiagramCanvas 的 SelfLoopLayer（DOM SVG）按 routePoints 绘制。

## 4. 近期完成的大块工作（v0.3.0 之后，未发布）

按时间序，详见 `CHANGELOG.md` [Unreleased] 段：

1. **手动连线**：字段两侧呼吸触点拖线（H-V-H 折线预览、同表同侧 U 预览）、
   连完即所得（落点是 PK/唯一列→物理外键，否则→逻辑关联）、起手侧持久化
   （`drawSide`）、点选/Shift 批选/批量删除、「手动连线」面板批量改类型
   （物理↔逻辑，方向=绘制方向）。
2. **逻辑关联（业务键）**：用户触发的扫描（`logicalKeys` 持久化）、无向点线渲染、
   DDL 中输出 `-- LOGICAL:` 注释、不参与模块聚类、低布局权重。
3. **评审批注**：点字段行弹气泡（记录时间戳）、琥珀圆点标记、右侧「评审建议」
   浮层（最新在前/定位/删除/可折叠）。
4. **导出**：评审报告（决策状态 + 逻辑关联 + 手动连线 + 字段批注含时间 +
   回收站排除）、数据库设计说明文档（标准表结构格式，仅已确认关系）。
5. **布线修复**：detour 端口 stub + 端点卡避让（连线不再贴卡片边框）、
   自环从"画布上不可见"（既有 bug）修为字段行停靠的折线 U 环。
6. **面板重组**：推断的外键 / 逻辑关联 / 手动连线三平级区块，
   各带「隐藏连线/显示连线」整类开关；导出菜单遮挡修复。

## 5. 已知问题与有意延期项

- **[TODO-fix-bugs.zh-CN.md](TODO-fix-bugs.zh-CN.md)**：2 项 P2 布线债务
  （`liveRoute` 双路由器统一、side-bracket 泛化——标注"大改，先截图对比再动"）
  + 7 项 P3 延期（附延期理由）。文档中"174 测试"为旧数字，现为 262。
- **大 schema 无性能防护**：`runPipeline` 全同步，几百表会冻结主线程（roadmap 4.2）。
- **解析缺口**：`ALTER ADD COLUMN` 丢列、PG `COMMENT ON` 丢注释、跨 schema 同名表
  串扰（roadmap 4.1，前两项建议尽早修）。
- **零组件测试/零 E2E**：262 个用例全是纯函数单测；`vite.config.ts` 的 include
  只收 `.test.ts`。本仓库开发时靠 Playwright 手动驱动 preview 验证（未固化进 CI）。
- lint 7 条 warning（style.ts 的 `as any` 惯用写法 ×4、DiagramCanvas 一处
  exhaustive-deps、其余同类）；CI 不因 warning 失败。
- 同表回环固定从 `drawSide` 侧鼓出；若两字段行都被折叠（onlyPk），端点回退到卡中心。

## 6. 开发约定

- **文档同步**：功能性改动同时更新 `CHANGELOG.md`（中文，Keep a Changelog 风格）
  与 `CLAUDE.md`（架构文档，AI 会话与人都读它）。
- **测试**：新纯函数必须带 vitest 单测（node 环境）；样例 `src/samples.ts` 在
  新推断规则/注释路径时应扩展，保证首屏可人工验证。
- **格式化**：`bun run format` 会重排全仓库——只格式化你改的文件。
- **提交**：不要在 commit message 加任何 AI 署名 trailer（仓主全局约定）。
- 新增持久化字段 → 见上文不变量 2 的四件套。

## 7. 从哪里继续

按 [roadmap.md](roadmap.md) 的推荐顺序：**1.1 工作区存档/导入**是下一个最优起点
（工作量小、解决最大的洞、是版本 diff 的前置）。所有 roadmap 条目都标注了
做法要点与依赖，可直接开工。
