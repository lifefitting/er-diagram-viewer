# 空工作区启动引导：实施计划与方案

## 1. 背景与目标

当前应用在首次打开且 `sessionStorage` 中没有工作区时，会自动调用
`setSql(SAMPLE_ECOMMERCE)`，直接生成 14 张表示例 ER 图。这能快速展示能力，但对于通过
单文件 HTML 初次接触产品的用户，示例图会掩盖真正的开始路径；对于熟练用户，也缺少把
`.erreview` 直接拖入页面以继续工作的高效入口。

本次调整的目标是：

1. 首次打开空会话时不再自动加载示例，而是显示空工作区启动器。
2. 启动器明确提供三个入口：查看示例、导入 DDL、恢复工作区存档。
3. 已有当前会话工作区时继续无感恢复，不显示、也不闪现启动引导。
4. 空工作区支持直接拖入 SQL/DDL 文件、SQL 文本或单个 `.erreview` 存档。
5. 保持 SQL、存档导入的原子性：失败时当前工作区不发生部分写入。
6. 不变更工作区存档格式、持久化版本和用户已有存档的兼容性。

## 2. 非目标

- 不引入账号、云端存储或跨标签页持久化。
- 不把 `sessionStorage` 改为 `localStorage`。
- 不增加一次性“已看过欢迎页”标志；每个全新会话都应回到启动器。
- 不改变非空工作区中的 SQL 增量更新、存档合并或覆盖确认语义。
- 不在本次调整中修改 ER 图布局、推断、评审、导出和存档数据结构。

## 3. 启动状态机

应用必须先确认 Zustand persist hydration 已完成，再决定显示内容。启动状态定义如下：

| 状态 | 判定条件 | 页面行为 |
| --- | --- | --- |
| `hydrating` | persist 尚未完成 hydration | 显示轻量加载状态，不渲染启动器 |
| `restoring` | hydration 完成，`rawSql` 非空，正在执行 `reparse()` | 继续显示加载状态 |
| `workspace` | `schema.tables.length > 0` | 正常显示 ER 画布及完整工具 UI |
| `empty` | hydration 完成，`rawSql.trim()` 为空 | 显示三入口启动器 |
| `recovery` | `rawSql` 非空，但启动重解析失败 | 保留原 SQL，显示“修复已保存 SQL”入口，禁止回退示例 |

硬性规则：只有 `hydration === complete && rawSql.trim() === ''` 才允许显示新手启动器。
从 SQL 导入或 `.erreview` 恢复得到的工作区都含有 `rawSql`，因此刷新当前标签页时会直接走
`restoring → workspace`，不会出现引导闪烁。

### 3.1 Hydration 实现

- 在应用入口增加 `usePersistHydrated` 小型 hook。
- 初始值读取 `useApp.persist.hasHydrated()`，并订阅
  `useApp.persist.onFinishHydration(...)`。
- 启动重解析副作用仅在 hydration 完成后运行，并用 ref 防止 React Strict Mode 重复执行。
- 保留当前“解析失败时原文不被覆盖”的处理，只将其映射到 `recovery` 状态。
- 删除无持久化 SQL 时自动执行 `setSql(SAMPLE_ECOMMERCE)` 的分支。

## 4. 空工作区交互方案

### 4.1 页面结构

空工作区不是独立 landing page，而是保留应用顶栏的真实工作区。画布中央显示标题、隐私说明
与三张操作卡：

1. **查看示例 ER 图**
   - 辅助文案：`第一次使用？先看看完整效果`
   - 点击后直接调用 `setSql(SAMPLE_ECOMMERCE)`。
   - 成功后立即进入正常工作区，不再经过导入弹窗。

2. **导入 DDL**
   - 辅助文案：`拖入 .sql / .ddl / .txt，或直接拖入 SQL 文本`
   - 点击卡片打开现有导入弹窗的 SQL 模式，保留粘贴和编辑能力。
   - 空工作区拖入单个 DDL 文件或纯文本时，解析成功后直接绘图。

3. **恢复工作区**
   - 辅助文案：`拖入 .erreview，继续之前的评审`
   - 点击卡片打开现有导入弹窗的工作区模式。
   - 拖入单个有效存档时直接恢复；加密存档只增加必要的密码步骤。
   - 拖入多个存档时进入现有合并预览，不做无预览的自动合并。

三张卡片下方显示：`所有数据仅在浏览器本地处理，不会上传服务器`。

### 4.2 拖放范围与反馈

