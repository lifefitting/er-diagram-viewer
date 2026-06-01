# TODO: Fix Bugs

Tracking the 42 verified findings from the multi-agent review of the v0.2.0
interactive-canvas feature (`7be0c64...HEAD`).

**Status:** the 5 top findings, all 12 **P1 correctness** bugs, and 10 of 20
**P3 cleanups** are fixed and verified (typecheck + lint + 165 tests + build
green; each batch passed an adversarial verify pass). What remains: **5 P2
altitude** items and **10 P3** items deferred with rationale below.

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

- [ ] **`syncPositions` registered 4× and rebuilds the full array per moved node** — `DiagramCanvas.tsx` — *CONFIRMED*
  Bound to `pan zoom resize`, `position node`, `layoutstop`, and `add remove`. A group drag of *k* cards fires `position` *k×* per frame (cy `batch` defers only renderer notifications, not user events), each rebuilding the full `NodePos[]` and re-running the per-node `updateEdgeEndpoints` obstacle map.
  **Fix:** coalesce position handling to once per frame (rAF/throttle) and rebuild the array once. **This is the anchor for several deferred P3 perf items — see below.**

- [ ] **Manual-route dock side re-derived heuristically, can flip mid-move** — `updateEdgeEndpoints.ts` — *PLAUSIBLE*
  The override branch recomputes the port dock side from the stored route's first point vs the live card center on every redock. Dragging a card whose center crosses `override[0].x` flips left/right and snaps the hand-tuned path across the card mid-drag (transient; resize does *not* trigger it).
  **Fix:** persist the dock side in the `manualRoutes` entry instead of re-deriving from stale coords.

- [ ] **Persist `version` bumped to 2 with no `migrate`/validation** — `store/index.ts` — *PLAUSIBLE*
  Denylist `partialize` persists everything not denied, with no `migrate` and no rehydration shape-check. A future shape drift under the same version loads stale `nodePositions`/`manualRoutes`/`viewport` directly (mis-placed cards / off-screen camera) until 重置布局. Internally consistent today.
  **Fix:** add a `migrate` step and a light shape-guard on rehydrate.

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
- [ ] **Per-node `position` handler rebuilds full obstacle map** — `DiagramCanvas.tsx`.
  *Deferred:* overlaps the P2 item; the clean fix needs an `updateEdgeEndpoints` signature change to accept a prebuilt obstacle map (cache `rectById` per frame).
- [ ] **`manualRoutes` subscribed but only read via ref** — `DiagramCanvas.tsx`.
  *Deferred:* the subscription keeps `manualRoutesRef` fresh for the mount-bound handlers; removing it means switching all ref reads to `getState()` — doable, but it's behavior-adjacent (removes re-renders), so better grouped with the P2 perf pass.

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

**Tests added:** `buildGraph.test.ts`, `searchMatches.test.ts`,
`canvasSlice.test.ts`, `clampPan.test.ts` (140 → 165 tests).
