# TODO: Fix Bugs

Tracking the 42 verified findings from the multi-agent review of the v0.2.0
interactive-canvas feature (`7be0c64...HEAD`).

**Status:** the 5 top findings, all 12 **P1 correctness** bugs, 10 of 20 **P3
cleanups**, and **P2 #5 (persist hardening)** are fixed and verified (typecheck
+ lint + 174 tests + build green; each batch passed an adversarial verify pass).
Shipped as **v0.2.1**. **P2 #3 (drag-path perf coalescing)** is now also fixed +
verified (single + group drag re-routed via one rAF flush/frame; preview +
Playwright drag, 0 console errors). The **manual-route dock-side flip** is now
fixed too (see Done log). What remains: **2 P2 altitude** items (routing — need
running-the-app verification) and **7 P3** items deferred with rationale below.

> Line numbers are from the pre-fix review and have drifted in `DiagramCanvas.tsx`
> (fixes added code); each item names its function/symbol so it stays findable.

---

## Remaining — P2: Altitude (depth / generalization)

- [ ] **Two divergent routers for "a card blocks the edge"** — `updateEdgeEndpoints.ts` (`liveRoute` gate) — *CONFIRMED*
  `detourRoute` (obstacle-avoiding, from current ports) runs only when `liveRoute` is true; the static/initial-layout/SVG-export pass instead docks to frozen dagre `dagreWaypoints`. Same problem solved two ways, selected by a session boolean — they can disagree visually for the same layout, and every routing fix must be made twice. Root cause behind export-vs-canvas routing divergence.
  **Fix:** always run `detourRoute`; demote dagre to ranking/placement only and retire the `dagreWaypoints` branch.

- [ ] **Side-bracket restricted to `gapX < 0` because obstacles exclude endpoints** — `updateEdgeEndpoints.ts` (`sideBracketRoute` gate) — *CONFIRMED*
  Tight side-by-side cards (small positive `gapX`) with a large vertical port offset fall to dagre/detour instead of the cleaner bracket — purely because `buildObstacles` can't include the endpoint card body for a crossing test, so the gap-sign gate is a call-site workaround.
  **Fix:** let `buildObstacles` optionally include an endpoint card's body (minus its port row); one bracket routine then serves stacked *and* tight side-by-side cases.

_(#3 syncPositions drag coalescing — **DONE**; see Done log. #5 persist
migrate/validation — **DONE** in v0.2.1; see Done log. Manual-route dock-side
flip — **DONE**; see Done log.)_

---

## Remaining — P3 cleanups (deferred, with rationale)

These were intentionally **not** done in the first cleanup pass — each is either
disproportionate effort/risk for the gain, or belongs with the P2 `syncPositions`
rework. Listed so they're not lost.

### Reuse / simplification
- [ ] **Prefix-retry block duplicates the lookup pipeline** — `inferForeignKeys.ts` (`pickBestTarget`).
  *Deferred:* the three resolution blocks (direct / prefix / tail) use **different** own-table filters, and the direct block's confidence tier depends on the candidate-array **length** — so a clean shared `resolveTarget` extraction is non-trivial and risks the (tested) inference logic for a moderate readability gain.
- [ ] **`mouseout edge` inlines the hide-handles timer** — `DiagramCanvas.tsx` (mount effect), duplicating `scheduleHideHandles`.
  *Deferred:* `scheduleHideHandles` is a render-scope closure; calling it from the once-bound mount-effect handler requires `useCallback`-stabilizing it and threading it into the `[]`-deps (or a ref) — churn/lint surface out of proportion to dedup of ~4 lines.
- [ ] **`effectiveForeignKeys` double-filters `deletedTables`** — `selectors.ts`.
  *Deferred:* the trailing `deletedTables` filter is **still required** for inferred FKs (`visibleSchema` only filters explicit ones); only the explicit FKs are filtered twice — cheap and harmless. Removing the redundancy touches multiple callers (export menu) for negligible gain.

### Efficiency (hot paths) — cluster with the P2 `syncPositions` rework
- [ ] **`buildObstacles` rebuilt per edge** — `updateEdgeEndpoints.ts`.
  *Deferred:* each edge excludes its **own** two endpoints, so a per-edge `Rect[]` is inherent; no asymptotic win without a larger redesign (e.g. an exclusion-aware obstacle index).
- [ ] **Every edge routed twice on fresh layout** — `DiagramCanvas.tsx`: `runLayout` emits `layoutstop` (routes all edges), then the rebuild effect calls `updateEdgeEndpoints` again.
  *Deferred:* low frequency (only on rebuild) and touches the delicate rebuild/`layoutstop` flow just stabilized by the P1 history fix — risk > value in isolation.