- 整个空画布都是 drop target，用户不必精确命中某张卡片。
- 只在 `DataTransfer.types` 包含 `Files` 或 `text/plain` 时阻止浏览器默认行为。
- 拖入期间显示全画布反馈：`释放以导入 DDL 或恢复工作区`。
- drop 后按文件内容识别类型；扩展名仅用于错误提示和文件选择器过滤。
- 必须阻止浏览器直接导航到被拖入文件。
- 使用 drag-depth 计数或 relatedTarget 判断，避免子元素间移动造成遮罩闪烁。
- 解析、解密或导入期间显示局部忙碌状态并暂时防止重复提交。
- 失败时在启动器内显示可恢复错误，空工作区保持不变。

### 4.3 非空工作区保护

- 快速拖放提交只在 `empty` 状态启用。
- 已有画布时仍使用顶部“导入”及现有弹窗，继续提供增量更新、重新导入和存档合并预览。
- 不为全局 `window` 注册会覆盖非空工作区行为的永久 drop handler。

### 4.4 空状态工具 UI

- 保留品牌、主题切换和顶部“导入”按钮。
- 空状态隐藏搜索、阅读/编辑模式、配色、导出及左侧智能面板，因为这些控件没有可操作对象。
- 这只是条件渲染，不修改或持久化用户的 `sidebarCollapsed`、主题等偏好。
- 工作区加载完成后恢复完整工具 UI。
- `recovery` 状态保留可打开导入弹窗修复 SQL 的明显入口，并展示解析错误。

## 5. 共享导入管线

现有 `SqlInputDialog` 同时承担文件读取、内容分类、加密存档解锁、存档解析、多个存档预览和
最终提交。空工作区直接拖放不能复制这一整套逻辑，否则两条入口会逐渐产生兼容性差异。

### 5.1 建议模块边界

新增 `src/ui/import/`：

- `importFiles.ts`
  - 读取 `File` 文本。
  - 使用 `isEncryptedWorkspaceArchive`、`looksLikeArchive` 和
    `parseWorkspaceArchive` 分类内容。
  - 通过调用方提供的 `requestUnlock(content, fileName)` 回调处理加密存档。
  - 返回类型化结果：SQL、有效存档、无效存档或取消。
  - 不直接写 Zustand store，便于纯函数测试并保持提交原子性。

- `useArchiveUnlock.ts`
  - 管理一个等待密码的 Promise、取消语义和卸载清理。
  - 同时供导入弹窗和空工作区使用。
  - 继续复用 `ArchivePasswordDialog`，不改变加密格式。

- `types.ts`（仅当类型数量使单文件过长时拆分）
  - `SqlImportCandidate`
  - `ArchiveImportCandidate`
  - `ImportCandidateResult`

### 5.2 调用方职责

- `SqlInputDialog`
  - 使用共享分类结果更新 textarea 或 staged archives。
  - 继续负责 preserve existing、重新导入、多个存档预览与最终按钮提交。

- `EmptyWorkspace`
  - 单个 SQL：调用 `setSql`。
  - 单个存档：调用 `importWorkspace`。
  - 多个存档：把已选择文件交给工作区模式弹窗，由原有合并预览接管。
  - 捕获 store 抛出的解析错误并在启动器内显示；失败前后 store 内容一致。

## 6. 文件与代码变更清单

### 必改

- `src/App.tsx`
  - hydration gate、启动状态机、删除自动示例、空状态/恢复状态路由。
- `src/store/index.ts`
  - 如有需要导出持久化 key 或 hydration 辅助类型；不改 partialize、version、migrate。
- `src/ui/empty/EmptyWorkspace.tsx`
  - 三入口 UI、画布拖放、忙碌与错误反馈。
- `src/ui/import/importFiles.ts`
  - 共享文件读取与分类。
- `src/ui/import/useArchiveUnlock.ts`
  - 共享密码请求生命周期。
- `src/ui/overlays/SqlInputDialog.tsx`
  - 改用共享导入管线；允许从 App 指定初始 tab，并接收多个预选文件。
- `src/ui/overlays/Toolbar.tsx`
  - 无 schema 时收敛为品牌、主题和导入入口。

### 文档与基准

- `README.md`
  - 把“首次打开自动加载示例”改为三入口说明。
- `perf/fixtures.mjs`、`perf/benchmark.mjs`
  - small 场景显式点击“查看示例 ER 图”，不再隐式依赖启动副作用。
  - 报告中区分空工作区首屏耗时与点击示例后的图表初始化耗时。
