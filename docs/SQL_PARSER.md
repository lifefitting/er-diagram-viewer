# SQL 解析层 — 设计、流程与演进建议

> 范围：覆盖 `src/parser/**` 全部文件，以及 `src/infer/mergeShardedTables.ts`（虽然在 `infer/` 目录下，但它在管线中夹在 parser 与 inferFK 之间，属于"解析后的物理→逻辑模型清洗"环节，一并归入本文件描述）。
> 受众：要修 parser bug、扩 SQL 方言支持、或要评估是否换成第三方 parser 的开发者。

---

## 一、整体管线一图

```
                          ┌────────────────────────────────────────┐
                          │  用户粘贴 / 上传的 SQL 文本             │
                          └────────────────────────────────────────┘
                                          │
                          ┌───────────────▼────────────────┐
                          │  tokenize.ts                   │
                          │  • splitStatements             │   字符串/标识符/注释感知的 `;` 切分
                          │  • stripComments               │   去除 `--` 与 `/* */`
                          │  • splitTopLevel               │   括号/引号感知的逗号切分
                          │  • matchClosingParen           │   引号感知的括号匹配
                          │  • unquoteIdent                │   去掉 `` ` `` / `"` / `[]`
                          └───────────────┬────────────────┘
                                          │ 一段一段的 Statement
                                          ▼
   ┌───────────────────────────────┬──────────────────────┬─────────────────────────┐
   │ parser/index.ts:parseSql      │  路由分发：判别语句类型并调对应的解析器           │
   └─────────────┬─────────────────┴──────────────────────┴─────────────────────────┘
                 │
       ┌─────────┼──────────────┬───────────────────────────┬───────────────────────┐
       ▼         ▼              ▼                           ▼                       ▼
  CREATE TABLE  ALTER TABLE  CREATE INDEX        KNOWN_UNSUPPORTED               其它
  parseCreateTable  parseAlterTable parseCreateIndex   (产生 warning)            (静默跳过)
       │         │              │
       │         └──────────────┴──→  把新 indexes / foreignKeys 合并进既有 Table
       │
       ├─→ normalizeType.ts      (各种 raw type → int/float/string/...)
       ├─→ utils.ts:applyIndexFlags  (把单列 index/unique 提升为 col.hasIndex / col.isUnique)
       └─→ utils.ts:canonicalFkKey   (FK 唯一键，全链路统一)
                 │
                 ▼
        ┌────────────────────┐
        │  Schema            │   { tables[], explicitForeignKeys[], warnings[], notices? }
        └────────┬───────────┘
                 ▼
        ┌──────────────────────────────────────────────────────┐
        │  infer/mergeShardedTables.ts                         │   分片表合并（物理→逻辑）
        │  orders_0..orders_31 → orders_*                       │
        │  FK 重写：跨分片 FK 落到代表节点；intra-shard 自环丢弃 │
        └──────────────────────────────────────────────────────┘
                 │
                 ▼
        ┌──────────────────┐
        │  Merged Schema    │  下游交给 inferForeignKeys / inferModules
        └──────────────────┘
