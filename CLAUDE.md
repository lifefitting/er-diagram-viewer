# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Current release baseline: `0.3.5` (2026-08-01). Release evidence and the next-version
entry criteria live in [docs/release-readiness.md](docs/release-readiness.md).

## Project

Pure-frontend SPA that parses pasted/uploaded SQL DDL into an interactive ER diagram for DB design review. The hook: it heuristically infers FK relationships when the script doesn't declare them.

## Commands

Runtime: **Bun** (`packageManager: bun@1.3.10`). `bun install` reads `bun.lock`.
Vite + Vitest remain the underlying tools — Bun only acts as package manager
and script runner.

```bash
bun install              # install deps from bun.lock
bun run dev              # Vite dev server (HMR; see "HMR caveats" below)
bun run build            # tsc -b && vite build  → ./dist
bun run preview          # serve ./dist (use this when verifying end-to-end)
bun run test             # vitest run (one-shot)
bun run test:watch       # vitest watch mode
bun run typecheck        # tsc -b --noEmit
bun run lint             # eslint src/**/*.{ts,tsx}
bun run format           # prettier --write

# Single test file or pattern:
bunx vitest run src/parser/parser.test.ts
bunx vitest run -t "matches user_id"
```

**Gotcha:** bare `bun test` invokes Bun's NATIVE test runner and ignores the
`test` script. Always use `bun run test` to go through Vitest.

## Architecture

Pipeline: **SQL text → `Schema` → `InferredFK[]` → Cytoscape graph + React overlay**. Each stage is one directory under `src/`.

### `src/parser/`
Hand-written, dialect-generic. Entry: `parseSql(text)` in [index.ts](src/parser/index.ts).

- [tokenize.ts](src/parser/tokenize.ts) — statement splitter that tracks string/identifier/comment state so semicolons inside `'...'`, `` `...` ``, or `/* */` don't break statements. Also exports `splitTopLevel` (paren-aware comma split, used to split column defs) and `unquoteIdent`.
- [parseCreateTable.ts](src/parser/parseCreateTable.ts) — `CREATE TABLE` body parser. Extracts columns, table-level PK/UNIQUE/INDEX/FOREIGN KEY, MySQL trailing `COMMENT='...'`, and inline column `REFERENCES`. **`detectInlineColumnRef` must skip lines whose first token is a constraint keyword** (CONSTRAINT/FOREIGN/etc.) or it'll synthesize bogus FKs from table-level FK clauses.
- [parseAlterTable.ts](src/parser/parseAlterTable.ts) — `ALTER TABLE ADD CONSTRAINT FK / ADD INDEX` and standalone `CREATE INDEX`.
- [normalizeType.ts](src/parser/normalizeType.ts) — maps raw types to one of `int | float | string | date | bool | blob | json | uuid | unknown`. `unknown` is treated as compatible with everything in the FK inference engine.

Parser scope today: MySQL/PG/SQLite **public** DDL subset. **Not handled:** PG `COMMENT ON TABLE/COLUMN ... IS '...'` (statement is silently dropped — no warning). Anything outside `CREATE TABLE / ALTER TABLE / CREATE INDEX` falls into a silent skip branch in `parseSql`; if you add a new statement kind, also add a warning path for unrecognized variants.

**Type-detection gotcha:** the column-def regex matches a single type word followed by optional `(...)`. Multi-word types (`DOUBLE PRECISION`, `CHARACTER VARYING`, `TIMESTAMP WITH TIME ZONE`) are handled by explicit continuations inside `parseColumnDef`. Do **not** widen the initial regex to two words — that broke `BIGINT NOT NULL` detection (it ate `NOT` as the second type word).

### `src/infer/`
Entry: `inferForeignKeys(schema)` in [inferForeignKeys.ts](src/infer/inferForeignKeys.ts).

