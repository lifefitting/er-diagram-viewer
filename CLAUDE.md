# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Explicit FKs from the parser are merged with inferred ones via the helper `effectiveForeignKeys` in [store/selectors.ts](src/store/selectors.ts); `decisions[fkKey]` overrides confidence-based visibility (accept = always show; reject = always hide).

### `src/diagram/`
Cytoscape draws layout + edges only. **Nodes are invisible**: the React component [DiagramCanvas.tsx](src/diagram/DiagramCanvas.tsx) renders each table as an absolutely-positioned HTML overlay synced to the cy node's `renderedBoundingBox` via `pan zoom resize position layoutstop add remove` events.

Why overlays instead of cy native labels: cy's `text-wrap: wrap` + `width: 'label'` interaction was unreliable with multi-line table content; box-drawing chars and column rows didn't measure correctly. The overlay approach gives full HTML/CSS control and works at all zoom levels. After auto-layout, `runLayout`'s `fitWithZoomClamp` fits-to-content but **floors zoom at 1.0** so the first paint never blurs; the user then wheel-zooms (continuous) or steps a fixed ladder (`ZOOM_STOPS` 0.25→4 in `CanvasControls`). The only path that drops below 1.0 is the explicit 全览/fit (`cy.fit` with no clamp). Overlays are synced to each node's `renderedBoundingBox` via `cy.on('pan zoom resize position layoutstop add remove', …)`.

**Tri-state selection** (search OR click focus): a single `Selection = { matches, neighborhood } | null` (built in [selection/deriveSelection.ts](src/diagram/selection/deriveSelection.ts) + [closedNeighborhood.ts](src/diagram/selection/closedNeighborhood.ts)) drives both:
- cy edge classes: `highlight` on edges touching a match, `dimmed` on edges with neither endpoint in the neighborhood.
- overlay class: match → amber ring; in neighborhood (not match) → neutral; outside neighborhood → 30% opacity.

Search matches against table name, table comment, column names, and column comments. Matched substrings also get a Chrome-style yellow `<mark>` via [overlay/highlight.tsx](src/diagram/overlay/highlight.tsx). If `focusId` is set (click on overlay) it overrides search; clicking blank canvas clears it.

**Find-style match navigation**: the canvas publishes the ordered match node ids (sorted top→bottom, left→right) to `store.searchMatchIds`; the toolbar shows an "n / m" counter and `Enter`/`Shift+Enter` (or ▲▼) call `cycleSearchMatch(±1)` to step `searchActiveIndex`. A `searchActiveIndex` effect calls the view's `centerOnNode` to pan-follow the active match, which also gets a stronger ring (`activeMatch` on the overlay). `searchMatchIds`/`searchActiveIndex` are transient (denylisted from persist); the pure wraparound math is `store/searchNav.ts`.

`[buildGraph.ts](src/diagram/buildGraph.ts)` computes per-node `boxWidth` / `boxHeight` from the table's longest column line + whether the table has a comment (adds one subtitle row), and assigns each FK edge a stable `fkKey` (table+column based) so manual routes survive rebuilds. The overlay reads sizes via the synced bounding box.

**Connector routing** (`routing/`): edges are orthogonal polylines, not cytoscape curves. `arrangeForPublication` ([layout/](src/diagram/layout/arrangeForPublication.ts)) ranks tables left-to-right with dagre and stashes channel waypoints; on `layoutstop`, [updateEdgeEndpoints.ts](src/diagram/routing/updateEdgeEndpoints.ts) docks each edge to its field-row port and picks a strategy from [channelRoute.ts](src/diagram/routing/channelRoute.ts) — a direct 2-bend H-V-H through the gutter, a Dijkstra **detour** when blocked, or a **side-bracket** for vertically-stacked cards (`gapX < 0`) — then encodes the path as `routePoints` (read by both the canvas and the SVG export). Dragging a card clears its edges' manual overrides and re-routes live. [overlay/RouteHandles.tsx](src/diagram/overlay/RouteHandles.tsx) lets the user drag a segment's midpoint; the hand-edited path is saved to `manualRoutes` and survives rebuilds. (The old closed-form `computeSegments` module was removed in favor of `channelRoute`.) Each edge is colored by its source table's module `header` color (`data(color)`), which is tuned for the light canvas; in dark mode `applyEdgeTheme` (DiagramCanvas) swaps the stroke to a lightness-floored `data(colorDark)` (computed by [edgeColor.ts](src/diagram/edgeColor.ts)) so dark palettes like `mono` stay visible — the dark SVG/PNG export uses `colorDark` for the same reason, while light mode/exports keep `color`.

**Canvas interaction**: `canvasMode` is `'select'` (marquee + multi-select) or `'pan'` (hand tool; Space-drag and middle-mouse pan in either mode). [selection/marquee.ts](src/diagram/selection/marquee.ts) and [selection/dragGroup.ts](src/diagram/selection/dragGroup.ts) are pure helpers for rubber-band selection and group-move math. [cyHandle.ts](src/diagram/cyHandle.ts) holds the cy instance, an imperative view API (`fit` / `resetZoom` / `zoomToSelection` / `relayout`, bound by the canvas on mount), and a **session-only** undo/redo stack of `LayoutSnapshot`s (positions + widths + routes, cap 50; never persisted).