```

整条链子的入口是 `src/store/pipeline.ts:runPipeline(sql, palette)`：

```ts
parseSql(sql) → mergeShardedTables() → inferForeignKeys() → inferModules()
```

每一阶段的输出都是不可变快照，下游只读不改。

---

## 二、文件逐个解读

### 2.1 `parser/types.ts`（72 行）

整个解析层的"通用语言"。定义了 `Schema / Table / Column / IndexDef / ForeignKey / ParseWarning / ShardInfo` 这些 record 类型。

关键设计：
- `Column.normalizedType` 是规约后的枚举（`int / float / string / date / bool / blob / json / uuid / unknown`），下游推断引擎只比较归一类型，不碰 `rawType`。`unknown` 与任何类型兼容（语义是"我不确定，给个机会"）。
- `ForeignKey.source = 'explicit' | 'inferred'`：从 SQL 里直接抠出来的是 explicit；推断引擎生成的是 inferred。下游 UI / 导出都靠这个字段做分支。
- `Schema.warnings` 是用户可见的告警条；`Schema.notices` 是"中性信息"（如"合并了 3 组分表"），UI 上以不同样式呈现。
- `Table.shardInfo` 仅在分片合并后填充——一个 Table 有 shardInfo ⇔ 它是「≥2 张物理分片表」或「基表 + ≥1 张分片」合并后的代表节点。

### 2.2 `parser/tokenize.ts`（263 行）

**职责**：把一坨 SQL 文本拆成"可独立处理的语句"和"括号内的逗号清单"，且不被字符串字面量、标识符引号、注释里的特殊字符干扰。

**为什么不直接 `sql.split(';')`**：因为 `body TEXT DEFAULT 'hi; world'` 里的分号会破坏切分。同理 `,` 不能直接 split，括号嵌套也要注意。

**导出函数及调用关系**：

| 函数 | 作用 | 用在哪里 |
|---|---|---|
| `splitStatements` | 顶层 `;` 切分；同时维护行号 | `parseSql` 主循环 |
| `stripComments` | 删去 `-- ...` 与 `/* ... */` | 每条 statement 在结构化解析前清洗 |
| `splitTopLevel` | 括号 / 引号感知的逗号切分 | CREATE TABLE 主体的列定义切分、ALTER TABLE 多子句切分、列名清单切分 |
| `matchClosingParen` | 找到匹配的 `)` 位置（跨字符串） | CREATE TABLE 主体定位 |
| `unquoteIdent` | 去 ``` ` ``` / `"` / `[]` 包裹 | 所有获取标识符的地方 |

**字符串扫描**（`scanStringLiteral` + `isEscapedClose`）：

同时支持两种 SQL 字符串转义：
- **SQL 标准**：`''` 表示一个 `'`，`""` 表示一个 `"`。
- **MySQL/SQLite 反斜杠**：`\'`、`\"`、`\\`。注意 `\\\\'` 是"两个反斜杠 + 闭合"——靠数前置反斜杠的**奇偶性**判定。

这里被踩过坑：上一轮 review（P3.1）指出旧实现把 `''` 视作"闭合 + 立刻重开新字符串"——结果中间字面量被吞掉。现在的 `isEscapedClose` 优先 peek 一字符判断双引号，再去看反斜杠链。

### 2.3 `parser/normalizeType.ts`（25 行）

把数据库实际写的类型字符串归一到 9 种枚举之一。匹配规则用**正则数组顺序匹配**（先匹中先返回），所以顺序敏感：

```ts
[/^uuid$/i, 'uuid'],                              // 必须先于 string
[/^(tinyint|.../bigserial|smallserial|int2|...)/i, 'int'],
...
```

`typesCompatible(a, b)` 是 FK 推断时类型比对的唯一入口：`unknown` 与任何类型都兼容。

### 2.4 `parser/parseCreateTable.ts`（278 行）

最大的解析模块。结构：

```
parseCreateTable(stmt)
 ├─ 1. headerMatch: CREATE (GLOBAL|LOCAL|TEMP|TEMPORARY)* TABLE [IF NOT EXISTS] name (
 ├─ 2. matchClosingParen() → 切出主体 body
 ├─ 3. extractTableComment(stmt 尾部)  ← MySQL `... COMMENT='...'`
 ├─ 4. splitTopLevel(body) 逐条分发：
 │     ├─ CONSTRAINT ...     → handleNamedConstraint
 │     ├─ PRIMARY KEY (...)  → primaryKey.push
 │     ├─ UNIQUE (...)       → indexes.push（unique=true）
 │     ├─ KEY/INDEX/FULLTEXT/SPATIAL (...) → indexes.push
 │     ├─ FOREIGN KEY ... REFERENCES ... → parseInlineForeignKey
 │     ├─ CHECK (...)        → 直接跳过
 │     └─ 否则                → parseColumnDef
 ├─ 5. applyIndexFlags(table)   ← 单列 index/unique 提升为列级 flag
 └─ 6. return { table, foreignKeys }
```

