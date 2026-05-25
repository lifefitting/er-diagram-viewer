# ER Diagram Viewer

> 把 `CREATE TABLE` / `ALTER TABLE` 脚本贴进浏览器，秒级生成可交互的 ER 图。即使脚本没写 `FOREIGN KEY`，也会按命名 + 类型 + 索引启发式推断外键关系，并允许人工确认。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/lifefitting/er-diagram-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/lifefitting/er-diagram-viewer/actions/workflows/ci.yml)
[![Pages](https://github.com/lifefitting/er-diagram-viewer/actions/workflows/pages.yml/badge.svg)](https://github.com/lifefitting/er-diagram-viewer/actions/workflows/pages.yml)
[![Built with Bun](https://img.shields.io/badge/built%20with-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh)

🌐 **[Live Demo](https://lifefitting.github.io/er-diagram-viewer/app/)** &nbsp;·&nbsp;
📥 **[Download standalone HTML](https://github.com/lifefitting/er-diagram-viewer/releases/latest)** &nbsp;·&nbsp;
📖 **[Landing page](https://lifefitting.github.io/er-diagram-viewer/)** &nbsp;·&nbsp;
🐛 **[Issues](https://github.com/lifefitting/er-diagram-viewer/issues)**

---

## 一句话定位

**专攻"读懂存量 schema"——不是又一个 ER 设计工具。** 评审、onboarding、迁移前评估场景里，常常拿到的就是一份 DDL 脚本，里面 FK 缺胳膊少腿。本工具把这种现实里的脏 DDL 直接吃进去、把推断出来的关系画出来、让你逐条确认，再把补全后的 `ALTER TABLE` 脚本导出回工程仓库。

## 功能一览

- **零后端纯前端**：单页应用，构建产物可静态托管或离线打开；导入的 SQL 不出本地
- **轻量 SQL 解析**：手写词法器，覆盖 MySQL / PostgreSQL / SQLite 的 DDL 公共子集；不支持的语句会显式产出 warning，不再静默丢失
- **隐式 FK 推断**：命名后缀 + 类型一致 + 索引优先 + 复合前缀兜底，分高 / 中 / 低三档置信度，每条都附"推断理由"
- **分片表自动合并**：识别 `orders_0..orders_31` 这类按尾号水平分片的同构表，合并为单一逻辑表，避免推断阶段产生分片之间的噪声边
- **模块自动着色**：按 FK 邻接 + 表名前缀聚类业务模块，四套调色板（鲜艳 / 粉彩 / 大地 / 单色）可切换
- **交互式 ER 图**：Cytoscape 力导向 / 分层布局，节点用 React HTML 覆盖层渲染（表名、注释副标题、PK / Unique / Index / FK 徽标、列类型）
- **表卡片精细控制**：单击折叠到仅 PK 行、右侧把手手动调宽、双击宽度把手还原自动测算
- **三态搜索 / 焦点高亮**：命中（amber ring）/ FK 邻居（正常）/ 其余（淡化），同时匹配表名、列名、表注释、列注释
- **导出**：PNG 图像；含已确认推断 FK 的补全 DDL；SVG 矢量图
- **手动确认**：每条推断 FK 都能在面板上接受 / 拒绝，决策实时反映在图上
- **明暗主题**：跟随系统 / 强制亮色 / 强制暗色
- **按需加载**：Cytoscape (~600 KB) 经 React.lazy + manualChunks 拆出独立 chunk，主 bundle 不被它拖慢首屏

## 三种用法

| 场景 | 怎么用 |
| --- | --- |
| **临时看一眼** | 打开 [Live Demo](https://lifefitting.github.io/er-diagram-viewer/app/)，把 DDL 粘进对话框 |
| **离线 / 内网 / U 盘** | 从 [Releases](https://github.com/lifefitting/er-diagram-viewer/releases/latest) 下载 `er-diagram-viewer.html`，双击即用 |
| **自托管 / 二次开发** | 见下方 [快速启动](#快速启动) |

## 环境要求

- **Bun ≥ 1.1**（`packageManager: bun@1.3.10`；Vite + Vitest 仍是底层工具，Bun 只做包管理与脚本执行）
- 现代浏览器（Chrome / Edge / Safari / Firefox 最新两个大版本）

> CI 与本地脚本统一走 `bun run …`。**不要用裸 `bun test`**——那会触发 Bun 自带的原生测试运行器，跳过 Vitest。

## 快速启动

```bash
# 1. 安装依赖（从 bun.lock 严格还原）
bun install

# 2. 启动开发服务器（带 HMR）
bun run dev
# → http://localhost:5173 （端口被占则自动顺延，留意终端输出）

# 3. 生产构建 + 本地预览（用于交付前的最终验证）
bun run build           # 标准构建 → dist/   （HTTP 部署用）
bun run build:single    # 单文件构建 → dist-single/er-diagram-viewer.html（双击即用）
bun run preview
```

首次打开页面会自动加载内置的电商样例 SQL（[src/samples.ts](src/samples.ts) 中的 `SAMPLE_ECOMMERCE`），可以直接看到效果。

### 两种构建产物

| 产物 | 命令 | 输出 | 适用场景 |
|---|---|---|---|
| **标准** | `bun run build` | `dist/`（多个 chunk + HTML + CSS） | HTTP 部署（GitHub Pages / Vercel / nginx / 内网 / 子路径托管均可） |
| **单文件** | `bun run build:single` | `dist-single/er-diagram-viewer.html`（~900 KB，gzip ~280 KB） | **双击即用、邮件 / U 盘分发、`file://` 离线打开**——零依赖、零服务器 |

单文件模式把所有 JS / CSS / 小图标内联进一个 HTML，代价是失去 Cytoscape 的懒加载（首次解析慢一些），换来"发一个文件就能让对方用"的便利。

> 单文件产物可以直接拷给只想看 schema 的非技术同事，他们无需安装任何东西，浏览器双击就行。

### 其他常用命令

```bash
bun run test                                 # vitest run（一次性）
bun run test:watch                           # watch 模式
bun run typecheck                            # tsc -b --noEmit
bun run lint                                 # eslint src/**/*.{ts,tsx}
bun run format                               # prettier --write

# 单文件 / 单 case：
bunx vitest run src/parser/parser.test.ts
bunx vitest run -t "matches user_id"
```

## 使用流程

1. 顶部点击 **导入 SQL**（或 `⌘/Ctrl + I`），弹窗内粘贴脚本或上传 `.sql` 文件，`⌘/Ctrl + Enter` 解析、`Esc` 关闭。
2. 左侧 **推断的外键** 面板按置信度（高 / 中 / 低）分组列出候选 FK，每条可"接受 / 拒绝"，结果立即反映在画布上。
3. 顶栏 **布局** 切换 `力导向` ↔ `分层`，**搜索** 同时匹配表名、列名以及它们的注释。
4. 左侧 **模块** 面板按业务模块给表分组着色，单击模块名定位画布。
5. 左侧 **字段显示** 控制每个节点显示的密度：是否折叠、是否显示类型、是否显示列注释、是否显示索引徽标。
6. 顶部 **导出** 菜单：
   - `PNG 图像` —— 2 倍清晰度截图
   - `SVG 矢量图` —— 适合后续编辑或打印
   - `含 FK 的 DDL` —— 在原脚本末尾追加 `ALTER TABLE ... ADD CONSTRAINT` 语句（只输出已接受 / 默认显示的推断 FK）
7. 顶栏右侧切换 **主题**（亮色 / 暗色 / 跟随系统）与 **模块配色**。

### 画布交互

- 拖拽节点 → 调整位置
- 拖拽节点右边缘 → 手动调宽（双击该把手还原自动测算宽度）
- 单击节点表头折叠 → 仅显示主键行
- 滚轮 → 缩放（zoom 下限锁在 1.0 以避免文本变糊；可放大不可缩小至 < 1）
- 单击节点 → 高亮该表及其 FK 邻居
- 单击空白 → 取消高亮
- hover 边 → tooltip 显示 FK 详情、置信度、推断理由

## 支持的 SQL 语法

| 语法 | 状态 |
|---|---|
| `CREATE TABLE [IF NOT EXISTS] [schema.]name (...)` | ✅ |
| 反引号 / 双引号 / 方括号包裹的标识符 | ✅ |
| 内联 / 表级 `PRIMARY KEY`、`UNIQUE`、`KEY` / `INDEX` | ✅ |
| 内联 / 表级 `FOREIGN KEY ... REFERENCES` | ✅ |
| 内联列 `REFERENCES table(col)` | ✅ |
| `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` | ✅ |
| `ALTER TABLE ... ADD UNIQUE / INDEX` | ✅ |
| `CREATE [UNIQUE] INDEX ... ON ...` | ✅ |
| MySQL 表级 `COMMENT='...'`、列内联 `COMMENT '...'` | ✅ |
| PostgreSQL `SERIAL` / `BIGSERIAL` 自增检测 | ✅ |
| 字符串（含 `''` 双引号转义）/ 单行 (`--`) / 块 (`/* */`) 注释跳过 | ✅ |
| 多词类型（`DOUBLE PRECISION`、`TIMESTAMP WITH TIME ZONE` 等） | ✅ |
| 分片表合并（`orders_0..orders_N` → `orders`） | ✅ |
| PostgreSQL `COMMENT ON TABLE/COLUMN ... IS '...'` | ⚠️ 暂未解析，但会显式产生 warning |
| `CREATE VIEW / TRIGGER / FUNCTION / PROCEDURE / SEQUENCE / TYPE` | ⚠️ 跳过，但会显式产生 warning |
| `INSERT / SET / GRANT / COMMIT` 等运行时语句 | ⏭️ 静默跳过 |

左下角 / 推断面板顶部的告警条会列出 warning 行号便于排查。

## 状态持久化

- 当前会话的导入 SQL、决策、面板状态保存在 **`sessionStorage`**（key: `er-viewer:state:v1`），刷新页面不会丢，**关闭标签页后清空**。
- 这是有意权衡：导入的 DDL 可能包含真实的生产 schema，落到 `localStorage` 会无限期停留在磁盘上。
- 如果需要跨会话保存，请用导出 DDL / SVG / PNG。
- 详见 [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) 中"持久化加密方案分析"小节。

## 项目结构

```
.
├── index.html                    # SPA 入口（含 SEO meta、JSON-LD、首屏 skeleton）
├── landing/
│   └── index.html                # 产品宣传页（纯内联 CSS，GitHub Pages 根路径）
├── docs/                         # 设计与代码评审文档
│   ├── CANVAS_RENDERING.md       # SQL → 画布全流程拆解 + 优化点
│   ├── CODE_REVIEW.md            # 系统性代码评审与改进路线
│   ├── PRODUCT_INTRO.md          # 产品定位 + 同类对比
│   ├── SQL_PARSER.md             # 解析器规则与边界
│   └── TEST_LAYOUT.md            # 测试组织决策
├── src/
│   ├── App.tsx                   # 顶层 shell（启动副作用 + 布局骨架）
│   ├── main.tsx                  # React 根挂载（StrictMode 故意关闭）
│   ├── samples.ts                # 内置样例 SQL（电商 / 博客）
│   ├── parser/                   # SQL → Schema（手写 lexer + 规则解析）
│   │   ├── tokenize.ts           # 字符串/标识符/注释感知的语句切分
│   │   ├── parseCreateTable.ts   # CREATE TABLE 主体
│   │   ├── parseAlterTable.ts    # ALTER TABLE + CREATE INDEX
│   │   ├── normalizeType.ts      # 类型归一（int/float/string/...）
│   │   ├── utils.ts              # canonicalFkKey / applyIndexFlags 等共享逻辑
│   │   └── index.ts              # 入口：parseSql
│   ├── infer/                    # Schema → InferredFK[] + 模块
│   │   ├── inferForeignKeys.ts   # FK 推断引擎
│   │   ├── nameMatching.ts       # 单/复数 + 前缀归一候选生成
│   │   ├── inferModules.ts       # 模块聚类 + 调色板
│   │   └── mergeShardedTables.ts # 水平分片表合并
│   ├── diagram/                  # Cytoscape 图引擎 + React 覆盖层
│   │   ├── DiagramCanvas.tsx     # 组件骨架 + cy 生命周期
│   │   ├── buildGraph.ts         # Schema → cy elements + 尺寸测算 + measureText 缓存
│   │   ├── style.ts              # cytoscape stylesheet
│   │   ├── cyHandle.ts           # 模块级 cy 句柄（bind/unbind 绑定到 mount 周期）
│   │   ├── layout/               # runLayout + arrangeAroundHubs
│   │   ├── routing/              # 纯函数：computeSegments / computeEndpointOffset
│   │   ├── selection/            # 纯函数：closedNeighborhood + deriveSelection
│   │   └── overlay/              # TableOverlay / TableHeader / ColumnRow
│   ├── store/                    # Zustand 分片
│   │   ├── index.ts              # 装配 + persist 中间件
│   │   ├── schemaSlice.ts        # rawSql / schema / inferred / modules / palette
│   │   ├── decisionsSlice.ts     # 每条 FK 的 accept/reject 决策
│   │   ├── displaySlice.ts       # 字段显示 / 布局 / 搜索 / 主题
│   │   ├── canvasSlice.ts        # 折叠 / 手动宽度 / 闪光定位
│   │   ├── selectors.ts          # effectiveForeignKeys 等纯派生
│   │   └── pipeline.ts           # parseSql → mergeSharded → inferFK → inferModules
│   ├── ui/                       # 按"画布上方浮层 / 左侧控制面板"两层组织
│   │   ├── overlays/             # 画布上方的浮层 UI
│   │   ├── sidebar/              # 左侧控制面板
│   │   └── theme/                # 主题切换 hook
│   └── exports/
│       ├── toDdl.ts              # InferredFK → ALTER TABLE DDL
│       └── toSvg.ts              # 画布 → SVG 字符串
└── .github/workflows/
    ├── ci.yml                    # PR + main：typecheck / lint / test / build
    └── pages.yml                 # main 推送：构建 SPA + 拷 landing → 部署 Pages
```

技术栈：**Vite 7 + React 18 + TypeScript 5 + Tailwind 3 + Cytoscape.js 3** (`cytoscape-fcose` 力导向、`cytoscape-dagre` 分层) **+ Zustand 4**。Vitest 3 单元测试。生产构建按 chunk 切分：

| chunk | 大小（gzip） | 加载时机 |
|---|---|---|
| `index` (app) | ~30 KB | 首屏 |
| `react-vendor` | ~46 KB | 首屏（与 app 并行下载） |
| `cytoscape` | ~210 KB | 首次有 schema 渲染时按需加载 |
| `DiagramCanvas` | ~6 KB | 同上 |

## 测试

```bash
bun run test
```

当前 68 个 vitest 单测分布：

| 模块 | 覆盖点 |
|---|---|
| `parser/tokenize.test.ts` | 字符串 / 注释 / `''` 双引号转义、嵌套括号匹配 |
| `parser/parser.test.ts` | CREATE/ALTER/CREATE INDEX 解析、多词类型、未支持语句的 warning |
| `parser/utils.test.ts` | `canonicalFkKey`、`splitQualified`、`applyIndexFlags` |
| `infer/infer.test.ts` | 命名+类型+索引启发式、置信度档位 |
| `infer/inferModules.test.ts` | 模块聚类与调色板分配 |
| `infer/mergeShardedTables.test.ts` | 分片识别（数字尾号 / 哈希 / hex） + FK 重写 |
| `diagram/routing/computeSegments.test.ts` | H-V-H 折线数学 |
| `diagram/routing/computeEndpointOffset.test.ts` | 端点坐标计算 |
| `diagram/selection/closedNeighborhood.test.ts` | FK 闭邻域 |

改解析、推断或路由规则时请同步加 / 改测试。UI 组件层目前**没有**自动化测试，端到端依赖人工跑 `bun run preview` 验证。

测试组织方式（与源代码 colocate）与未来扩展规则见 [docs/TEST_LAYOUT.md](docs/TEST_LAYOUT.md)。

## 部署

仓库已配置两条 GitHub Actions：

- **`ci.yml`** — PR 与 main 推送时跑 typecheck / lint / test / build，验证可发布性。
- **`pages.yml`** — main 推送时把 `landing/` 部署到 Pages 根，把 `dist/`（SPA 构建产物）部署到 `/app/`。

首次启用 Pages：仓库 **Settings → Pages → Source 选 "GitHub Actions"**，然后随便 push 一次 main 触发 workflow。

部署完成后：
- 🌐 SPA：`https://lifefitting.github.io/er-diagram-viewer/app/`
- 📖 Landing：`https://lifefitting.github.io/er-diagram-viewer/`

## 文档

| 文档 | 主题 |
| --- | --- |
| [docs/PRODUCT_INTRO.md](docs/PRODUCT_INTRO.md) | 产品定位、目标用户、与同类工具对比 |
| [docs/SQL_PARSER.md](docs/SQL_PARSER.md) | 解析器规则、支持/不支持的语法边界 |
| [docs/CANVAS_RENDERING.md](docs/CANVAS_RENDERING.md) | SQL → 画布完整管线 + 优化点清单 |
| [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) | 系统性代码评审与改进路线 |
| [docs/TEST_LAYOUT.md](docs/TEST_LAYOUT.md) | 测试组织决策依据（与 src colocate） |
| [CLAUDE.md](CLAUDE.md) | 协作约定、踩坑记录、设计权衡 |

## 已知限制 / 后续

- PG `COMMENT ON` 解析（有 warning，但不进入 schema）
- 复合主键 / 复合外键：解析层支持，但推断引擎只处理单列主键的目标表
- UI 层零测试（Toolbar、Sidebar、Dialog 都没单测，重构这些区块时只靠 typecheck 兜底）
- 表数量 > 200 时 fcose 初次布局耗时 5-10s

详细的代码评审与改进路线图参见 [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md)；架构细节、踩坑记录与设计权衡参见 [CLAUDE.md](CLAUDE.md)。

## 协议

[MIT](LICENSE) © 2026 lifefitting
