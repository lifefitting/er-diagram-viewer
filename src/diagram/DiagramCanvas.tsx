import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import {
  buildElements,
  buildFkSourceColumns,
  nodeId,
  tableBoxSize,
  MIN_WIDTH,
  DRAG_MAX_WIDTH,
} from './buildGraph';
import { buildStylesheet } from './style';
import { useApp, effectiveForeignKeys, visibleSchema } from '../store';
import type { Table } from '../parser/types';
import { colorForTableModule, type ModulesResult } from '../infer/inferModules';
import {
  bindView,
  unbindView,
  bindHistory,
  seedHistory,
  resetHistory,
  pushHistory,
  getIsApplying,
  getView,
  type LayoutSnapshot,
} from './cyHandle';
import type { NodePos, OverlayState, Selection } from './types';
import { TableOverlay } from './overlay/TableOverlay';
import { RouteHandles } from './overlay/RouteHandles';
import { runLayout } from './layout/runLayout';
import { updateEdgeEndpoints } from './routing/updateEdgeEndpoints';
import { dragSegment, segmentsFromPoints, type Pt } from './routing/channelRoute';
import { deriveFocusSelection, deriveSearchSelection } from './selection/deriveSelection';
import { resolveDragGroup, toggleSelected } from './selection/dragGroup';
import { normalizeRect, nodesInMarquee, type Rect } from './selection/marquee';
import { TrashIcon } from '../ui/overlays/icons';
import { useResolvedTheme } from '../ui/theme/useApplyTheme';

/**
 * On the dark canvas, dark palette edge colors (mono, earth, darker vibrant)
 * are nearly invisible, so swap each edge's stroke to its precomputed
 * `colorDark` bypass; in light mode remove the bypass so it falls back to the
 * stylesheet `data(color)`. Bypass beats the stylesheet but leaves the
 * highlight/dimmed opacity+width classes untouched.
 */
function applyEdgeTheme(cy: Core, isDark: boolean): void {
  cy.batch(() => {
    cy.edges().forEach((e) => {
      if (isDark) {
        const c = (e.data('colorDark') as string) || (e.data('color') as string);
        e.style({ 'line-color': c, 'target-arrow-color': c });
      } else {
        e.removeStyle('line-color target-arrow-color');
      }
    });
  });
}

/**
 * Snapshot the editable layout: MODEL-space card positions (n.position(), NOT
 * renderedBoundingBox — the latter is zoom/pan dependent and would restore
 * wrong) plus a clone of the current width overrides.
 */
function captureSnapshot(cy: Core, widths: Record<string, number>): LayoutSnapshot {
  const positions: Record<string, { x: number; y: number }> = {};
  cy.nodes('[type = "table"]').forEach((n) => {
    const p = n.position();
    positions[n.id()] = { x: p.x, y: p.y };
  });
  return { positions, widths: { ...widths }, routes: { ...useApp.getState().manualRoutes } };
}

/** Write the current card positions into the store so a page refresh restores
 *  this arrangement (only the 重置布局 button / a new import re-layouts). */
function persistLayout(cy: Core): void {
  useApp.getState().setNodePositions(captureSnapshot(cy, {}).positions);
}

/**
 * Recycle-bin the given table nodes: drop the manual-route overrides for every
 * edge touching them (so a restore gets a fresh auto-route, never a stale
 * re-dock) and mark them hidden. The SQL is never touched. The caller clears
 * the selection afterward.
 */