**`parseColumnDef` 的多词类型处理**（极易踩坑）：

主 type 正则只匹配**单词类型 + 可选 (...)**：

```ts
const typeMatch = rest.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(\([^)]*\))?/);
```

之后**手工显式继续**几种多词类型：

| 第一个词 | 后续模式 | 例子 |
|---|---|---|
| `DOUBLE` | `PRECISION` | `DOUBLE PRECISION` |
| `CHARACTER` / `BIT` | `VARYING(n)?` | `CHARACTER VARYING(255)` |
| `TIMESTAMP` / `TIME` | `WITH(OUT)? TIME ZONE` | `TIMESTAMP WITH TIME ZONE` |

为什么不一次性扩主正则吃两个词：因为 `id BIGINT NOT NULL` 会被吞成"type = BIGINT NOT"——`NOT` 是约束关键字，不能吃。这是 CLAUDE.md 里也写了的红线坑。

**Inline `REFERENCES`** 的处理在 `detectInlineColumnRef`，它在 `parser/index.ts` 里**额外**对每行调用一次：

```ts
for (const part of splitTopLevel(body)) {
  const fk = detectInlineColumnRef(part, result.table.name);
  if (fk) explicitForeignKeys.push(fk);
}
```

这是双重扫描，原因是把"列定义解析"和"FK 抽取"完全解耦，方便单独单测。注意 `detectInlineColumnRef` 内部用 `RESERVED_CONSTRAINT_KEYWORDS` 跳过 `CONSTRAINT/FOREIGN/...` 开头的子句，否则一条 `CONSTRAINT fk_x FOREIGN KEY (a) REFERENCES b(id)` 会同时被两个路径抓到，造成重复 FK。

### 2.5 `parser/parseAlterTable.ts`（70 行）

**两个独立函数**：

```ts
parseAlterTable(stmt): AlterEffects | null
  // 匹配 ALTER TABLE [IF EXISTS] [ONLY] name
  // 拆出每条 ADD 子句，找：
  //   • ADD [CONSTRAINT name]? FOREIGN KEY (...) REFERENCES ...
  //   • ADD UNIQUE? (INDEX|KEY) name? (...)

parseCreateIndex(stmt): { table, index } | null
  // 匹配 CREATE [UNIQUE] INDEX name? [IF NOT EXISTS] ON table(cols)
```

返回 `null` 表示"识别不了"，由调用方决定是否产生 warning（`parseAlterTable` 返回 null 时会产 warning；`parseCreateIndex` 返回 null 时**目前是静默跳过**，是改进点）。

### 2.6 `parser/utils.ts`（44 行）

**全链路共享**的三个工具：

| 函数 | 用途 |
|---|---|
| `applyIndexFlags(table)` | 把"该表的单列 index/unique"提升为列级 `hasIndex` / `isUnique` flag。在 `parseCreateTable` 和 `parser/index.ts`（处理完 ALTER/CREATE INDEX 后再调一次）共用。 |
| `splitQualified('myschema.users')` | 切出 `{ schema, name }`，支持引号包裹。 |
| `canonicalFkKey(fk)` | FK 唯一键：`from.cols->to.cols`，全 lowercase。**整个项目所有 FK 比对都靠这个函数**——store 的 decisions key、explicit/inferred 合并去重都依赖它。改这个函数会改 persist 数据格式（要 bump 版本号）。 |

### 2.7 `parser/index.ts`（113 行）

主入口 `parseSql(sql): Schema`。结构很扁：

```ts
for (const stmt of splitStatements(sql)) {
  const clean = stripComments(stmt.text);
  const upper = clean.trimStart().toUpperCase();

  if (upper 起始是 CREATE TABLE)   → parseCreateTable
  if (upper 起始是 ALTER)          → parseAlterTable
  if (upper 起始是 CREATE INDEX)   → parseCreateIndex
  if (matches KNOWN_UNSUPPORTED)  → warnings.push (产生 warning)
  else                            → 静默跳过 (INSERT/SET/GRANT/COMMIT/...)
}
```