Rules, in priority order, all enabled by default:
1. **Name suffix**: column ending in `_id` / `Id` **or `_ref` / `Ref`** (`stripFkSuffix`). Strip the suffix to get a base. [nameMatching.ts](src/infer/nameMatching.ts) generates candidate target names by varying singular/plural and stripping `t_`/`tbl_`/`tb_` prefixes. If the bare base finds nothing, a **same-namespace prefix retry** (`tablePrefixes`) prepends the *source table's* leading namespace segment(s) and looks again — so `credential_ref` in `iam_credential_device` resolves to `iam_credential` (medium confidence). The camelCase forms require a lowercase char before the capital, so `href`/`XRef` aren't mis-split.
2. **Type compatibility**: source column's normalized type must match target PK's. `unknown` matches anything.
3. **Index priority**: when multiple targets tie, prefer the one where the source column is indexed/unique.
4. **Confidence tiers**: `high` (exact name + type + source indexed) / `medium` (name+type only, or prefix normalization needed) / `low` (compound-prefix fallback like `parent_user_id → users`). `low` is hidden from the canvas unless the user toggles `showLowConfidence` or accepts the FK explicitly.

Explicit FKs from the parser are merged with inferred ones via the helper `effectiveForeignKeys` in [store/selectors.ts](src/store/selectors.ts); `decisions[fkKey]` overrides confidence-based visibility (accept = always show; reject = always hide). A third FK source is **manual** (`source: 'manual'`, stored in `decisionsSlice.manualFks`): user-added relations the engine can't infer, created either by dragging a field-row connect dot onto another field (DiagramCanvas `onConnectStart` — a smooth bezier rubber curve; the drop creates the relation IMMEDIATELY, no per-drop confirmation, with `kind` defaulted from the target: PK/unique column → `'fk'`, else `'logical'`; the grab side persists as `ForeignKey.drawSide` — same-table loops bulge out that side) or via the form in the 手动连线 sidebar panel ([ManualFkPanel.tsx](src/ui/sidebar/ManualFkPanel.tsx)), which is also where every manual relation is listed with a per-row 物理/逻辑 toggle (`decisionsSlice.setManualFkKind` — endpoints keep the drawn direction; the guard re-checks key collisions since kind participates in key normalization). The panel's select-based form is hidden behind a 「用表单添加…」 disclosure (rarely used; drag is the primary path). Both paths share [store/manualFkValidate.ts](src/store/manualFkValidate.ts), which refuses any draft whose `canonicalFkKey` collides with an explicit/inferred/manual FK — even a hidden one — because buildGraph's route-key disambiguation relies on collision counts never changing after routes are persisted. Manual FKs render solid, weigh like explicit FKs in the dagre layout, and are included in the DDL export. Manual edges are click-selectable on the canvas — Shift/⌘/Ctrl+click batches, and the marquee rubber-bands them too with ONE-KIND-PER-MARQUEE semantics: touching any card makes it a TABLE selection; only a marquee touching no card selects edges (`polylineIntersectsRect` in selection/marquee.ts, same touch-=-selected feel as cards). `.manual-selected` class + bottom pill; Delete/Backspace removes the edge batch and NEVER recycle-bins tables (edge selection takes strict priority). Whole-category visibility toggles (`display.showLogicalLinks` / `showManualLinks`, the 隐藏连线/显示连线 buttons on the 逻辑关联/手动连线 section headers) filter inside `effectiveForeignKeys`, so canvas and exports stay in sync. Self-loop edges are NOT drawn by cytoscape (`segments` can't render loops): `edge:loop` is display:none and the DOM `SelfLoopLayer` in DiagramCanvas draws the orthogonal U-bracket from `routePoints`, docked at the field rows, on the `loopSide` the user drew from.