- `tests/e2e/*.spec.ts`
  - 需要画布的既有用例统一调用 `loadSampleWorkspace(page)`。
  - 新增空状态、会话恢复、DDL drop 和存档 drop 回归。
- `index.html`
  - 检查首屏 skeleton 是否需要改成中性布局，避免首次打开时先闪现左侧面板占位。

## 7. 测试方案

### 7.1 单元测试

1. 启动状态解析：
   - hydration 未完成不能显示引导。
   - 空 `rawSql` 进入 `empty`。
   - 有 `rawSql` 且有表进入 `workspace`。
   - 有 `rawSql` 且解析失败进入 `recovery`。
2. 导入内容分类：
   - 普通 SQL、`.ddl`、无扩展名 SQL 文本。
   - 未加密 `.erreview`。
   - 加密存档的成功、错误密码和取消。
   - JSON 但非工作区存档、损坏存档、空文件。
3. 原子性：分类失败不调用 `setSql` 或 `importWorkspace`。

### 7.2 E2E 回归

1. 全新 context 打开后：
   - 三入口可见。
   - 页面没有 `[data-node-id]`，也没有 Cytoscape 画布。
2. 点击示例：
   - 生成 14 张表。
   - 启动器消失，完整工具 UI 出现。
3. 拖入 SQL 文件：
   - 直接生成对应表。
   - 无需再点击弹窗提交。
4. 拖入纯 SQL 文本：
   - 与文件路径一致。
5. 拖入普通工作区存档：
   - 恢复表、节点坐标和 viewport。
6. 刷新恢复：
   - 先建立工作区，reload。
   - 首帧至恢复完成期间启动器始终不可见。
7. 错误恢复：
   - 注入可读取但无法解析的持久化 SQL。
   - 原文仍在，显示修复入口，不加载示例。
8. 现有画布拖拽、列排序、FPS HUD、对齐菜单等完整 E2E 继续通过。

### 7.3 构建与兼容性

- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run test:e2e`
- `bun run build`
- `bun run build:single`
- 使用 `file://` 打开单文件产物，验证示例、SQL 文件和存档三条路径。

## 8. 性能验收

- 空会话不创建 Cytoscape core、不执行 SQL pipeline、布局或路由。
- 标准分块构建中，空会话不请求/执行 DiagramCanvas 图表 chunk。
- 单文件构建虽然资源已内联，但空会话不初始化 Cytoscape 和 ER 图 DOM。
- small 基准显式点击示例后，图表交互数据继续与 v0.3.6 基线可比。
- 新增空工作区冷启动记录，至少采集 FCP、可交互时间和空闲动画数。

## 9. 数据安全与兼容性

- 不修改 `PERSIST_VERSION`、`ARCHIVE_VERSION` 或 `.erreview` envelope。
- 不清理、不迁移、不重写已有 `sessionStorage`。
- 启动器出现条件与 `rawSql` 严格绑定，防止覆盖已恢复数据。
- `setSql` 和 `importWorkspace` 继续在派生成功后一次性提交。
- 密码仅传入现有 Web Crypto 解密函数，不进入 store、日志或持久化。
- 导入失败时显示错误，不自动降级到示例。

## 10. 分支、提交与回滚

1. 先合并 `fix/wheel-fps-hud` 与 `feat/alignment-menu-icons`，完整回归后更新 `main`。
2. 从最新 `main` 创建 `feat/empty-workspace-onboarding`。
3. 建议按以下提交拆分：
   - `docs: 制定空工作区启动引导实施方案`
   - `refactor: 复用 SQL 与工作区文件识别流程`
   - `feat: 新增会话恢复安全的空工作区引导`
   - `test: 覆盖空工作区导入与会话恢复`
   - `docs: 更新首次使用和性能基准说明`
4. 如需快速回滚，回退 UI 与 App 启动状态提交即可；共享分类重构可以保留，因为不改变导入语义。

## 11. 完成定义

- 新会话首次打开稳定显示三入口，不自动加载示例。
- 有当前会话工作区时直接恢复，整个恢复过程不闪现引导。
- 示例、DDL、普通存档、加密存档和多个存档路径均可达。
- 无效输入不会破坏当前状态或写入部分数据。
- 既有工作区存档可无迁移读取，导出格式不变。
- 单测、E2E、标准构建和单文件离线回归全部通过。
- small 性能基准不再隐式依赖默认样例，并保留与 v0.3.6 的可比性。