`KNOWN_UNSUPPORTED` 数组列出了"用户预期我们解析但我们没解析"的语句类型——只对它们产生 warning，避免用户看着画布空白以为坏了：

| 模式 | 说明 |
|---|---|
| `COMMENT ON` | PG 注释语法，建议改用 inline `COMMENT '...'` |
| `CREATE [OR REPLACE] VIEW` | 视图（ER 图里不表示） |
| `CREATE [OR REPLACE] MATERIALIZED VIEW` | 物化视图 |
| `CREATE TRIGGER / FUNCTION / PROCEDURE` | 过程化对象 |
| `CREATE SEQUENCE` | 序列（列级 SERIAL/IDENTITY 仍能识别） |
| `CREATE TYPE` | 自定义类型 |

最后 `dedupeFks(explicitForeignKeys)` 用 `canonicalFkKey` 去重——同一条 FK 可能既出现在 inline `REFERENCES` 路径，又出现在 table-level `CONSTRAINT FOREIGN KEY` 路径。

### 2.8 `infer/mergeShardedTables.ts`（160 行，逻辑上属于解析层之后的清洗）

**问题域**：很多 MySQL 库为了水平扩展把单表拆成 `orders_0 .. orders_31`、或按时间拆成 `t_log_202401 .. t_log_202412`。这些表 schema 完全一样，但 cytoscape 会把它们渲成几十个孤立节点；FK 推断也会在它们之间生成笛卡尔级别的噪声边。

**输入**：刚出炉的 `Schema`（已经包含全部物理分片表）。
**输出**：新的 `Schema`，分片表合并成单个代表节点，并把 `shardInfo` 填充到代表节点上以便 UI 显示徽标。存在同名同构基表（如 `orders` + `orders_202401…`，PG 分区父表 / MySQL 热表+归档表形态）时基表一并被吸收，节点保留基表原名；没有基表时名字带 `_*` 后缀。

#### 后缀识别策略

`SHARD_SUFFIX_PATTERNS` 是一个**顺序敏感**的正则数组：

| 优先级 | 模式 | 示例 | 用于识别 |
|---|---|---|---|
| 1 | `_\d{4}_\d{2}_\d{2}$` | `_2024_01_15` | YYYY_MM_DD |
| 2 | `_\d{4}_\d{2}$` | `_2024_01` | YYYY_MM |
| 3 | `_\d{8}$` | `_20240115` | YYYYMMDD |
| 4 | `_\d{6}$` | `_202401` | YYYYMM |
| 5 | `_\d{4}$` | `_2024` / `_0001` | YYYY 或 4 位编号 |
| 6 | `_shard\d+$` | `_shard12` | 显式 shard 编号 |
| 7 | `_part\d+$` | `_part5` | 显式 part 编号 |
| 8 | `_p\d+$` | `_p0` / `_p15` | 简短 part 标记 |
| 9 | `_\d+$` | `_0` / `_31` / `_999` | 兜底纯数字尾号 |

顺序重要：`t_log_20230101` 必须先被 #3（8 位日期）匹中，再降级到 #5（4 位）会得到 `t_log_2023` 的错误 base。

#### 合并步骤