Orthogonal to `source` is **`ForeignKey.kind`** (`'fk'` default | `'logical'`): a logical link is a **business-key association** (sharded services joined by e.g. `out_trade_no`, no physical constraint). Logical inference is **user-triggered, never automatic**: `runPipeline` only runs [inferLogicalLinks.ts](src/infer/inferLogicalLinks.ts) for `store.logicalKeys` — the column names the user picked via the 逻辑关联 sidebar panel's 扫描业务键 picker ([LogicalPanel.tsx](src/ui/sidebar/LogicalPanel.tsx) — its own accordion section, deliberately separate from the FK-candidate workflow/progress) (backed by `discoverBusinessKeys`, same clustering, no edges). In a large DDL the same column name recurs everywhere; the user's picks replace noise heuristics. `logicalKeys` is persisted (refresh re-derives the same candidates via `reparse`), cleared on `setSql`, and `setLogicalKeys` re-runs the pipeline. Clustering: same-named non-PK columns across tables (38-name blacklist, type-compat), unique-side → star at medium confidence, else pairwise mesh at low; no-hub clusters spanning >4 tables are unselectable in the picker / become `schema.notices`. FK-consumed column names and existing FK keys (both directions) are excluded (`collectFkExclusions` in pipeline.ts). Logical links share one decisions/route key with their reverse: `canonicalFkKey` order-normalizes the KEY for `kind: 'logical'`, while stored endpoints keep their direction — inferred candidates come out pre-ordered (`canonicalizeLogicalFk`), but MANUAL links preserve the user's drawn direction (drag start = `from`), so the 手动连线 panel's 逻辑→物理 kind flip yields "start references end" exactly as drawn; they render undirected (dotted, circle endpoints, `~` separator; pending = lower opacity since dotted occupies cytoscape's line-style), are **excluded from module clustering** (`recomputeModules`) and FK badges, get minimal layout weight even when manual, export as `-- LOGICAL:` comments in the DDL (never ALTER TABLE), and appear in the 评审报告 Markdown export ([exports/toReport.ts](src/exports/toReport.ts) — the export menu offers section toggles: inferred-FK candidates and logical candidates can each be omitted; manual relations are always included).

### `src/diagram/`
Cytoscape draws layout + edges only. **Nodes are invisible**: the React component [DiagramCanvas.tsx](src/diagram/DiagramCanvas.tsx) renders each table as an absolutely-positioned HTML overlay synced to the cy node's `renderedBoundingBox` via `pan zoom resize position layoutstop add remove` events.

Why overlays instead of cy native labels: cy's `text-wrap: wrap` + `width: 'label'` interaction was unreliable with multi-line table content; box-drawing chars and column rows didn't measure correctly. The overlay approach gives full HTML/CSS control and works at all zoom levels. After auto-layout, `runLayout`'s `fitWithZoomClamp` fits-to-content but **floors zoom at 1.0** so the first paint never blurs; the user then wheel-zooms continuously within Cytoscape's 15%–100% bounds or steps the shared fixed ladder (`ZOOM_STOPS`: 15 / 20 / 33 / 50 / 75 / 100) through `CyView.zoomStep`. Explicit 全览/fit may settle between ladder stops. Overlays are synced to each node's `renderedBoundingBox` via `cy.on('pan zoom resize position layoutstop add remove', …)`.

**Tri-state selection** (search OR click focus): a single `Selection = { matches, neighborhood } | null` (built in [selection/deriveSelection.ts](src/diagram/selection/deriveSelection.ts) + [closedNeighborhood.ts](src/diagram/selection/closedNeighborhood.ts)) drives both:
- cy edge classes: `highlight` on edges touching a match, `dimmed` on edges with neither endpoint in the neighborhood.
- overlay class: match → amber ring; in neighborhood (not match) → neutral; outside neighborhood → 30% opacity.

Search matches against table name, table comment, column names, and column comments. Matched substrings also get a Chrome-style yellow `<mark>` via [overlay/highlight.tsx](src/diagram/overlay/highlight.tsx). If `focusId` is set (click on overlay) it overrides search; clicking blank canvas clears it.

**Find-style match navigation**: the canvas publishes the ordered match node ids (sorted top→bottom, left→right) to `store.searchMatchIds`; the toolbar shows an "n / m" counter and `Enter`/`Shift+Enter` (or ▲▼) call `cycleSearchMatch(±1)` to step `searchActiveIndex`. A `searchActiveIndex` effect calls the view's `centerOnNode` to pan-follow the active match, which also gets a stronger ring (`activeMatch` on the overlay). `searchMatchIds`/`searchActiveIndex` are transient (denylisted from persist); the pure wraparound math is `store/searchNav.ts`.

`[buildGraph.ts](src/diagram/buildGraph.ts)` computes per-node `boxWidth` / `boxHeight` from the table's longest column line + whether the table has a comment (adds one subtitle row), and assigns each FK edge a stable `fkKey` (table+column based) so manual routes survive rebuilds. The overlay reads sizes via the synced bounding box.

**Connector routing** (`routing/`): edges are orthogonal polylines, not cytoscape curves. `arrangeForPublication` ([layout/](src/diagram/layout/arrangeForPublication.ts)) ranks tables left-to-right with dagre and stashes channel waypoints; on `layoutstop`, [updateEdgeEndpoints.ts](src/diagram/routing/updateEdgeEndpoints.ts) docks each edge to its field-row port and picks a strategy from [channelRoute.ts](src/diagram/routing/channelRoute.ts) — a direct 2-bend H-V-H through the gutter, a Dijkstra **detour** when blocked (endpoint-aware: the route keeps an 18px horizontal **port stub** at each field row and treats the edge's own cards as keep-outs, so a detour leg never runs flush along a card border — pre-fix, a vertical drop at exactly the card edge made the docked field unreadable), or a **side-bracket** for vertically-stacked cards (`gapX < 0`) — then encodes the path as `routePoints` (read by both the canvas and the SVG export). Dragging a card clears its edges' manual overrides and re-routes live. [overlay/RouteHandles.tsx](src/diagram/overlay/RouteHandles.tsx) lets the user drag a segment's midpoint; the hand-edited path is saved to `manualRoutes` and survives rebuilds. (The old closed-form `computeSegments` module was removed in favor of `channelRoute`.) Each edge is colored by its source table's module `header` color (`data(color)`), which is tuned for the light canvas; in dark mode `applyEdgeTheme` (DiagramCanvas) swaps the stroke to `data(colorDark)` — the module's hand-stepped `ModuleColor.headerDark` when the palette provides one (the `professional` default palette does; the HSL auto-lift would blow its saturated darks into neon), else the lightness-floored fallback computed by [edgeColor.ts](src/diagram/edgeColor.ts) so dark palettes like `mono` stay visible — the dark SVG/PNG export uses `colorDark` for the same reason, while light mode/exports keep `color`. The `professional` palette (default; OKLCH-designed, machine-validated for both canvases — design record in [docs/palette-professional.md](docs/palette-professional.md)) is one of five in `MODULE_PALETTES` ([inferModules.ts](src/infer/inferModules.ts)); adding a palette means touching `PaletteName`, `MODULE_PALETTES`, `FALLBACK_COLORS`, the `PALETTES` set in [store/persistMigrate.ts](src/store/persistMigrate.ts), and `PALETTE_OPTIONS` in the Toolbar (whose trigger is a palette-icon button, not a swatch strip).

**Self-loops** (same-table relations): cytoscape's `segments` curve-style draws NOTHING for loop edges — the U-bracket route only ever reached the SVG export. The `edge:loop` style rule renders loops as a right-bulging `bezier` whose `control-point-step-size` maps from `data(loopStep)` (buildGraph: card halfwidth + 64) because loop control points must reach BEYOND the card boundary or cytoscape reports "invalid endpoints" and draws nothing. During drag-to-connect, hovering a same-table row bends the rubber curve into a same-side U to match.

**Field review notes** (评审批注): clicking a field row opens `FieldNoteBubble` (DiagramCanvas) → `{ text, updatedAt, severity, status }` saved per `table::column` in `notesSlice.fieldNotes` (persisted — timestamps are part of the review record; legacy string AND pre-severity object values upgraded on load to 建议/待处理; cleared on `setSql`). `severity` (`suggest|warn|block`, labels 建议/警告/阻塞) colors the row-marker dot (amber/orange/rose); `status` (`open|accepted|rejected`, 待处理/已采纳/不采纳) is the multi-round triage state — the bubble shows the severity picker always but the status row only when EDITING an existing note (a fresh finding is 待处理 by definition), and `setFieldNoteStatus` flips status WITHOUT touching `updatedAt` (写于 records authorship, not triage; the overlay's status chip cycles open→accepted→rejected). Label/order/rank helpers (`NOTE_SEVERITIES`, `severityLabel`, `severityRank`, …) live in notesSlice — pure, shared by bubble/overlay/report. The right-edge `ReviewNotesOverlay` (ui/overlays/ReviewNotes.tsx) sorts open-first → severity → newest, shows per-severity counts in its header, dims resolved rows, and locates via `flashTable`; the 评审报告's 字段评审意见 section groups by severity with inline status markers and a 级别×状态 summary line.

**Canvas interaction**: `canvasMode` is `'select'` (marquee + multi-select) or `'pan'` (hand tool; Space-drag and middle-mouse pan in either mode). [selection/marquee.ts](src/diagram/selection/marquee.ts) and [selection/dragGroup.ts](src/diagram/selection/dragGroup.ts) are pure helpers for rubber-band selection and group-move math. [cyHandle.ts](src/diagram/cyHandle.ts) holds the cy instance, an imperative view API (`fit` / `resetZoom` / `zoomToSelection` / `relayout`, bound by the canvas on mount), and a **session-only** undo/redo stack of `LayoutSnapshot`s (positions + widths + routes, cap 50; never persisted).

**Recycle bin**: Delete/Backspace marks tables in `deletedTables`; `visibleSchema` (in [store/selectors.ts](src/store/selectors.ts)) filters those tables and their FKs out of the canvas and every export. [overlay/RecycleBin.tsx](src/ui/overlays/RecycleBin.tsx) (bottom-left) restores them. The SQL is never touched.

### `src/store/`
Zustand, split into slices assembled in [index.ts](src/store/index.ts): `schemaSlice` (rawSql / schema / inferred / modules), `decisionsSlice` (per-FK accept/reject), `displaySlice` (field-display toggles / search / theme — **no** layout-kind field; the layout picker was removed), `canvasSlice` (collapse / `tableWidths` / `columnOrders` / `nodePositions` / `manualRoutes` / `deletedTables` / `canvasMode` / flash), `historySlice` (undo/redo flags), plus `selectors.ts` (`effectiveForeignKeys`, `visibleSchema`). [pipeline.ts](src/store/pipeline.ts) runs `parseSql → mergeShardedTables → inferForeignKeys → inferModules`.

`setSql(sql)` is the entry into the pipeline (re-parse + re-infer; **clears** layout — positions, manual routes, deleted tables — for a fresh start). `reparse()` re-derives schema from the persisted `rawSql` on reload but **keeps** the user's layout.

Persistence: the `persist` middleware writes to **sessionStorage** (key `er-viewer:state:v1`, `version: 2`) using a **denylist** (`DERIVED_OR_TRANSIENT_FIELDS`) rather than an allowlist. Derived data (`schema`/`inferred`/`modules`) and transient state (`search`, `canvasMode`, `canUndo`/`canRedo`, `flashTables`/`flashTick`) are NOT saved. So a refresh restores `rawSql` + decisions + display + theme + node positions + widths + field order + manual routes + recycle bin + **camera (`viewport` = pan/zoom)**, but **search clears and pan-mode resets to `select`**. The `viewport` restore (DiagramCanvas debounced `cy.on('pan zoom')` save → one-shot restore in the rebuild effect via `clampPan`) is what makes a refresh reproduce the *exact* prior screen, not just the node positions. sessionStorage (not localStorage) is deliberate: imported DDL may be real production schema, so it must not linger on disk past the tab.

### `src/ui/` (UI shell)
Organized by the user's mental model of the screen — split into physical layers:

- **`src/ui/overlays/`** — floating UI above the canvas: `Toolbar` (top bar), `CanvasControls` (bottom-right pill cluster: undo/redo · hand tool · zoom ladder · view menu with 缩放至100%/全览/缩放到选中/重置布局/全屏), `RecycleBin` (bottom-left; restores deleted tables), `ExportMenu`, `SqlInputDialog`, plus `icons.tsx`.
- **`src/ui/sidebar/`** — left-side control panel: `Sidebar` (the shell + `CollapsedSidebarRail` + `GroupHeading`), `DisplayControls`, `InferencePanel` (FK candidates only), `LogicalPanel` (业务键扫描/候选), `ManualFkPanel` (手动连线列表 + 类型切换 + 表单), `ModulesPanel`, `AccordionSection`, plus `icons.tsx` for sidebar-specific glyphs.
- **`src/ui/theme/`** — `useApplyTheme` hook reading `theme` from the store and toggling the `dark` class on `<html>`.

The export menu calls `getCy()` from `diagram/cyHandle` (bound by `DiagramCanvas` on mount; cleared on unmount) to grab the cy instance for `cy.png({ full: true, scale: 2 })`. Exports run against `visibleSchema`, so recycle-binned tables and their FKs are excluded; SVG export reuses each edge's `routePoints` so the file matches the on-screen routing. DDL export builds `ALTER TABLE ADD CONSTRAINT` lines from non-explicit effective FKs (logical links become `-- LOGICAL:` comments). Two more Markdown exports: 评审报告 ([exports/toReport.ts](src/exports/toReport.ts) — candidates with decision states, logical links, manual relations, field review notes, recycle-bin exclusions) and 数据库说明文档 ([exports/toSpecDoc.ts](src/exports/toSpecDoc.ts) — standard spec format: overview, per-table column definition tables, PK/indexes, CONFIRMED relations only).

**Workspace archive** (工作区存档, [exports/archive.ts](src/exports/archive.ts)): the `.erreview` file is the FULL persisted-store snapshot (`getPersistedSnapshot()` in store/index.ts — shares `pickPersisted` with the persist middleware, so new persisted fields flow into archives automatically) wrapped in an envelope (`format: 'erreview'`, `formatVersion`, `persistVersion`, appVersion, exportedAt, tableCount). Unlike the view exports it is NOT filtered by `visibleSchema` — recycle bin, rejected candidates, layout and camera are all included. New exports can be password-encrypted with PBKDF2-SHA-256 + AES-GCM; legacy plaintext archives remain readable. Import lives in SqlInputDialog's explicit two-tab layout (`ImportMode: 'sql' | 'archive'` — SQL 脚本 keeps the textarea/samples/upload flow, 工作区存档 gets its own dropzone/summary-card/SQL-preview panel; the tabs hold independent state, and a dropped/uploaded file routes BY CONTENT via `looksLikeArchive` — SQL never starts with `{` — switching to the matching tab, so renamed .json/.txt archives still work). It reuses the sessionStorage validators: `persistVersion` mismatch → `migratePersisted` degrades to rawSql-only, otherwise `sanitizePersisted` drops malformed fields; a `parseSql` pre-flight protects the current workspace from broken archives. Applying (`importWorkspace` in schemaSlice) resets every workspace field to the fresh-import default, overlays the archive payload (theme/sidebarCollapsed deliberately NOT restored — personal prefs, not review record), re-runs the pipeline, and bumps `workspaceEpoch` — a transient counter that keys `<DiagramCanvas>` in App.tsx, so the import REMOUNTS the canvas and replays the page-refresh restore path (persisted positions + one-shot camera restore) against the imported layout. `PERSIST_VERSION` lives in [store/persistMigrate.ts](src/store/persistMigrate.ts) (not store/index.ts) so pure modules can import it without pulling in the zustand instance.

## HMR caveats

Vite + React Fast Refresh sometimes preserves React state across module replacements but doesn't re-run `useEffect([])`. When debugging cytoscape behavior, **don't trust HMR** — kill the dev server and use `bun run preview` against a fresh build. The Cytoscape canvas was previously instrumented with `window.__cy`/data-attribute debug hooks; both were removed once the pipeline stabilized. `<React.StrictMode>` is intentionally disabled in `src/main.tsx` because StrictMode's double-mount confused the cy lifecycle during development.

## Don't regenerate `.js` next to `.ts`

`tsc -b` was previously run without an `outDir`, which emitted `.js` files alongside their `.ts` siblings under `src/`. They're gone now. If you see `src/**/*.js` reappear, either restrict `tsc` to `--noEmit` for the project tsconfig or add an `outDir`; the build pipeline goes through `vite build` which doesn't need `tsc` emit output.

## Docs 目录约定

[docs/roadmap.md](docs/roadmap.md) = 下一阶段产品与工程计划；
[docs/release-readiness.md](docs/release-readiness.md) = 中期发版证据、冒烟场景与准入条件；
[docs/SQL_PARSER.md](docs/SQL_PARSER.md) = 解析器专项边界；
[docs/palette-professional.md](docs/palette-professional.md) = 配色设计记录。
逐轮交接日志不再作为文档源文件维护，历史事实进入 `CHANGELOG.md`，架构变更同步本文件。

## Samples

[src/samples.ts](src/samples.ts) ships `SAMPLE_ECOMMERCE` (loaded on first launch via the app effect in [App.tsx](src/App.tsx)) and `SAMPLE_BLOG`. The e-commerce sample intentionally has no explicit FKs to exercise the inference engine, and carries MySQL `COMMENT='...'` / inline `COMMENT '...'` to cover the comment-rendering code paths. When you add features touching comments or new inference rules, extend a sample so manual verification shows the behavior.
