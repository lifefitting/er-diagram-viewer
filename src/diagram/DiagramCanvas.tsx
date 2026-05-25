import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import dagre from 'cytoscape-dagre';
import {
  buildElements,
  buildFkSourceColumns,
  nodeId,
  tableBoxSize,
  MIN_WIDTH,
  DRAG_MAX_WIDTH,
} from './buildGraph';
import { buildStylesheet } from './style';
import { useApp, effectiveForeignKeys } from '../store';
import type { Table } from '../parser/types';
import { colorForTableModule, type ModulesResult } from '../infer/inferModules';
import { bindCy, unbindCy } from './cyHandle';
import type { NodePos, OverlayState, Selection } from './types';
import { TableOverlay } from './overlay/TableOverlay';
import { runLayout } from './layout/runLayout';
import { updateEdgeEndpoints } from './routing/updateEdgeEndpoints';
import { deriveFocusSelection, deriveSearchSelection } from './selection/deriveSelection';

let registered = false;
function ensurePlugins() {
  if (registered) return;
  cytoscape.use(fcose);
  cytoscape.use(dagre);
  registered = true;
}

export function DiagramCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const schema = useApp((s) => s.schema);
  const inferred = useApp((s) => s.inferred);
  const decisions = useApp((s) => s.decisions);
  const display = useApp((s) => s.display);
  const layout = useApp((s) => s.layout);
  const search = useApp((s) => s.search);
  const modules = useApp((s) => s.modules);
  const collapsed = useApp((s) => s.collapsed);
  const tableWidths = useApp((s) => s.tableWidths);
  const flashTables = useApp((s) => s.flashTables);
  const flashTick = useApp((s) => s.flashTick);
  const clearFlash = useApp((s) => s.clearFlash);
  const toggleCollapsed = useApp((s) => s.toggleCollapsed);
  const setTableWidth = useApp((s) => s.setTableWidth);

  const [positions, setPositions] = useState<NodePos[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const tableById = useMemo(() => {
    const m = new Map<string, Table>();
    if (schema) for (const t of schema.tables) m.set(nodeId(t.name), t);
    return m;
  }, [schema]);

  const effectiveFks = useMemo(
    () => (schema ? effectiveForeignKeys(schema, inferred, decisions, display.showLowConfidence) : []),
    [schema, inferred, decisions, display.showLowConfidence],
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

  // Refs for use inside cy event handlers (which are bound once on mount).
  const tableByIdRef = useRef(tableById);
  tableByIdRef.current = tableById;
  const modulesRef = useRef<ModulesResult>(modules);
  modulesRef.current = modules;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const displayRef = useRef(display);
  displayRef.current = display;

  // Mount cytoscape once.
  useEffect(() => {
    ensurePlugins();
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      // Edges use `curve-style: segments` with two bends placed at
      // (midX, sy) and (midX, ty) — see updateEdgeEndpoints. This guarantees a
      // pure H-V-H polyline for every FK regardless of source/target geometry
      // (taxi mode would degrade to diagonals when the cards overlapped
      // horizontally or when both endpoints landed on the same side).
      style: buildStylesheet(),
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 4,
      boxSelectionEnabled: false,
    });
    cyRef.current = cy;
    // Each mount supplies its OWN cy-bound relayout closure. The closure
    // captures `cy` directly so it cannot drift to a stale instance even if
    // the canvas remounts. This is the React-idiomatic alternative to a
    // module-level cytoscape singleton (see review P2): the toolbar still
    // reaches in via `cyHandle.relayoutCurrent()` for one-line ergonomics,
    // but the bind/unbind lifecycle is now strictly tied to mount/unmount.
    bindCy(cy, () => {
      if (cy.nodes().length === 0) return;
      const kind = (cy.scratch('_lastLayout') as 'fcose' | 'dagre') ?? 'fcose';
      runLayout(cy, kind, { randomize: true });
    });

    const syncPositions = () => {
      const pos: NodePos[] = [];
      cy.nodes().forEach((n) => {
        const bb = n.renderedBoundingBox({ includeLabels: false });
        const t = tableByIdRef.current.get(n.id());
        if (!t) return;
        const mods = modulesRef.current;
        const moduleColor = colorForTableModule(t.name, mods.byTable, mods.modules);
        const moduleKey = mods.byTable.get(t.name) ?? '';
        pos.push({ id: n.id(), table: t, x: bb.x1, y: bb.y1, w: bb.w, h: bb.h, moduleColor, moduleKey });
      });
      setPositions(pos);
    };
    cy.on('pan zoom resize', syncPositions);
    cy.on('position', 'node', syncPositions);
    cy.on('layoutstop', syncPositions);
    cy.on('add remove', syncPositions);

    // Re-route per-field edge endpoints whenever a node moves (drag, layout,
    // etc). Only the edges incident to the moved node need recomputing.
    cy.on('position', 'node', (evt) => {
      updateEdgeEndpoints(
        cy,
        evt.target.connectedEdges(),
        collapsedRef.current,
        tableByIdRef.current,
        displayRef.current,
      );
    });
    cy.on('layoutstop add', () => {
      updateEdgeEndpoints(cy, cy.edges(), collapsedRef.current, tableByIdRef.current, displayRef.current);
    });

    cy.on('mouseover', 'edge', (evt) => {
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
    cy.on('mouseout', 'edge', () => setTooltip(null));

    cy.on('tap', (evt) => {
      if (evt.target === cy) setFocusId(null);
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
      unbindCy();
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

    // Restore positions where the node still exists; run a layout only for
    // nodes that didn't have a prior position (= new tables added).
    const newlyAdded: cytoscape.NodeSingular[] = [];
    cy.nodes().forEach((n) => {
      const p = prevPositions.get(n.id());
      if (p) n.position(p);
      else newlyAdded.push(n);
    });
    if (prevPositions.size === 0 || newlyAdded.length === cy.nodes().length) {
      runLayout(cy, layout);
    } else if (newlyAdded.length > 0) {
      // Place new nodes off to the right; user can reorganize.
      const maxX = Math.max(0, ...cy.nodes().map((n) => n.position('x')));
      newlyAdded.forEach((n, i) => n.position({ x: maxX + 220, y: 80 + i * 120 }));
    }
    // After (re)building the elements, force a full endpoint refresh so the
    // new edges aren't stuck on the placeholder `outside-to-node` value.
    updateEdgeEndpoints(cy, cy.edges(), collapsedRef.current, tableByIdRef.current, displayRef.current);
    // NB: tableWidths intentionally not in deps — width drags are committed
    // via direct cy mutation in `onTableResize` to avoid a full element
    // rebuild (which would reset edge classes/positions). The next schema
    // change picks up the persisted overrides from the store.
  }, [schema, effectiveFks, modules]);

  // Re-run layout when explicitly switching layout kind (resets positions
  // intentionally).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (cy.nodes().length === 0) return;
    cy.style(buildStylesheet());
    runLayout(cy, layout);
  }, [layout]);

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
    // boxHeight and on whether the source/target rows are still visible).
    updateEdgeEndpoints(cy, cy.edges(), collapsed, tableByIdRef.current, display);
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

  const onTableDragStart = (e: React.MouseEvent, id: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(id);
    if (!node || node.empty()) return;
    const startMouse = { x: e.clientX, y: e.clientY };
    const startNodePos = { ...node.position() };
    let moved = false;
    const onMove = (mv: MouseEvent) => {
      const zoom = cy.zoom();
      const dx = (mv.clientX - startMouse.x) / zoom;
      const dy = (mv.clientY - startMouse.y) / zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) {
        node.position({ x: startNodePos.x + dx, y: startNodePos.y + dy });
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) {
        setFocusId((cur) => (cur === id ? null : id));
      }
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
      updateEdgeEndpoints(cy, node.connectedEdges(), collapsedRef.current, tableByIdRef.current, displayRef.current);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (lastWidth !== startWidth) {
        setTableWidth(tableName, lastWidth);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="cy-container absolute inset-0" />
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
            onDragHandle={(e) => onTableDragStart(e, p.id)}
            onResizeHandle={(e) => onTableResize(e, p.table.name, p.id)}
            onToggleCollapse={() => toggleCollapsed(p.table.name)}
            onResetWidth={() => setTableWidth(p.table.name, null)}
          />
        );
      })}
      {tooltip && (
        <div className="cy-tooltip" style={{ left: tooltip.x, top: tooltip.y, whiteSpace: 'pre-line' }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

// React.lazy requires a default export; the named export above stays so
// existing tests / dev imports keep working. The default re-binding here is
// what App.tsx hands to `lazy(() => import('./diagram/DiagramCanvas'))`.
export default DiagramCanvas;