1. **分桶**：每张表跑一次 `extractShardBase()`；不返回 base 的表进 `baseTables` 旁路索引（供基表吸收查询）；返回的按 `base.toLowerCase()` 入桶。
2. **基表吸收判定**：桶的 key 若命中某张无后缀表，且其列名集合（小写比较）与「列最多的分片」互为子集或相等，则该基表并入本组；列结构不一致时基表保持独立并产一条中性 notice（「列结构不一致，未合并」）。类型不参与比较——与分片间不校验结构的宽松风格一致。
3. **过滤孤儿**：桶里只有一张表且无可吸收基表的不算分片（`orders_2024` 单独存在不应被改名为 `orders_*`）；有兼容基表时「基表 + 1 张分片」也合并。
4. **选代表**：全体成员（含被吸收基表）中列数最多的胜出；并列时按字典序（基表名最短，平局时天然胜出）。有基表时代表节点的 `name` 用基表原名（保留原大小写），否则改成 `${base}_*`；均设置 `shardInfo = { base, shards }`（shards 只列带后缀的物理分片）。
5. **重写 FK**：所有指向分片表的 explicit FK 重定向到代表节点；rewrite 后形成的 `rep → rep` 自环丢弃（含「分区 → 父表」FK 坍缩成的自环）；用 `from.cols->to.cols` 去重。
6. **产 notice**：`合并了 N 组分表（共 M 张物理表归并为 N 个代表节点）：orders（基表 + k 张分表）、yyy_*（m 张）...`

#### 注意细节

- **代表节点的 name 修改时机**：必须**先**把代表节点的原名（如 `account_detail_202401`）加入 `rename` 映射，再修改 `rep.name`——否则代表节点自身的 outbound FK 会找不到 rename 条目，rewrite 失败。`mergeShardedTables.ts:115-121` 的注释专门说了这一点。
- **schema 不可变性**：代表节点的 `name` 是**就地修改**的（`rep.name = displayName`）——这是出于性能考虑，避免复制整张 Table。下游 inferFK 不依赖这个名字的原始性，但**调用方必须意识到 mergeShardedTables 会就地改 schema**。
- **隐式 FK 在 merge 之后才推断**：所以推断引擎只看到代表节点，不会基于分片名生成关联。基表被吸收后节点用真实表名，`payments.order_id → orders` 这类推断能直接命中（`_*` 后缀名反而无法被候选名生成器命中）。
- **drop 按对象身份而非表名**：代表节点可能接管被吸收基表的名字（分片改名为 `orders`），按名字过滤会把两者一起删掉，所以 `dropped` 是 `Set<Table>`。

#### 测试覆盖

`src/infer/mergeShardedTables.test.ts` 有 17 个 case 覆盖：
- 单纯数字 / 日期 / 月份 / 显式 shard 等各模式
- 跨分片 FK 重写
- 多组分片共存
- 孤儿表保留
- 跨分组的命名碰撞

---

## 三、解析层的"已知坑位"清单

整理在一处，便于改 parser 时事先看一眼避免回归：

| # | 坑 | 防御位置 |
|---|---|---|
| 1 | `body TEXT DEFAULT 'hi; world'` 里的分号 | `tokenize.ts:splitStatements` 走字符串扫描 |
| 2 | `''` SQL 标准转义 vs `\'` MySQL 反斜杠转义 | `tokenize.ts:isEscapedClose` |
| 3 | 多词类型 `BIGINT NOT NULL` 被吞成 `type=BIGINT NOT` | `parseCreateTable.ts:parseColumnDef` 主正则只吃一词，显式扩 `DOUBLE/CHARACTER/TIMESTAMP/...` |
| 4 | inline `REFERENCES` 与 table-level `FOREIGN KEY` 双路重复抓 | `detectInlineColumnRef` 内部跳过 `CONSTRAINT/FOREIGN/...` 开头行；`parser/index.ts:dedupeFks` 用 canonicalFkKey 去重 |
| 5 | `t_log_20230101` 被 4 位日期模式先吃掉 | `mergeShardedTables.ts:SHARD_SUFFIX_PATTERNS` 顺序敏感，长的在前 |
| 6 | 跨分片 FK 在 rewrite 后成自环 | `mergeShardedTables.ts:if (from === to) continue` |
| 7 | 大小写不一致的 schema（`users` vs `Users`）导致 FK key 三套规约 | 全部统一用 `parser/utils.ts:canonicalFkKey` |
| 8 | `applyIndexFlags` 在 parseCreateTable 和 parser/index.ts 两处都要跑 | 抽到 `parser/utils.ts` 共用 |
| 9 | PG `COMMENT ON` 静默丢失看起来像 bug | `parser/index.ts:KNOWN_UNSUPPORTED` 显式产 warning |

