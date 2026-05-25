# 测试代码布局：决策与依据

> 一句话结论：本 repo 已采用的 **colocation（测试与源同目录）** 是管理与维护成本最低的方案。本文是这一选择的论证与未来扩展规则，避免后续因"看上去乱"反复折腾结构。

---

## 1. 背景

直觉上把 `*.test.ts` 与生产代码混在一个目录里"看上去比较混乱"。本文用六个量化维度对比业界三种主流测试组织方式，回答两个问题：

1. 哪种布局**管理成本**最低？
2. 哪种布局**维护成本**最低（重构、重命名、import 同步）？

答案：A（colocation）。劣势仅是"目录列表噪声"，并且在本 repo 不痛——下文给出数据证据。

---

## 2. 现状摘要

测试文件 9 个，全部 colocated：

| 目录 | 测试文件 |
| --- | --- |
| `src/parser/` | `parser.test.ts` · `tokenize.test.ts` · `utils.test.ts` |
| `src/infer/` | `infer.test.ts` · `inferModules.test.ts` · `mergeShardedTables.test.ts` |
| `src/diagram/routing/` | `computeEndpointOffset.test.ts` · `computeSegments.test.ts` |
| `src/diagram/selection/` | `closedNeighborhood.test.ts` |

性质统一：

- 全部为**纯逻辑单元测试**——DDL 解析、FK 推断、模块/分片合并、折线数学、选区集合运算。
- 无 React 组件测试、无 DOM 集成测试、无 e2e。
- import 形态一致：`import { x } from './x'`（兄弟相对路径），少数跨模块用 `from '../parser'`。

构建/工具链：

- `vite.config.ts` test glob：`src/**/*.test.ts`（一行配置）。
- `tsconfig.json` 包含整个 `src/`，`types: ['vitest/globals']`。
- 生产构建（`vite build` / `bun run build:single`）**不会**把 `.test.ts` 打进 bundle——Vite 只打包从 `index.html` 入口可达的模块图，测试文件没人 import，自然被剪掉。

---

## 3. 评估维度

下面六个维度覆盖了"管理 + 维护"成本的所有日常触发点。每项给出 1（最好）到 4（最差）的成本分。

| 维度 | 解释 | 谁会感觉到 |
| --- | --- | --- |
| 1. 发现成本 | "我改了 `foo.ts`，它的测试在哪？" | 每次写代码 |
| 2. 重命名/移动同步 | 重命名/移动一个源文件，测试要跟着改几步 | 重构时 |
| 3. import 路径稳定性 | 测试 import 语句长不长、改了源结构会不会大面积失效 | 重构时 |
| 4. 目录列表噪声 | `ls` 一个目录，prod 文件能不能一眼扫到 | 浏览代码时 |
| 5. vitest/tsconfig 配置复杂度 | 工具需要多少行 include/exclude、是否要拆 tsconfig | 工具升级、加测试类型时 |
| 6. Vite/Vitest 生态主流度 | 新人是否一眼看懂、有没有官方/社区共识 | 协作、Onboarding |

---

## 4. 三种主流布局详解

### A. Colocation — 测试与源同目录（**现状**）

`src/parser/` 在本方案下的样子：

```
src/parser/
  index.ts
  normalizeType.ts
  parseAlterTable.ts
  parseCreateTable.ts
  tokenize.ts
  tokenize.test.ts
  types.ts
  utils.ts
  utils.test.ts
  parser.test.ts
```

import：

```ts
// src/parser/parser.test.ts
import { parseSql } from './index';
```

重构示例：把 `parseAlterTable.ts` 重命名为 `parseAlter.ts`：

1. IDE rename `parseAlterTable.ts` → 自动重写所有引用。
2. 没有第二步。`parseAlterTable.test.ts`（如果存在）会跟着同目录的同名前缀一起被人工感知/重命名。

优势：