function hideTables(cy: Core, ids: string[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const fkKeys: string[] = [];
  cy.edges().forEach((e) => {
    if (idSet.has(e.source().id()) || idSet.has(e.target().id())) {
      const k = e.data('fkKey') as string | undefined;
      if (k) fkKeys.push(k);
    }
  });
  if (fkKeys.length) useApp.getState().clearManualRoutesForNode(fkKeys);
  useApp.getState().deleteTables(ids);
}

/** Keep at least this many px of the diagram within the viewport when panning. */
const PAN_MARGIN = 120;

/**
 * Clamp a desired pan so the content's bounding box can never be dragged fully
 * off-screen — at least `PAN_MARGIN` px of it always stays in view. Without this
 * a single fast drag flings the whole diagram into the void ("content vanished,
 * can't find it"). Returns the pan unchanged when there are no elements.
 */
function clampPan(cy: Core, pan: { x: number; y: number }): { x: number; y: number } {
  const els = cy.elements();
  if (els.empty()) return pan;
  const bb = els.boundingBox();
  const z = cy.zoom();
  // content rendered span on an axis = [c1*z + p, c2*z + p]; keep the far edge
  // ≥ MARGIN inside one side and the near edge ≤ size − MARGIN from the other.
  const clampAxis = (p: number, c1: number, c2: number, size: number) => {
    const min = PAN_MARGIN - c2 * z;
    const max = size - PAN_MARGIN - c1 * z;
    return min > max ? p : Math.max(min, Math.min(max, p));
  };
  return {
    x: clampAxis(pan.x, bb.x1, bb.x2, cy.width()),
    y: clampAxis(pan.y, bb.y1, bb.y2, cy.height()),
  };
}

export function DiagramCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const rawSchema = useApp((s) => s.schema);
  const inferred = useApp((s) => s.inferred);
  const decisions = useApp((s) => s.decisions);
  const display = useApp((s) => s.display);
  const search = useApp((s) => s.search);
  const modules = useApp((s) => s.modules);
  const collapsed = useApp((s) => s.collapsed);
  const tableWidths = useApp((s) => s.tableWidths);
  const flashTables = useApp((s) => s.flashTables);
  const flashTick = useApp((s) => s.flashTick);
  const clearFlash = useApp((s) => s.clearFlash);
  const toggleCollapsed = useApp((s) => s.toggleCollapsed);
  const setTableWidth = useApp((s) => s.setTableWidth);
  const canvasMode = useApp((s) => s.canvasMode);
  const deletedTables = useApp((s) => s.deletedTables);
  const manualRoutes = useApp((s) => s.manualRoutes);
  const setSearchMatches = useApp((s) => s.setSearchMatches);
  const searchMatchIds = useApp((s) => s.searchMatchIds);
  const searchActiveIndex = useApp((s) => s.searchActiveIndex);
  const isDark = useResolvedTheme() === 'dark';

  // The schema actually drawn: recycle-bin'd tables (+ their edges) filtered out.
  // Everything downstream keys off this, never the raw `schema`.
  const schema = useMemo(() => visibleSchema(rawSchema, deletedTables), [rawSchema, deletedTables]);

  const [positions, setPositions] = useState<NodePos[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Explicit multi-select group for manual layout: the set of cards that drag
  // together. Separate from `focusId` (which drives the FK-neighborhood
  // highlight) so additive selection never moves the camera or re-dims edges.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Rubber-band selection box (viewport px) while the user drags on empty
  // canvas; null when no marquee is in progress.
  const [marquee, setMarquee] = useState<Rect | null>(null);
  // True while Space is held — turns an empty-canvas drag into a pan instead of
  // a marquee, and swaps the cursor to a grab hand.
  const [spaceHeld, setSpaceHeld] = useState(false);
  // True for the duration of an active pan drag (grabbing cursor).
  const [panning, setPanning] = useState(false);
  // The edge currently showing route-edit handles (hover, or held during a
  // segment drag). At most one edge's handles are ever shown.
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  // Bumped during a segment drag to re-render the handles from the live route.
  const [, bumpRouteTick] = useState(0);
  const draggingEdgeRef = useRef(false);
  // Delayed-hide timer so moving the cursor from the thin edge onto a handle
  // dot doesn't drop the handles mid-reach.
  const hideHandlesTimer = useRef<number | null>(null);

  const tableById = useMemo(() => {
    const m = new Map<string, Table>();
    if (schema) for (const t of schema.tables) m.set(nodeId(t.name), t);
    return m;
  }, [schema]);

  const effectiveFks = useMemo(
    () =>
      schema
        ? effectiveForeignKeys(schema, inferred, decisions, display.showLowConfidence, deletedTables)
        : [],
    [schema, inferred, decisions, display.showLowConfidence, deletedTables],
  );

  /** table.name → Set of column names that act as FK source. Drives the FK badge. */
  const fkSourceColumns = useMemo(() => buildFkSourceColumns(effectiveFks), [effectiveFks]);

  const searchSelection = useMemo<Selection>(
    () => deriveSearchSelection(schema, effectiveFks, search),
    [schema, effectiveFks, search],
  );

  const focusSelection = useMemo<Selection>(
    () => deriveFocusSelection(schema, effectiveFks, focusId),
    [schema, effectiveFks, focusId],
  );

  // Focus takes precedence over search when both are active.
  const selection: Selection = focusSelection ?? searchSelection;

  // Publish the ordered list of search matches for find-style navigation. Sort
  // by on-canvas reading order (top→bottom, then left→right) so pressing Enter
  // walks the diagram naturally; the toolbar reads this list for its "n / m"
  // counter. Resets the active cursor whenever the match set changes.
  useEffect(() => {
    const matches = searchSelection?.matches;
    if (!matches || matches.size === 0) {
      setSearchMatches([]);
      return;
    }
    const ids = Array.from(matches);
    const cy = cyRef.current;
    if (cy) {
      ids.sort((a, b) => {
        const pa = cy.getElementById(a).position();
        const pb = cy.getElementById(b).position();
        return pa.y - pb.y || pa.x - pb.x;
      });
    }
    setSearchMatches(ids);
  }, [searchSelection, setSearchMatches]);

  // Follow the active match: pan (keeping zoom) so it's centered. Only fires
  // once the user steps into the results (Enter / nav buttons → index ≥ 0), so
  // the camera never jumps around while typing.
  useEffect(() => {
    if (searchActiveIndex < 0) return;
    const id = searchMatchIds[searchActiveIndex];
    if (id) getView()?.centerOnNode(id);
  }, [searchActiveIndex, searchMatchIds]);

  const activeMatchId = searchActiveIndex >= 0 ? (searchMatchIds[searchActiveIndex] ?? null) : null;

  // Recolor edges when the theme flips (no element rebuild). Dark mode swaps to
  // the visible `colorDark`; light mode reverts to the stylesheet `color`.
  useEffect(() => {
    const cy = cyRef.current;
    if (cy) applyEdgeTheme(cy, isDark);
  }, [isDark]);

  // Refs for use inside cy event handlers (which are bound once on mount).
  const tableByIdRef = useRef(tableById);
  tableByIdRef.current = tableById;
  const modulesRef = useRef<ModulesResult>(modules);
  modulesRef.current = modules;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const displayRef = useRef(display);
  displayRef.current = display;
  // Mirror so the rebuild effect can theme freshly-built edges without taking
  // `isDark` as a dep (a theme toggle must not trigger a full element rebuild).
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  // True once the user has manually moved a card. Flips edge routing from the
  // static dagre channels to a live obstacle-avoiding detour so dragged
  // connectors follow the nodes instead of snapping to frozen layout-time
  // waypoints; reset to false whenever a fresh layout runs (so the pristine
  // publication look + SVG export stay byte-stable until something is moved).
  const manualMoveRef = useRef(false);
  // Mirrors for the mount-bound view/history closures (zoom-to-selection,
  // snapshot capture/apply) so they read live state without re-binding.
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const tableWidthsRef = useRef(tableWidths);
  tableWidthsRef.current = tableWidths;
  const manualRoutesRef = useRef(manualRoutes);
  manualRoutesRef.current = manualRoutes;
  // Whether the persisted camera has already been applied for THIS cy instance.
  // A fresh mount (refresh / remount) re-arms it; mid-session rebuilds must not
  // snap the camera back.
  const viewportRestoredRef = useRef(false);

  // Mount cytoscape once.
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      // Edges use `curve-style: segments` with the bend points hand-placed by
      // updateEdgeEndpoints. The bends come from arrangeForPublication's
      // dagre channel waypoints (orthogonalised through node-free gutters),
      // so no connector crosses a card body.
      style: buildStylesheet(),
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 4,
      boxSelectionEnabled: false,
      // Empty-canvas drag is reserved for marquee selection (handled by our own
      // mousedown below), so cytoscape's drag-to-pan is off. Wheel input is
      // likewise intercepted (pan on scroll, zoom on pinch) by the `wheel`
      // listener wired up in this effect, so cytoscape's own wheel-zoom is off
      // too. Panning/zooming still happen programmatically (CanvasControls,
      // module flash, fit) — those flags only gate *user* input, not the API.
      userPanningEnabled: false,
      userZoomingEnabled: false,
    });
    cyRef.current = cy;
    viewportRestoredRef.current = false; // fresh instance → re-arm the camera restore

    // Persist the camera (pan + zoom) so a refresh restores the exact on-screen
    // view, not just node positions. Debounced + reads LIVE cy.pan()/cy.zoom()
    // at fire time, so transient values during mount/restore/animation coalesce
    // to a single write of the settled camera. Captures every change uniformly:
    // the initial fit, 重置布局, fit/zoom-to-selection/center-on-node, and user
    // wheel/drag pan.
    let saveTimer: number | undefined;
    const saveViewport = () => {
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = undefined;
        const p = cy.pan();
        useApp.getState().setViewport({ x: p.x, y: p.y, zoom: cy.zoom() });
      }, 200);
    };

    // Each mount supplies its OWN cy-bound relayout closure. The closure
    // captures `cy` directly so it cannot drift to a stale instance even if
    // the canvas remounts. This is the React-idiomatic alternative to a
    // module-level cytoscape singleton (see review P2): the toolbar still
    // reaches in via `cyHandle.relayoutCurrent()` for one-line ergonomics,
    // but the bind/unbind lifecycle is now strictly tied to mount/unmount.
    // Imperative view + history closures, bound into cyHandle so CanvasControls
    // and the keyboard shortcuts drive the canvas without importing cytoscape.
    const fitImpl = () => cy.fit(undefined, 60);
    const resetZoomImpl = () =>
      cy.zoom({ level: 1, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    const zoomToSelectionImpl = () => {
      const ids = selectedIdsRef.current;
      if (ids.size === 0) return; // no-op when nothing is multi-selected
      const eles = cy.nodes().filter((n) => ids.has(n.id()));
      if (eles.empty()) return;
      cy.animate({ fit: { eles, padding: 80 } }, { duration: 250, easing: 'ease-in-out' });
    };
    const centerOnNodeImpl = (id: string) => {
      const n = cy.getElementById(id);
      if (!n || n.empty()) return; // matched node may have been deleted/rebuilt
      cy.animate({ center: { eles: n } }, { duration: 250, easing: 'ease-in-out' });
    };
    const applySnapshot = (snap: LayoutSnapshot) => {
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          const p = snap.positions[n.id()];
          if (p) n.position(p);
        });
      });
      manualMoveRef.current = true;
      // Restore the hand-edited connector routes too, so undo/redo of a route
      // edit works. Pass snap.routes straight into the reroute (the ref mirror
      // won't reflect the store update synchronously within this closure).
      useApp.getState().replaceManualRoutes(snap.routes);
      // Reconcile width overrides: clear any absent from the snapshot, set the
      // rest. setTableWidth drives the resize effect (re-applies boxWidth +
      // reroutes); the immediate reroute below covers the position-only case.
      // Reached via getState() so this once-bound closure has no stale dep.
      const setWidth = useApp.getState().setTableWidth;
      for (const name of Object.keys(tableWidthsRef.current)) {
        if (!(name in snap.widths)) setWidth(name, null);
      }
      for (const name of Object.keys(snap.widths)) {
        setWidth(name, snap.widths[name]);
      }
      updateEdgeEndpoints(
        cy,
        cy.edges(),
        collapsedRef.current,
        tableByIdRef.current,
        displayRef.current,
        manualMoveRef.current,
        snap.routes,
      );
      cy.trigger('resize');
      // The restored layout is now current — persist it so a refresh keeps it.
      useApp.getState().setNodePositions(snap.positions);
    };
    const relayout = () => {
      if (cy.nodes().length === 0) return;
      // A fresh layout re-canonicalises positions → static channels again, and
      // is a hard history reset (can't undo past a relayout).
      manualMoveRef.current = false;
      useApp.getState().clearAllManualRoutes(); // hand-edited routes are meaningless after re-layout
      runLayout(cy);
      persistLayout(cy); // 重置布局 saves the new auto-layout so refresh keeps it
      resetHistory();
      seedHistory(captureSnapshot(cy, tableWidthsRef.current));
    };
    bindView({
      cy,
      relayout,
      fit: fitImpl,
      resetZoom: resetZoomImpl,
      zoomToSelection: zoomToSelectionImpl,
      centerOnNode: centerOnNodeImpl,
      getZoom: () => cy.zoom(),
      onZoomChange: (cb) => {
        cy.on('zoom', cb);
        return () => cy.off('zoom', cb);
      },
    });
    bindHistory(applySnapshot, (u, r) => useApp.getState().setHistoryFlags(u, r));

    const syncPositions = () => {
      const pos: NodePos[] = [];
      cy.nodes().forEach((n) => {
        const bb = n.renderedBoundingBox({ includeLabels: false });
        const t = tableByIdRef.current.get(n.id());
        if (!t) return;
        const mods = modulesRef.current;
        const moduleColor = colorForTableModule(t.name, mods.byTable, mods.modules);
        const moduleKey = mods.byTable.get(t.name) ?? '';
        pos.push({
          id: n.id(),
          table: t,
          x: bb.x1,
          y: bb.y1,
          w: bb.w,
          h: bb.h,
          moduleColor,
          moduleKey,
        });
      });
      setPositions(pos);
    };
    cy.on('pan zoom resize', syncPositions);
    cy.on('position', 'node', syncPositions);
    cy.on('layoutstop', syncPositions);
    cy.on('add remove', syncPositions);
    // Persist the camera on any pan/zoom (not resize — a container resize must
    // not rewrite the stored camera).
    cy.on('pan zoom', saveViewport);

    // Re-route per-field edge endpoints whenever a node moves (drag, layout,
    // etc). Only the edges incident to the moved node need recomputing.
    cy.on('position', 'node', (evt) => {
      updateEdgeEndpoints(
        cy,
        evt.target.connectedEdges(),
        collapsedRef.current,
        tableByIdRef.current,
        displayRef.current,
        manualMoveRef.current,
        manualRoutesRef.current,
      );
    });
    cy.on('layoutstop add', () => {
      updateEdgeEndpoints(
        cy,
        cy.edges(),
        collapsedRef.current,
        tableByIdRef.current,
        displayRef.current,
        manualMoveRef.current,
        manualRoutesRef.current,
      );
    });

    cy.on('mouseover', 'edge', (evt) => {
      // Show route-edit handles for the hovered edge (never self-loops).
      if (evt.target.source().id() !== evt.target.target().id()) {
        if (hideHandlesTimer.current) {
          clearTimeout(hideHandlesTimer.current);
          hideHandlesTimer.current = null;
        }
        setHoveredEdgeId(evt.target.id());
      }
      const meta = evt.target.data('meta');
      const pos = evt.renderedPosition ?? { x: 0, y: 0 };
      setTooltip({
        x: pos.x + 12,
        y: pos.y + 12,
        text:
          (meta.source === 'explicit' ? '显式 FK' : `推断 FK · ${evt.target.data('confidence')}`) +
          `\n${meta.fromColumns.join(', ')} → ${meta.toColumns.join(', ')}` +
          (meta.reason ? `\n${meta.reason}` : ''),
      });
    });
    cy.on('mousemove', 'edge', (evt) => {
      const pos = evt.renderedPosition ?? { x: 0, y: 0 };
      setTooltip((t) => (t ? { ...t, x: pos.x + 12, y: pos.y + 12 } : null));
    });
    cy.on('mouseout', 'edge', () => {
      setTooltip(null);
      if (hideHandlesTimer.current) clearTimeout(hideHandlesTimer.current);
      hideHandlesTimer.current = window.setTimeout(() => {
        if (!draggingEdgeRef.current) setHoveredEdgeId(null);
      }, 160);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setFocusId(null);
        setSelectedIds(new Set());
      }
    });

    // Wheel/trackpad: plain scroll (and two-finger swipe) pans; a pinch — which
    // the browser reports as a wheel event with ctrlKey — zooms around the
    // pointer. Registered natively with { passive: false } because React's
    // synthetic onWheel is passive and can't preventDefault the page scroll.
    const container = containerRef.current;
    // Listen on the wrapper, not the cy container: card overlays sit *above*
    // the canvas (as siblings), so a wheel over a card would never reach a
    // container-level listener. The wrapper holds both, so pan/zoom works
    // everywhere in the canvas area. The zoom focal point still uses the cy
    // container's rect (that's the viewport cytoscape's renderedPosition is in).
    const wheelTarget = container.parentElement ?? container;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = container.getBoundingClientRect();
        const rendered = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        // Clamp the per-event factor: trackpad pinch sends tiny deltas (smooth),
        // but a discrete mouse wheel + ctrl sends ±100+ which would otherwise
        // jump 3–7× in a single notch. Cap each step at ±20%.
        const factor = Math.min(1.2, Math.max(0.8, Math.exp(-e.deltaY * 0.01)));
        const next = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor));
        cy.zoom({ level: next, renderedPosition: rendered });
      } else {
        const cur = cy.pan();
        cy.pan(clampPan(cy, { x: cur.x - e.deltaX, y: cur.y - e.deltaY }));
      }
    };
    wheelTarget.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      wheelTarget.removeEventListener('wheel', onWheel);
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      cy.destroy();
      cyRef.current = null;
      unbindView(); // also clears + unbinds the history machinery
    };
  }, []);

  // Canvas keyboard shortcuts. All are ignored while the user is typing in an
  // input/textarea (search box, SQL dialog) or focused on a control, so we never
  // hijack a key from a text field or button:
  //   Space (hold) → pan · Esc → clear selection · ⌘/Ctrl+Z → undo ·
  //   ⌘/Ctrl+Shift+Z or ⌘/Ctrl+Y → redo · ⌘/Ctrl+0 → 100% · Shift+1 → fit all ·
  //   Shift+2 → zoom to selection. (Shift+digit matched via e.code since e.key
  //   is '!'/'@' when Shift is held.)
  useEffect(() => {
    const fromControl = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      !!t.closest('input, textarea, button, a, [contenteditable="true"]');
    const onKeyDown = (e: KeyboardEvent) => {
      if (fromControl(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (e.code === 'Space' && !e.repeat) {
        setSpaceHeld(true);
        e.preventDefault(); // stop the page from scrolling
      } else if (e.key === 'Escape') {
        setFocusId(null);
        setSelectedIds(new Set());
      } else if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault(); // stop native page undo
        if (e.shiftKey) useApp.getState().redo();
        else useApp.getState().undo();
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useApp.getState().redo();
      } else if (meta && e.key === '0') {
        e.preventDefault(); // stop the browser resetting PAGE zoom
        getView()?.resetZoom();
      } else if (!meta && e.shiftKey && e.code === 'Digit1') {
        e.preventDefault();
        getView()?.fit();
      } else if (!meta && e.shiftKey && e.code === 'Digit2') {
        e.preventDefault();
        getView()?.zoomToSelection();
      } else if (!meta && (e.key === 'Delete' || e.key === 'Backspace')) {
        // Recycle-bin the selected tables (hide; SQL untouched). preventDefault
        // unconditionally so Backspace never navigates the page back; act only
        // when something is selected, and clear the selection synchronously so
        // the count pill doesn't render stale.
        e.preventDefault();
        const cy = cyRef.current;
        const ids = [...selectedIdsRef.current];
        if (cy && ids.length) {
          hideTables(cy, ids);
          setSelectedIds(new Set());
          setFocusId(null);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Rebuild elements when schema / fks / modules change. Preserves user-dragged
  // positions by capturing positions before remove and restoring them after add.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!schema) {
      cy.elements().remove();
      setPositions([]);
      return;
    }
    const prevPositions = new Map<string, { x: number; y: number }>();
    cy.nodes().forEach((n) => {
      prevPositions.set(n.id(), { ...n.position() });
    });

    const { elements } = buildElements(schema, effectiveFks, {
      modules,
      collapsed,
      tableWidths,
      display,
      decisions,
    });
    cy.elements().remove();
    cy.add(elements);

    // Drop any multi-select members whose table no longer exists, so a removed
    // table can't leave a phantom sky ring. Returns the same Set when unchanged
    // to avoid a needless re-render.
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set<string>();
      cy.nodes().forEach((n) => {
        if (prev.has(n.id())) live.add(n.id());
      });
      return live.size === prev.size ? prev : live;
    });

    // Restore positions: an in-session position first, then the PERSISTED layout
    // (so a page refresh keeps the arrangement). Only auto-layout when no node
    // has any known position (true first load, or an all-new schema).
    const saved = useApp.getState().nodePositions;
    const newlyAdded: cytoscape.NodeSingular[] = [];
    cy.nodes().forEach((n) => {
      const p = prevPositions.get(n.id()) ?? saved[n.id()];
      if (p) n.position(p);
      else newlyAdded.push(n);
    });
    if (newlyAdded.length === cy.nodes().length) {
      // Nothing to restore → fresh auto-layout (static dagre channels).
      manualMoveRef.current = false;
      runLayout(cy);
      persistLayout(cy);
    } else {
      // Some positions restored — treat as a manual layout so blocked edges use
      // the live obstacle-avoiding detour (a restored layout has no dagre
      // channels baked on its edges).
      manualMoveRef.current = true;
      if (newlyAdded.length > 0) {
        // Place new tables off to the right; user can reorganize.
        const maxX = Math.max(0, ...cy.nodes().map((n) => n.position('x')));
        newlyAdded.forEach((n, i) => n.position({ x: maxX + 220, y: 80 + i * 120 }));
        persistLayout(cy);
      }
    }
    // One-shot camera restore: only on the first build after a (re)mount. On a
    // refresh the saved viewport is non-null → reproduce the exact prior screen
    // (instant, no animation). On a fresh import `setSql` nulled it → skip and
    // keep the auto-fit. The guard flips regardless so later mid-session
    // rebuilds never re-snap the camera. Set zoom before pan: clampPan reads
    // cy.zoom(). The pan/zoom this fires re-persists the same value (idempotent).
    if (!viewportRestoredRef.current) {
      viewportRestoredRef.current = true;
      const v = useApp.getState().viewport;
      if (v) {
        cy.zoom(v.zoom);
        cy.pan(clampPan(cy, { x: v.x, y: v.y }));
      }
    }
    // After (re)building the elements, force a full endpoint refresh so the
    // new edges aren't stuck on the placeholder `outside-to-node` value. If the
    // user had manually arranged the (preserved) positions, keep routing live.
    updateEdgeEndpoints(
      cy,
      cy.edges(),
      collapsedRef.current,
      tableByIdRef.current,
      displayRef.current,
      manualMoveRef.current,
      manualRoutesRef.current,
    );
    // Color the freshly-built edges for the current theme (no flash of the
    // light/invisible color before the theme effect below would run).
    applyEdgeTheme(cy, isDarkRef.current);
    // Drop route overrides whose edge no longer exists (edited SQL etc.). Safe
    // to prune against the live cy edges only because deleting a table already
    // clears its edges' overrides (see hideTables).
    useApp.getState().pruneManualRoutes(
      cy.edges().map((e) => e.data('fkKey') as string),
    );
    // A rebuild changes the node set, so old undo snapshots may reference dead
    // nodes — reset the history and re-baseline to the freshly built layout.
    resetHistory();
    seedHistory(captureSnapshot(cy, tableWidthsRef.current));
    // NB: tableWidths intentionally not in deps — width drags are committed
    // via direct cy mutation in `onTableResize` to avoid a full element
    // rebuild (which would reset edge classes/positions). The next schema
    // change picks up the persisted overrides from the store.
  }, [schema, effectiveFks, modules]);

  // Resize every node when collapsed / display options / width overrides
  // change. Position is preserved; we just push new boxWidth/boxHeight and
  // recompute edges.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const t = tableByIdRef.current.get(n.id());
        if (!t) return;
        const isCollapsed = !!collapsed[t.name];
        const moduleKey = (n.data('moduleKey') as string) ?? '';
        const { width, height } = tableBoxSize(
          t,
          isCollapsed,
          display,
          moduleKey,
          tableWidths[t.name],
        );
        n.data('boxWidth', width);
        n.data('boxHeight', height);
      });
    });
    // Sizes changed → recompute every edge endpoint (the y offsets depend on
    // boxHeight and on whether the source/target rows are still visible). Keep
    // routing live if the user has already hand-arranged the cards, so a
    // collapse/display toggle after a drag doesn't snap edges back to stale
    // dagre channels.
    updateEdgeEndpoints(
      cy,
      cy.edges(),
      collapsed,
      tableByIdRef.current,
      display,
      manualMoveRef.current,
      manualRoutesRef.current,
    );
    // Force overlay re-sync after data mutation.
    cy.trigger('resize');
  }, [collapsed, display, tableWidths]);

  // Apply tri-state classes from the search/focus selection.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('highlight').removeClass('dimmed');

    if (selection) {
      const { matches, neighborhood } = selection;
      cy.edges().forEach((e) => {
        const s = e.source().id();
        const t = e.target().id();
        const sInHood = neighborhood.has(s);
        const tInHood = neighborhood.has(t);
        if (matches.has(s) || matches.has(t)) {
          e.removeClass('dimmed').addClass('highlight');
        } else if (!sInHood || !tInHood) {
          e.addClass('dimmed');
        }
      });
      if (matches.size > 0) {
        const matchNodes = cy.nodes().filter((n) => matches.has(n.id()));
        if (matchNodes.length > 0) cy.animate({ center: { eles: matchNodes }, duration: 200 });
      }
    }
  }, [selection]);

  // Flash-highlight when the user clicks a module chip in ModulesPanel. Pans
  // the canvas to center the module's tables in the viewport, paints them
  // with the same amber "match" ring as the search highlight, then auto-clears
  // after ~1.2s.
  //
  // NB: this used to call `cy.animate({ fit: ... })`, which also adjusted the
  // zoom level — a compact module would scale up, a spread-out module would
  // scale down. That made every click feel inconsistent. The user only wants
  // to LOCATE the module, not re-frame the entire canvas, so we compute the
  // model-space bbox center of the matched nodes and pan to put it under the
  // viewport center, leaving the current zoom untouched.
  useEffect(() => {
    if (flashTables.length === 0) return;
    const cy = cyRef.current;
    if (!cy) return;
    const ids = new Set(flashTables.map(nodeId));
    const eles = cy.nodes().filter((n) => ids.has(n.id()));
    if (eles.length === 0) return;
    const bb = eles.boundingBox({ includeLabels: false });
    const modelCx = (bb.x1 + bb.x2) / 2;
    const modelCy = (bb.y1 + bb.y2) / 2;
    const z = cy.zoom();
    const targetPan = { x: cy.width() / 2 - modelCx * z, y: cy.height() / 2 - modelCy * z };
    cy.animate({ pan: targetPan }, { duration: 600, easing: 'ease-in-out' });
    const timer = window.setTimeout(() => clearFlash(), 1200);
    return () => window.clearTimeout(timer);
    // flashTick guarantees re-running even when the table list is identical to
    // last time.
  }, [flashTables, flashTick, clearFlash]);

  /**
   * Begin a header drag. Three behaviors, decided on mouseup by whether the
   * pointer actually moved and whether a multi-select modifier was held:
   *   - moved  → drag the whole group (all `selectedIds` if this card is one of
   *     them, else just this card) by a single model-space delta, then re-route.
   *   - click (no move), modifier held → toggle this card's group membership
   *     (focus/highlight untouched, so the camera doesn't jump).
   *   - click (no move), plain → focus toggle (as before) and collapse the
   *     group to this card.
   * This closure is recreated each render (the overlay passes a fresh arrow), so
   * it always reads the current `selectedIds` — no ref needed.
   */
  const onTableDragStart = (e: React.MouseEvent, id: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(id);
    if (!node || node.empty()) return;

    // Modifiers must be read here (mousedown) — the window mouseup event is a
    // different object and won't carry them.
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const sel = selectedIds;
    const groupIds = resolveDragGroup(sel, id);
    const starts = groupIds
      .map((gid) => cy.getElementById(gid))
      .filter((n) => n && !n.empty())
      .map((n) => ({ node: n, start: { ...n.position() } }));

    const startMouse = { x: e.clientX, y: e.clientY };
    let moved = false;
    const onMove = (mv: MouseEvent) => {
      const zoom = cy.zoom();
      const dx = (mv.clientX - startMouse.x) / zoom;
      const dy = (mv.clientY - startMouse.y) / zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true;
        // First real movement → route edges live (detour from current ports)
        // for the rest of this session, until a relayout re-canonicalises.
        manualMoveRef.current = true;
      }
      if (!moved) return;
      // One batch so the per-node reroute handler coalesces into a bounded
      // number of passes per frame instead of one per moved card.
      cy.batch(() => {
        for (const s of starts) s.node.position({ x: s.start.x + dx, y: s.start.y + dy });
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) {
        if (additive) {
          // Toggle group membership only; leave the focus highlight alone.
          setSelectedIds((prev) => toggleSelected(prev, id));
        } else {
          setFocusId((cur) => (cur === id ? null : id));
          setSelectedIds((cur) => (cur.size === 1 && cur.has(id) ? new Set() : new Set([id])));
        }
        return;
      }
      // Moving a node tears its connector ports away from any hand-edited bends,
      // so drop the overrides for every edge touching a moved card — those edges
      // re-auto-route. (Only here + onTableResize; never on the cy 'position'
      // event, which also fires during programmatic restore/undo/relayout.)
      if (!getIsApplying()) {
        const movedFkKeys = starts.flatMap((s) =>
          s.node.connectedEdges().map((ed) => ed.data('fkKey') as string),
        );
        if (movedFkKeys.length) useApp.getState().clearManualRoutesForNode(movedFkKeys);
      }
      // A real move. Routing is obstacle-aware (edges thread around ALL cards,
      // not just their endpoints), so moving cards can invalidate routes that
      // don't touch them; re-route every edge so they clean up around the new
      // positions. `liveRoute` (manualMoveRef) makes multi-rank/blocked edges
      // run the obstacle-avoiding detour from the current ports instead of the
      // frozen dagre channel, so a card dragged into a gutter no longer leaves a
      // stale crossing. Read routes fresh (getState) so the just-cleared ones
      // don't re-dock this pass.
      updateEdgeEndpoints(
        cy,
        cy.edges(),
        collapsedRef.current,
        tableByIdRef.current,
        displayRef.current,
        manualMoveRef.current,
        useApp.getState().manualRoutes,
      );
      // Record this layout state for undo/redo + persist it so a refresh keeps
      // the arrangement (skip if we're mid-apply).
      if (!getIsApplying()) {
        const snap = captureSnapshot(cy, tableWidthsRef.current);
        pushHistory(snap);
        useApp.getState().setNodePositions(snap.positions);
      }
      // A plain drag of an unselected card shouldn't leave a stale group.
      if (!additive && !(sel.has(id) && sel.size > 1)) setSelectedIds(new Set([id]));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Begin a right-edge resize drag on a card. Updates `boxWidth` live on every
   * mousemove (so the React overlay re-renders at the new width and FK edge
   * endpoints stay glued to columns), then persists the final width to the
   * store on mouseup. We bypass the store during the drag for perf —
   * committing on every pixel would re-run effectiveForeignKeys and friends.
   */
  const onTableResize = (e: React.MouseEvent, tableName: string, id: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(id);
    if (!node || node.empty()) return;
    const startMouse = { x: e.clientX, y: e.clientY };
    const startWidth = (node.data('boxWidth') as number) ?? MIN_WIDTH;
    let lastWidth = startWidth;
    const onMove = (mv: MouseEvent) => {
      const zoom = cy.zoom();
      const dx = (mv.clientX - startMouse.x) / zoom;
      const next = Math.max(MIN_WIDTH, Math.min(DRAG_MAX_WIDTH, Math.round(startWidth + dx)));
      if (next === lastWidth) return;
      lastWidth = next;
      // Push the new width directly into cytoscape; height stays as-is, the
      // overlay reads it from `pos.w` via the next `position`/`resize` event.
      node.data('boxWidth', next);
      // Manually trigger a sync so the React overlay picks the new width up
      // without waiting for any other cytoscape event.
      cy.trigger('resize');
      updateEdgeEndpoints(
        cy,
        node.connectedEdges(),
        collapsedRef.current,
        tableByIdRef.current,
        displayRef.current,
        manualMoveRef.current,
        manualRoutesRef.current,
      );
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (lastWidth !== startWidth) {
        setTableWidth(tableName, lastWidth);
        // Record for undo. Build widths from a CLONE of the current overrides
        // with this table's new width — don't re-read the store, the set() above
        // may not have flushed synchronously yet.
        if (!getIsApplying()) {
          // Resizing moves this card's ports → drop overrides on its edges so
          // they re-auto-route (the resize effect reroutes them).
          const fkKeys = node.connectedEdges().map((ed) => ed.data('fkKey') as string);
          if (fkKeys.length) useApp.getState().clearManualRoutesForNode(fkKeys);
          const widths = { ...tableWidthsRef.current, [tableName]: lastWidth };
          pushHistory(captureSnapshot(cy, widths));
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Mousedown on the empty canvas. Card overlays are siblings that handle their
   * own drags, so anything reaching the cy container is background. Space-held
   * or middle-button drag pans the viewport; a plain left drag rubber-band
   * selects the cards it touches (Shift/⌘/Ctrl unions with the current
   * selection). A sub-threshold drag is left to cytoscape's background `tap`,
   * which clears the selection — so a plain click still deselects.
   */
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const cy = cyRef.current;
    const containerEl = containerRef.current;
    if (!cy || !containerEl) return;
    const startClient = { x: e.clientX, y: e.clientY };

    // Pan: Space-held drag, middle mouse button, or a left drag while the hand
    // (pan) tool is active. SELECT mode left-drag falls through to the marquee.
    if (spaceHeld || e.button === 1 || (canvasMode === 'pan' && e.button === 0)) {
      // COPY — cy.pan() returns a LIVE reference to the internal pan object, so
      // capturing it directly would make `startPan.x` mutate as we pan and the
      // delta accumulate (the drag would fly off-screen). Spread to snapshot it.
      const startPan = { ...cy.pan() };
      setPanning(true);
      const onMove = (mv: MouseEvent) => {
        cy.pan(
          clampPan(cy, {
            x: startPan.x + (mv.clientX - startClient.x),
            y: startPan.y + (mv.clientY - startClient.y),
          }),
        );
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setPanning(false);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return; // only the left button marquees

    const rect = containerEl.getBoundingClientRect();
    const anchor = { x: startClient.x - rect.left, y: startClient.y - rect.top };
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? new Set(selectedIds) : new Set<string>();
    // `positions` is stable for the duration of a marquee (no pan/zoom/node move
    // happens while the button is down), so the captured array is safe to read.
    const snapshot = positions;
    let started = false;
    let lastKey = '';

    const onMove = (mv: MouseEvent) => {
      const box = normalizeRect(anchor, { x: mv.clientX - rect.left, y: mv.clientY - rect.top });
      // The 6px threshold must exceed cytoscape's 4px desktopTapThreshold so a
      // started marquee is never also counted as a background tap (which clears).
      if (!started && box.w + box.h < 6) return;
      if (!started) {
        started = true;
        // Drop any focus highlight so amber/dimming doesn't fight the sky rings.
        setFocusId(null);
      }
      setMarquee(box);
      const hit = nodesInMarquee(snapshot, box);
      const key = hit.join(',');
      if (key === lastKey) return;
      lastKey = key;
      const next = new Set(base);
      for (const id of hit) next.add(id);
      setSelectedIds(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setMarquee(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault(); // suppress native text selection across the drag
  };

  const cancelHideHandles = () => {
    if (hideHandlesTimer.current) {
      clearTimeout(hideHandlesTimer.current);
      hideHandlesTimer.current = null;
    }
  };
  const scheduleHideHandles = () => {
    cancelHideHandles();
    hideHandlesTimer.current = window.setTimeout(() => {
      if (!draggingEdgeRef.current) setHoveredEdgeId(null);
    }, 160);
  };

  /**
   * Drag one interior orthogonal segment of an edge to fine-tune its route. The
   * ports stay pinned; only the dragged segment + its two bends move (along its
   * normal). On release the edited polyline is committed as a persisted manual
   * override (re-docked to live ports by updateEdgeEndpoints thereafter).
   */
  const onSegmentDragStart = (edgeId: string, segIndex: number, ev: React.MouseEvent) => {
    const cy = cyRef.current;
    if (!cy) return;
    const edge = cy.getElementById(edgeId);
    if (!edge || edge.empty()) return;
    const startPoly: Pt[] = (edge.data('routePoints') as string)
      .split(' ')
      .filter(Boolean)
      .map((s) => {
        const [x, y] = s.split(',').map(Number);
        return { x, y };
      });
    const startMouse = { x: ev.clientX, y: ev.clientY };
    draggingEdgeRef.current = true;
    cancelHideHandles();
    let moved = false;
    let lastRoute = startPoly;
    const onMove = (mv: MouseEvent) => {
      const zoom = cy.zoom();
      if (zoom === 0) return;
      const dModel = { x: (mv.clientX - startMouse.x) / zoom, y: (mv.clientY - startMouse.y) / zoom };
      if (!moved && Math.abs(dModel.x) + Math.abs(dModel.y) > 1) moved = true;
      if (!moved) return;
      lastRoute = dragSegment(startPoly, segIndex, dModel);
      // Write live: ports (srcEndpoint/tgtEndpoint) are unchanged; just re-encode
      // the bends + routePoints so the canvas updates while dragging.
      const { weights, distances } = segmentsFromPoints(lastRoute);
      edge.data('segWeights', weights);
      edge.data('segDistances', distances);
      edge.data('routePoints', lastRoute.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      bumpRouteTick((t) => t + 1); // re-render the handle to follow the segment
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      draggingEdgeRef.current = false;
      if (moved) {
        manualMoveRef.current = true;
        useApp.getState().setManualRoute(edge.data('fkKey') as string, lastRoute);
        if (!getIsApplying()) pushHistory(captureSnapshot(cy, tableWidthsRef.current));
      }
      scheduleHideHandles();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    ev.preventDefault();
    ev.stopPropagation();
  };

  // Dedicated classes (not Tailwind's `cursor-*`) because cytoscape writes an
  // inline cursor on its container/canvas during interaction; only an
  // !important rule (see styles.css) wins over that. SELECT mode keeps the
  // normal arrow (empty class); only an active pan shows grab/grabbing.
  const canvasCursor = panning
    ? 'cy-cursor-grabbing'
    : spaceHeld || canvasMode === 'pan'
      ? 'cy-cursor-grab'
      : '';

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className={`cy-container absolute inset-0 ${canvasCursor}`}
        onMouseDown={onCanvasMouseDown}
      />
      {positions.map((p) => {
        const flashing = flashTables.includes(p.table.name);
        const state: OverlayState = selection
          ? selection.matches.has(p.id)
            ? 'match'
            : selection.neighborhood.has(p.id)
              ? 'neighbor'
              : 'dim'
          : 'neutral';
        const fkCols = fkSourceColumns.get(p.table.name);
        const hasManualWidth = tableWidths[p.table.name] != null;
        return (
          <TableOverlay
            key={p.id}
            pos={p}
            display={display}
            state={state}
            collapsed={!!collapsed[p.table.name]}
            flashing={flashing}
            fkColumns={fkCols}
            hasManualWidth={hasManualWidth}
            selected={selectedIds.has(p.id)}
            activeMatch={p.id === activeMatchId}
            interactive={canvasMode === 'select'}
            query={search}
            onDragHandle={(e) => onTableDragStart(e, p.id)}
            onResizeHandle={(e) => onTableResize(e, p.table.name, p.id)}
            onToggleCollapse={() => toggleCollapsed(p.table.name)}
            onResetWidth={() => setTableWidth(p.table.name, null)}
          />
        );
      })}
      {hoveredEdgeId &&
        cyRef.current &&
        (() => {
          const cy = cyRef.current;
          const e = cy.getElementById(hoveredEdgeId);
          if (!e || e.empty()) return null;
          const rp: Pt[] = ((e.data('routePoints') as string) || '')
            .split(' ')
            .filter(Boolean)
            .map((s) => {
              const [x, y] = s.split(',').map(Number);
              return { x, y };
            });
          if (rp.length < 4) return null; // need an interior segment to drag
          return (
            <RouteHandles
              points={rp}
              zoom={cy.zoom()}
              pan={cy.pan()}
              onSegmentDragStart={(segIndex, ev) => onSegmentDragStart(hoveredEdgeId, segIndex, ev)}
              onEnter={cancelHideHandles}
              onLeave={scheduleHideHandles}
            />
          );
        })()}
      {tooltip && (
        <div
          className="cy-tooltip"
          style={{ left: tooltip.x, top: tooltip.y, whiteSpace: 'pre-line' }}
        >
          {tooltip.text}
        </div>
      )}
      {marquee && (
        <div
          className="pointer-events-none absolute z-10 rounded-[2px] border border-sky-400/80 bg-sky-400/15 dark:border-sky-300/80 dark:bg-sky-300/15"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
      {selectedIds.size >= 2 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-ink-200 bg-white/90 px-3 py-1 text-[12px] font-medium text-ink-600 shadow-lg backdrop-blur dark:border-inkd-300 dark:bg-inkd-100/90 dark:text-inkd-700">
          <span>已选 {selectedIds.size} 张 · 拖动整组移动</span>
          <button
            type="button"
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
            title="删除选中的表（移入回收站，不改动 SQL）"
            onClick={() => {
              const cy = cyRef.current;
              if (!cy) return;
              hideTables(cy, [...selectedIds]);
              setSelectedIds(new Set());
              setFocusId(null);
            }}
          >
            <TrashIcon />
            删除
          </button>
          <span className="text-ink-400 dark:text-inkd-500">Esc 取消</span>
        </div>
      )}
      {schema && schema.tables.length === 0 && Object.keys(deletedTables).length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-ink-400 dark:text-inkd-500">
          所有表已隐藏 · 从左下角回收站恢复
        </div>
      )}
    </div>
  );
}

// React.lazy requires a default export; the named export above stays so
// existing tests / dev imports keep working. The default re-binding here is
// what App.tsx hands to `lazy(() => import('./diagram/DiagramCanvas'))`.
export default DiagramCanvas;