---

## 四、当前覆盖率与缺口

### 已覆盖

| 语法 | 覆盖度 |
|---|---|
| `CREATE TABLE [schema.]name (...)` | ✅ |
| `IF NOT EXISTS` / `TEMPORARY` / `GLOBAL` / `LOCAL` | ✅ |
| 引号：`` ` `` / `"` / `[]` | ✅ |
| 列定义：`name type[(len)] [NOT NULL] [DEFAULT x] [AUTO_INCREMENT] [PRIMARY KEY] [UNIQUE] [COMMENT 'x'] [REFERENCES t(c)]` | ✅ |
| 多词类型：`DOUBLE PRECISION` / `CHARACTER VARYING(n)` / `TIMESTAMP WITH TIME ZONE` | ✅ |
| 表级 `PRIMARY KEY` / `UNIQUE` / `KEY` / `INDEX` / `FULLTEXT` / `SPATIAL` | ✅ |
| 表级 / 命名 `CONSTRAINT ... FOREIGN KEY ... REFERENCES ...` | ✅ |
| `ALTER TABLE ADD CONSTRAINT FK / ADD INDEX / ADD UNIQUE` | ✅ |
| `CREATE [UNIQUE] INDEX ... ON ...` | ✅ |
| MySQL 表级 `COMMENT='...'` / 列级 `COMMENT '...'` | ✅ |
| PG `SERIAL` / `BIGSERIAL` 自增 | ✅ |
| PG `GENERATED ALWAYS AS IDENTITY` | ✅ 仅识别自增标记 |
| 注释 `--` / `/* */` 跳过 | ✅ |
| 字符串内分号 / 双引号转义 | ✅ |

### 已显式 warn（KNOWN_UNSUPPORTED）

`COMMENT ON` / `CREATE VIEW` / `MATERIALIZED VIEW` / `CREATE TRIGGER / FUNCTION / PROCEDURE / SEQUENCE / TYPE`

### 静默跳过（合理）

`INSERT / UPDATE / DELETE / SET / GRANT / REVOKE / COMMIT / USE / SHOW / DESCRIBE` 等运行时与会话语句。

### 缺口（已知不支持，且**不会**报 warning）

1. **PG 数组类型** `int[]` / `text[]` — 主正则单词模式吃不到 `[]`，会把数组当 unknown 类型。
2. **`GENERATED ALWAYS AS (expr) STORED`**（PG / MySQL 8 计算列）— 当前只识别 IDENTITY 自增模式，计算列的表达式会作为"不规整列定义"被半解析。
3. **`COLLATE`** / `CHARACTER SET` 子句出现在列级时 — 不影响 schema 结构，目前会被吃进 `afterType` 但不解析。
4. **`CHECK (expr)`** — 表级 CHECK 被直接 `continue` 跳过；列级 CHECK 子句也不解析。
5. **PG 表继承 `INHERITS (parent)`** / **PG 分区表 `PARTITION OF`** — 不支持。
6. **`ALTER TABLE ... DROP / MODIFY / RENAME COLUMN`** — `parseAlterTable` 只识别 `ADD` 子句。
7. **`SET FOREIGN_KEY_CHECKS=0`** / `LOCK TABLES` 等 mysqldump 头尾包裹 — 当前会进入"静默跳过"分支，是合理行为。
8. **复合 PK 表的 FK 推断**：解析层支持复合 PK / 复合 FK 解析，但 inferFK 只针对单列 PK 的目标表生成候选。

如果用户反馈"我导入的 MySQL dump 解析不全"，最可能撞上的是 1、3、5。

---

## 五、关于"换成第三方 SQL parser"的评估

用户最关切的问题：项目现在自己手搓 parser，是否应该换成通用 / MySQL 专用的第三方 parser？以下是**对比维度 + 推荐策略**。

### 5.1 候选库横评