- import 最短，最稳定。
- 改一处就只在一个目录内动，git diff 局部化。
- IDE / `Cmd-T` 文件名跳转一次到位（`foo` / `foo.test` 都在搜索结果第一屏）。
- Vitest / Vite 官方示例的默认形态，无须额外约定。

劣势：

- `ls` 列表里 prod 与 test 混排。本 repo 叶子目录文件数 ≤ 7（见下文数据），扫描完全无压力。

### B. `__tests__` 子目录 — 每个叶子目录下一个 `__tests__/`

`src/parser/` 在本方案下：

```
src/parser/
  __tests__/
    parser.test.ts
    tokenize.test.ts
    utils.test.ts
  index.ts
  normalizeType.ts
  parseAlterTable.ts
  parseCreateTable.ts
  tokenize.ts
  types.ts
  utils.ts
```

import：

```ts
// src/parser/__tests__/parser.test.ts
import { parseSql } from '../index';
```

重构示例：重命名 `parseAlterTable.ts` → `parseAlter.ts`：

1. IDE rename `parseAlterTable.ts`。
2. 如果存在 `__tests__/parseAlterTable.test.ts`，需要**手动**改名为 `parseAlter.test.ts`——IDE 不会因为前缀一致就联动两个不同目录下的同名前缀文件。

优势：

- prod 目录干净，`ls src/parser/` 只看到 8 个生产文件。
- 沿袭 Jest 时代的传统约定，老 React 工程师熟悉。

劣势：

- import 路径多一层（`../foo`），重命名父目录时所有测试 import 一起失效。
- 测试与源不再同名前缀配对，refactor 时容易遗漏。
- Vitest 时代社区共识在向 colocation 迁移，新仓库越来越少这么做。

### C. 顶层 `tests/` 镜像 src/ 结构

```
src/
  parser/
    index.ts
    ...
tests/
  parser/
    parser.test.ts
    tokenize.test.ts
    utils.test.ts
  infer/
    ...
```

import：

```ts
// tests/parser/parser.test.ts
import { parseSql } from '../../src/parser/index';
```

重构示例：重命名 `src/parser/parseAlterTable.ts` → `parseAlter.ts`：

1. IDE rename `src/parser/parseAlterTable.ts`。
2. 手动检查并重命名 `tests/parser/parseAlterTable.test.ts`。
3. 检查 `tests/` 内是否还有其他文件硬编码 `../../src/parser/parseAlterTable` 这条路径——很容易忘。

优势：

- 物理隔离最彻底，CI 里"只跑测试"或"打包时排除测试"非常清晰。
- Library 发包（`prepublish`）场景下天然友好。
- 加 e2e / 集成 / 性能 / 视觉回归等多种测试类型时，`tests/{unit,integration,e2e,perf}/` 一目了然。

劣势：

- 双树同步——每次新增、移动、改名都要跨两个目录操作。
- import 路径冗长、跨越 `src/` 边界，重构最脆。
- Java/Angular 风格，在 React/Vite 生态属于少数派。
- 通常要再拆一个 `tsconfig.test.json`，否则严格 import 检查会管到测试代码不该管的范围。

---

## 5. 对比表与加权小结

| 维度 | A. Colocation | B. `__tests__` | C. 顶层 `tests/` |
| --- | --- | --- | --- |
| 1. 发现成本 | **1** 同目录、同名前缀 | 2 下钻一层 | 4 完全另一棵树 |
| 2. 重命名/移动同步 | **1** mv 一次 IDE 联动 | 2 prod 与 test 分别 rename | 4 两棵树同步 |
| 3. import 路径稳定性 | **1** `./foo`（最短） | 2 `../foo` | 4 `../../src/parser/index` |
| 4. 目录列表噪声 | 3 prod/test 交错 | **1** prod 目录干净 | **1** prod 目录最干净 |
| 5. vitest/tsconfig 配置复杂度 | **1** 一行 include | **1** 一行 include | 2 通常需独立 tsconfig.test.json |
| 6. Vite/Vitest 生态主流度 | **1** 官方示例默认 | 2 Jest 时代遗产 | 3 Java/Angular 风格 |
| **合计** | **8** | 9 | 18 |