**Recycle bin**: Delete/Backspace marks tables in `deletedTables`; `visibleSchema` (in [store/selectors.ts](src/store/selectors.ts)) filters those tables and their FKs out of the canvas and every export. [overlay/RecycleBin.tsx](src/ui/overlays/RecycleBin.tsx) (bottom-left) restores them. The SQL is never touched.

### `src/store/`
Zustand, split into slices assembled in [index.ts](src/store/index.ts): `schemaSlice` (rawSql / schema / inferred / modules), `decisionsSlice` (per-FK accept/reject), `displaySlice` (field-display toggles / search / theme — **no** layout-kind field; the layout picker was removed), `canvasSlice` (collapse / `tableWidths` / `nodePositions` / `manualRoutes` / `deletedTables` / `canvasMode` / flash), `historySlice` (undo/redo flags), plus `selectors.ts` (`effectiveForeignKeys`, `visibleSchema`). [pipeline.ts](src/store/pipeline.ts) runs `parseSql → mergeShardedTables → inferForeignKeys → inferModules`.

`setSql(sql)` is the entry into the pipeline (re-parse + re-infer; **clears** layout — positions, manual routes, deleted tables — for a fresh start). `reparse()` re-derives schema from the persisted `rawSql` on reload but **keeps** the user's layout.

Persistence: the `persist` middleware writes to **sessionStorage** (key `er-viewer:state:v1`, `version: 2`) using a **denylist** (`DERIVED_OR_TRANSIENT_FIELDS`) rather than an allowlist. Derived data (`schema`/`inferred`/`modules`) and transient state (`search`, `canvasMode`, `canUndo`/`canRedo`, `flashTables`/`flashTick`) are NOT saved. So a refresh restores `rawSql` + decisions + display + theme + node positions + widths + manual routes + recycle bin + **camera (`viewport` = pan/zoom)**, but **search clears and pan-mode resets to `select`**. The `viewport` restore (DiagramCanvas debounced `cy.on('pan zoom')` save → one-shot restore in the rebuild effect via `clampPan`) is what makes a refresh reproduce the *exact* prior screen, not just the node positions. sessionStorage (not localStorage) is deliberate: imported DDL may be real production schema, so it must not linger on disk past the tab.

### `src/ui/` (UI shell)
Organized by the user's mental model of the screen — split into physical layers:

- **`src/ui/overlays/`** — floating UI above the canvas: `Toolbar` (top bar), `CanvasControls` (bottom-right pill cluster: undo/redo · hand tool · zoom ladder · view menu with 缩放至100%/全览/缩放到选中/重置布局/全屏), `RecycleBin` (bottom-left; restores deleted tables), `ExportMenu`, `SqlInputDialog`, plus `icons.tsx`.
- **`src/ui/sidebar/`** — left-side control panel: `Sidebar` (the shell + `CollapsedSidebarRail` + `GroupHeading`), `DisplayControls`, `InferencePanel`, `ModulesPanel`, `AccordionSection`, plus `icons.tsx` for sidebar-specific glyphs.
- **`src/ui/theme/`** — `useApplyTheme` hook reading `theme` from the store and toggling the `dark` class on `<html>`.

The export menu calls `getCy()` from `diagram/cyHandle` (bound by `DiagramCanvas` on mount; cleared on unmount) to grab the cy instance for `cy.png({ full: true, scale: 2 })`. Exports run against `visibleSchema`, so recycle-binned tables and their FKs are excluded; SVG export reuses each edge's `routePoints` so the file matches the on-screen routing. DDL export builds `ALTER TABLE ADD CONSTRAINT` lines from `effectiveForeignKeys` filtered to `source === 'inferred'`.

## HMR caveats

Vite + React Fast Refresh sometimes preserves React state across module replacements but doesn't re-run `useEffect([])`. When debugging cytoscape behavior, **don't trust HMR** — kill the dev server and use `npm run preview` against a fresh build. The Cytoscape canvas was previously instrumented with `window.__cy`/data-attribute debug hooks; both were removed once the pipeline stabilized. `<React.StrictMode>` is intentionally disabled in `src/main.tsx` because StrictMode's double-mount confused the cy lifecycle during development.

## Don't regenerate `.js` next to `.ts`

`tsc -b` was previously run without an `outDir`, which emitted `.js` files alongside their `.ts` siblings under `src/`. They're gone now. If you see `src/**/*.js` reappear, either restrict `tsc` to `--noEmit` for the project tsconfig or add an `outDir`; the build pipeline goes through `vite build` which doesn't need `tsc` emit output.

## Samples

[src/samples.ts](src/samples.ts) ships `SAMPLE_ECOMMERCE` (loaded on first launch via the app effect in [App.tsx](src/App.tsx)) and `SAMPLE_BLOG`. The e-commerce sample intentionally has no explicit FKs to exercise the inference engine, and carries MySQL `COMMENT='...'` / inline `COMMENT '...'` to cover the comment-rendering code paths. When you add features touching comments or new inference rules, extend a sample so manual verification shows the behavior.