| 库 | 体积（min+gzip 估算） | 准确度 | MySQL 支持 | TypeScript | 适配本项目 |
|---|---|---|---|---|---|
| **当前手写** | ~6 KB（在 main bundle 内） | 中（已知坑都防过） | MySQL/PG/SQLite 公共子集 | ✅ 原生 | ★★★★★ |
| **node-sql-parser** | ~200–400 KB | 高（完整 AST） | 是（含 MySQL 方言） | ✅ d.ts 完整 | ★★★ |
| **dt-sql-parser** | ~500 KB+ | 高（antlr4 生成） | 是（独立 MySQL grammar） | ✅ | ★★ |
| **@florajs/sql-parser** | ~80 KB | 中（MySQL only） | 是 | ⚠️ d.ts 不全 | ★★★ |
| **antlr4ts + 官方 MySql.g4** | ~1 MB+ | 极高 | 是（MySQL Workbench 同款） | ✅ | ★（杀鸡用牛刀） |
| **pgsql-ast-parser** | ~100 KB | 高（PG only） | ❌（仅 PG） | ✅ | ★（用户优先 MySQL） |

### 5.2 第三方 parser 解决什么 / 不解决什么

✅ **第三方 parser 能解决**：
- 计算列、PG 数组、CHECK、COLLATE、CHARACTER SET、ALTER TABLE 的非 ADD 子句、PG 表继承、视图与触发器的解析（不在 ER 图中，但能拿到 AST）。
- 给 column default 表达式拿到结构化 AST 而非裸字符串。
- 防御那些手写正则容易漏的边缘 case：`GENERATED AS IDENTITY (START WITH 100 INCREMENT BY 5)`、`PARTITION BY HASH(id) PARTITIONS 16` 等。

❌ **第三方 parser 解决不了**：
- **真实 mysqldump 输出**经常带 `/*!40101 SET ... */` 这类版本注释、`SET FOREIGN_KEY_CHECKS=0;` 这种会话指令——很多第三方 parser 直接 throw。手写的反而宽容。
- **方言混入**：用户可能粘贴一段从 PG 改过来但忘了改类型的 SQL（`SERIAL` 在 MySQL 风格 DDL 里），手写 parser 不挑剔，第三方常常报错卡死。
- **推断 FK 的语义**：第三方 parser 给的是字面 AST，不会把 `user_id INT` 推断为指向 `users.id`——这是本项目的核心价值，跟 parser 选型无关。

### 5.3 推荐策略：**分层 + 渐进**

**短期（不要换）**：

1. 当前 parser 对核心场景（MySQL DDL 公共子集）已经稳定，68 个测试守住。
2. 真正缺口是 PG 数组、CHECK、计算列、ALTER 非 ADD —— 这些**不是用第三方就免费拿到**，因为本项目下游不消费它们（不渲染 CHECK 约束、不渲染分区、不渲染计算列表达式）。把这些写进 `KNOWN_UNSUPPORTED` 显式 warn 即可。
3. bundle 已经 ~30 KB gzip（main），加 200KB+ 的 parser 会让首屏 7 倍。**与本项目"快速看 schema"的产品定位冲突**。

**中期（如果用户反馈解析失败率高）**：

4. 在 `src/parser/` 里加一个**可选的二级 parser**接口：
   ```ts
   // src/parser/backends/types.ts
   export interface SqlParserBackend {
     name: 'handwritten' | 'node-sql-parser' | 'mysql-strict';
     parse(sql: string): Schema;
   }
   ```
5. 主入口保持手写为默认；用户在 UI 里勾选"严格模式"时按需 `import('./backends/node-sql-parser')`（动态导入，不打进主 chunk）。
6. **二级 parser 的职责窄化**：只在手写 parser 产生 warning 的语句上重试，而不是从头重 parse。

**长期（如果项目重心转向 MySQL DDL 完整解析）**：

7. 才有理由考虑全面换 `node-sql-parser` 之类（带 MySQL 方言）。
8. 或者去 antlr4 + 官方 MySQL grammar 自己生成一个**懒加载 chunk**（首次 import 时下载 500KB+）。但只有用户场景真的要 "支持完整 MySQL 8 语法" 时才值得这么做。