**A 唯一明显劣势在维度 4，但在本 repo 不痛**。证据：

| 目录 | prod 文件 | test 文件 | 合计 |
| --- | --- | --- | --- |
| `src/parser/` | 7 | 3 | 10 |
| `src/infer/` | 4 | 3 | 7 |
| `src/diagram/routing/` | 3 | 2 | 5 |
| `src/diagram/selection/` | 2 | 1 | 3 |

每个叶子目录都在 10 个文件以内，prod / test 名字前缀完全配对（`foo.ts` ↔ `foo.test.ts`），`ls` 扫描成本极低。而 B、C 在维度 1/2/3 上的成本是**每次重构都付一次**，长期累积更高。

---

## 6. 推荐方案与未来扩展规则

**保持 colocation（A）不动**。同时确立以下分层约定，新增测试时按类型选位置，避免单一目录被各种粒度测试塞爆：

| 测试类型 | 位置 | 何时使用 |
| --- | --- | --- |
| **纯逻辑 / 纯函数单元** | 与源同目录 `foo.test.ts` | 默认。本 repo 现有 9 个测试均属此类。 |
| **跨模块集成** | 未来 `tests/integration/` | 涉及多模块协作或难以单元覆盖的不变量。<br>例：DOM 高度 == `tableBoxSize` 算出高度的回归测试。 |
| **Playwright e2e** | 未来 `tests/e2e/` | 走完整页面（开 dev server / preview，操作 DOM）。 |
| **测试夹具 / 样例 SQL** | 当前由 `src/samples.ts` 兼任 | 当夹具明显是"仅测试用"且与 prod 解耦后，再迁 `tests/fixtures/`。 |

`tests/` 与 colocation 完全可以共存：vitest glob 改成 `['src/**/*.test.ts', 'tests/**/*.test.ts']` 即可，配置代价极小。

---

## 7. 业界参考（截至 2026 年）

- **Vitest 官方示例 / Vite 模板**：colocation。
- **React、Tanstack、shadcn/ui、tRPC、Zustand 等主流仓库**：以 colocation 为主，少量保留 `__tests__/`。
- **Next.js**：colocation 普遍；旧仓库残留 `__tests__/`。
- **Angular / Nest**：传统上分离 `tests/`；与 React/Vite 生态文化不同。
- **库（library）发包项目**：偶尔用 `tests/` 物理隔离，方便 `files` 字段过滤；应用（app）项目几乎不需要。

Jest 时代的 `__tests__/` 约定主要服务于 Jest 早期的 testRegex 默认值。Vitest 用更宽松的 glob 与 include/exclude，对 `__tests__/` 没有任何偏好，这条约定在新仓库里逐步退潮。

---

## 8. 何时需要重新评估

下面任一情况触发时再重开讨论，否则别动：

- 加入 React 组件测试后，**单目录中 `.test.tsx` 数量 > 30** 且与 prod 文件交错产生明显视觉噪声 → 评估迁 B（`__tests__/`）。
- 测试代码量 > 源代码量、CI 流水线想物理隔离测试目录单独缓存 / 跑 → 评估 C 的部分迁移。
- 项目从 app 转向以 npm 包发布的 library，`files` 字段需要 `prepublish` 排除测试 → 评估 C。
- 团队新成员强烈反馈"找不到测试在哪"——但本约定（同名前缀）应该极难触发这一点。

---

## 9. 实用提示

- `Cmd-T` / `Ctrl-P` 输入 `foo` 即可同时看到 `foo.ts` 与 `foo.test.ts`，是 colocation 最自然的导航方式。
- 想"只看 prod 文件"，IDE 的 file-explorer 通常支持隐藏 glob `*.test.*`；命令行用 `ls | grep -v test`。
- 跨模块 import 测试（如 `infer.test.ts` 里 `from '../parser'`）是合理的——表明这是接近集成的测试，但目前规模还不足以独立到 `tests/integration/`，留在源附近即可。