- [ ] **`syncPositions` rebuilds the whole array on pan/zoom** — `DiagramCanvas.tsx`.
  *Deferred / premise corrected:* overlay screen coords (`renderedBoundingBox`) **do** change on pan/zoom, so the array genuinely must rebuild; the only true waste is the per-node `colorForTableModule` lookup (color is pan/zoom-invariant). Best fixed inside the P2 `syncPositions` rework by caching color per node.
- [ ] **`TableOverlay` not memoized** — `overlay/TableOverlay.tsx`.
  *Deferred:* effective `React.memo` requires first stabilizing the per-node callbacks (`onDragHandle` etc. are fresh closures each render) via `useCallback` — a larger refactor; modest gain.

_(Per-node `position` handler rebuilding the obstacle map per event, and the
`manualRoutes` subscription read only via ref — both **DONE** with the P2 #3
coalescing pass; see Done log.)_

---

## Done (do not re-open)

**Top findings (round 1)** — `buildGraph.ts` volatile FK route key → content-derived
stable key · `onlyPk` ignored in box sizing / port docking · in-flight drag
listeners leaked on unmount · `resetHistory()` wiping undo on every FK decision ·
stale `focusId` greying out the canvas.

**P1 correctness (×12)** — search order re-derived on drag/layout + cursor
preserved across reorder · `Enter` defers step until fresh matches land
(`pendingSearchStep`) · camera centers only on click-focus, not search typing ·
undo restores snapshot routing mode (`manualMove`) · `collapseAll` skips
recycle-binned tables · `setManualRoute` rejects empty/degenerate routes · `_ref`
reason cleaned up · cold-start match order · `routePoints` parse guarded ·
degenerate drag frame skipped · viewport restored verbatim · timer guards
`!== null` (falsy-zero safe) + cleared on unmount.

**P3 cleanups (×10)** — `routePoints` & endpoint string codecs unified in
`channelRoute.ts` · `nodeId` shared dependency-free module (keeps cytoscape out
of the store bundle) · `undo`/`redo` → shared `step()` · `PILL` → shared
`pill.ts` · four `manualRoutes` reducers → `filterRoutes()` · `clampPan` →
pure tested `clampPanAxis` · `stripFkSuffix` bare-key guard restored · match-sort
reads positions once · `capturePositions` (no full-snapshot clone in
`persistLayout`). *(#8 "searchActiveIndex reset in 3 sites" was obviated by the
P1 `setSearchMatches` rewrite.)*

**P2 altitude (×1)** — #5 persist hardening: `migrate` (version mismatch → keep
`rawSql`) + a `merge`-stage shape guard that validates every persisted field on
every load and drops malformed ones to defaults (catches same-version drift,
which `migrate` never sees). Dependency-free `persistMigrate.ts`. Shipped v0.2.1.

**P2 altitude (×1, post-v0.2.1)** — #3 drag-path perf: the cy `position node`
hot path is now rAF-coalesced to one flush/frame — a group drag of *k* cards
does one overlay-array rebuild + one `updateEdgeEndpoints` over the union of
incident edges (one obstacle-map pass) instead of *k* of each; rAF cancelled on
unmount. Folds in two deferred P3 items: per-node `position` handler no longer
rebuilds the obstacle map per event, and the `manualRoutes` subscription was
dropped (read fresh via `useApp.getState()`, no re-render on route edits).
pan/zoom/layoutstop/add-remove kept synchronous (no relayout flash / pan lag).
Verified: typecheck + lint + 174 tests + build green, plus preview + Playwright
single- and group-drag (rigid move, edges re-dock to field ports, 0 console
errors).

**P2 altitude (×1, post-v0.2.1)** — manual-route dock-side flip: the live
per-frame reroute (`flushDrag`) now ignores manual overrides while a card drag is
active (`nodeDraggingRef` in `DiagramCanvas.tsx`), so a hand-edited route can no
longer re-dock and flip its port side as the card center crosses the stored
`override[0].x` mid-drag. On release the existing clear + re-route runs unchanged.
Lightweight — no persisted-shape change, no `PERSIST_VERSION` bump — chosen over
persisting `srcSide`/`tgtSide` (which would have needed a version bump +
`persistMigrate` extension for cases the symptom never reached: resize/reload
don't trigger the flip). Verified: typecheck + lint + 174 tests + build green,
plus a preview + Playwright card-drag smoke (card moves across its original
port-x, 0 console errors). The flip repro itself isn't drivable via Playwright —
cy canvas hit-testing ignores synthetic mouse events, so an edge-handle drag (to
create a manual route) can't be simulated.

**Tests added:** `buildGraph.test.ts`, `searchMatches.test.ts`,
`canvasSlice.test.ts`, `clampPan.test.ts`, `persistMigrate.test.ts`
(140 → 174 tests).