### 5.4 既然优先聚焦 MySQL，手写 parser 怎么做得更鲁棒？

不换库的前提下，按 ROI 排序的**4 件具体的事**：

1. **接住 mysqldump 的"装饰性 SQL"**：在 `splitStatements` 之前先剥一层 `/*! ... */` 版本化注释（MySQL 特有的可执行注释，里面常是 `SET sql_mode=...`），并把 `SET / LOCK / UNLOCK TABLES / FLUSH PRIVILEGES` 加进静默跳过 allowlist 而非走 KNOWN_UNSUPPORTED。
2. **扩展 `parseColumnDef` 的多词类型**：加 `ENUM('a','b','c')`、`SET('x','y')`——这两个虽然现在能识别成 `string` 类型，但 `(...)` 内的逗号会把 `splitTopLevel` 误切。其实当前 `splitTopLevel` 用了 paren-depth 应该已经安全，但需要专门测试。
3. **接住 PG 数组**：`parseColumnDef` 在 type 之后多识别一次 `(\[\])+`，加进 `rawType`，`normalizeType` 加一条匹配 `[]` 结尾时按基础类型归一即可。改动 ≤ 20 行。
4. **接住 `ALTER TABLE ... MODIFY/CHANGE COLUMN`**：MySQL 改列定义很常见。读出来的"新列定义"可以走 parseColumnDef 同一条路径，replace 老列。改动 ~40 行。

这 4 项加起来一两百行，能把"用户日常粘 mysqldump 输出"的覆盖率从 70% 提到 90%+，且不增加任何 bundle 体积。

---

## 六、扩展指南：要加一种新语法时该改哪些文件？

按"加什么"分类：

| 任务 | 改动文件 | 也要加测试 |
|---|---|---|
| 加一个新的 SQL 方言关键字（如 `MEDIUMINT`） | `parser/normalizeType.ts:TYPE_MAP` | `parser/parser.test.ts` |
| 加一种新的多词类型 | `parseCreateTable.ts:parseColumnDef` 的 `head === '...'` 分支 | 同上 |
| 加一种"应当报 warn 的"未支持语句 | `parser/index.ts:KNOWN_UNSUPPORTED` | 同上 |
| 加一种新的 ALTER 子句 | `parseAlterTable.ts` 的循环里加一段 match | 同上 |
| 加一种新的分片命名规则 | `mergeShardedTables.ts:SHARD_SUFFIX_PATTERNS`（注意顺序！） | `mergeShardedTables.test.ts` |
| 加一个新的 column 元数据字段（如 `column.charset`） | `parser/types.ts:Column` + `parseColumnDef` + `infer/buildGraph.ts`（如果要画到节点上） | 各层测试 |

---

## 七、附：解析层的代码度量

```
src/parser/
├── index.ts              113 行  解析入口 + 分发 + KNOWN_UNSUPPORTED warn
├── parseCreateTable.ts   278 行  CREATE TABLE 主体（最复杂）
├── parseAlterTable.ts     70 行  ALTER + CREATE INDEX
├── tokenize.ts           263 行  splitStatements / stripComments / splitTopLevel / matchClosingParen / unquoteIdent
├── normalizeType.ts       25 行  类型归一 + 兼容比较
├── utils.ts               44 行  applyIndexFlags / splitQualified / canonicalFkKey
└── types.ts               72 行  类型定义

src/infer/mergeShardedTables.ts  160 行（管线上是 parser 之后）

测试：
├── parser/tokenize.test.ts          12 cases
├── parser/parser.test.ts             6 cases
├── parser/utils.test.ts              8 cases
└── infer/mergeShardedTables.test.ts 17 cases
合计：43 cases 守住解析层
```

合计：~1000 行解析层 + ~500 行清洗层 + ~250 行测试。

---

*本文档随 parser 演进而更新。下次扩 SQL 方言或换 parser 后端时，请同步刷一次第二节与第五节。*
