# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
1. **Name suffix**: column ending in `_id` / `Id`. Strip the suffix to get a base. [nameMatching.ts](src/infer/nameMatching.ts) generates candidate target names by varying singular/plural and stripping `t_`/`tbl_`/`tb_` prefixes.
2. **Type compatibility**: source column's normalized type must match target PK's. `unknown` matches anything.
3. **Index priority**: when multiple targets tie, prefer the one where the source column is indexed/unique.
4. **Confidence tiers**: `high` (exact name + type + source indexed) / `medium` (name+type only, or prefix normalization needed) / `low` (compound-prefix fallback like `parent_user_id → users`). `low` is hidden from the canvas unless the user toggles `showLowConfidence` or accepts the FK explicitly.

Explicit FKs from the parser are merged with inferred ones via the helper `effectiveForeignKeys` in [store.ts](src/store.ts); `decisions[fkKey]` overrides confidence-based visibility (accept = always show; reject = always hide).

### `src/diagram/`
Cytoscape draws layout + edges only. **Nodes are invisible**: the React component [DiagramCanvas.tsx](src/diagram/DiagramCanvas.tsx) renders each table as an absolutely-positioned HTML overlay synced to the cy node's `renderedBoundingBox` via `pan zoom resize position layoutstop add remove` events.

Why overlays instead of cy native labels: cy's `text-wrap: wrap` + `width: 'label'` interaction was unreliable with multi-line table content; box-drawing chars and column rows didn't measure correctly. The overlay approach gives full HTML/CSS control and works at all zoom levels (zoom is locked to 1.0 after layout — `runLayout` resets `cy.zoom(1)` so overlay text stays crisp; the user wheel-zooms after).

**Tri-state selection** (search OR click focus): a single `Selection = { matches, neighborhood } | null` drives both:
- cy edge classes: `highlight` on edges touching a match, `dimmed` on edges with neither endpoint in the neighborhood.
- overlay class: match → amber ring; in neighborhood (not match) → neutral; outside neighborhood → 30% opacity.

Search matches against table name, table comment, column names, and column comments. If `focusId` is set (click on overlay) it overrides search; clicking blank canvas clears it.

`[buildGraph.ts](src/diagram/buildGraph.ts)` computes per-node `boxWidth` / `boxHeight` from the table's longest column line + whether the table has a comment (adds one subtitle row). The overlay reads these via the synced bounding box.

### `src/store.ts`
Zustand. `setSql(sql)` is the entry into the pipeline: re-parses + re-infers + clears decisions. `effectiveForeignKeys` is the derived selector used by both the canvas and the export-to-DDL code.

### `src/ui/` (UI shell)
Organized by the user's mental model of the screen — split into two physical layers:

- **`src/ui/overlays/`** — floating UI above the canvas: `Toolbar`, `ExportMenu`, `SqlInputDialog`, plus `icons.tsx` for the toolbar's inline SVGs.
- **`src/ui/sidebar/`** — left-side control panel: `Sidebar` (the shell + `CollapsedSidebarRail` + `GroupHeading`), `DisplayControls`, `InferencePanel`, `ModulesPanel`, `AccordionSection`, plus `icons.tsx` for sidebar-specific glyphs.
- **`src/ui/theme/`** — `useApplyTheme` hook reading `display.themePreference` from the store and toggling the `dark` class on `<html>`.

The export menu calls `getCy()` from `diagram/cyHandle` (bound by `DiagramCanvas` on mount; cleared on unmount) to grab the cy instance for `cy.png({ full: true, scale: 2 })`. DDL export builds `ALTER TABLE ADD CONSTRAINT` lines from `effectiveForeignKeys` filtered to `source === 'inferred'`.

## HMR caveats

Vite + React Fast Refresh sometimes preserves React state across module replacements but doesn't re-run `useEffect([])`. When debugging cytoscape behavior, **don't trust HMR** — kill the dev server and use `npm run preview` against a fresh build. The Cytoscape canvas was previously instrumented with `window.__cy`/data-attribute debug hooks; both were removed once the pipeline stabilized. `<React.StrictMode>` is intentionally disabled in `src/main.tsx` because StrictMode's double-mount confused the cy lifecycle during development.

## Don't regenerate `.js` next to `.ts`

`tsc -b` was previously run without an `outDir`, which emitted `.js` files alongside their `.ts` siblings under `src/`. They're gone now. If you see `src/**/*.js` reappear, either restrict `tsc` to `--noEmit` for the project tsconfig or add an `outDir`; the build pipeline goes through `vite build` which doesn't need `tsc` emit output.

## Samples

[src/samples.ts](src/samples.ts) ships `SAMPLE_ECOMMERCE` (loaded on first launch via the app effect in [App.tsx](src/App.tsx)) and `SAMPLE_BLOG`. The e-commerce sample intentionally has no explicit FKs to exercise the inference engine, and carries MySQL `COMMENT='...'` / inline `COMMENT '...'` to cover the comment-rendering code paths. When you add features touching comments or new inference rules, extend a sample so manual verification shows the behavior.
