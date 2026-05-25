import type { Core, EdgeCollection } from 'cytoscape';
import type { Table } from '../../parser/types';
import type { DisplayOptions } from '../../store';
import { columnRowOffsets } from '../buildGraph';
import { computeEndpointOffset } from './computeEndpointOffset';
import { computeSegments } from './computeSegments';

/**
 * Recompute and write per-field endpoints + segment bends for a collection of
 * edges. Uses `cy.batch` so cytoscape only does one render pass per call even
 * when many edges are touched.
 */
export function updateEdgeEndpoints(
  cy: Core,
  edges: EdgeCollection,
  collapsed: Record<string, boolean>,
  tableById: Map<string, Table>,
  display: DisplayOptions,
): void {
  if (edges.length === 0) return;
  // Memoize per-table row offsets — many edges share endpoints on the same node.
  const offsetsCache = new Map<string, number[]>();
  const rowOffsets = (table: Table | undefined): number[] => {
    if (!table) return [];
    const cached = offsetsCache.get(table.name);
    if (cached) return cached;
    const arr = columnRowOffsets(table, { showComment: display.showComment, showType: display.showType });
    offsetsCache.set(table.name, arr);
    return arr;
  };
  cy.batch(() => {
    edges.forEach((e) => {
      const src = e.source();
      const tgt = e.target();
      const srcName = (src.data('rawName') as string) ?? '';
      const tgtName = (tgt.data('rawName') as string) ?? '';
      const srcRowIdx = (e.data('srcRowIdx') as number | undefined) ?? -1;
      const tgtRowIdx = (e.data('tgtRowIdx') as number | undefined) ?? -1;
      const srcCollapsed = !!collapsed[srcName];
      const tgtCollapsed = !!collapsed[tgtName];
      const srcW = (src.data('boxWidth') as number) ?? 0;
      const srcH = (src.data('boxHeight') as number) ?? 0;
      const tgtW = (tgt.data('boxWidth') as number) ?? 0;
      const tgtH = (tgt.data('boxHeight') as number) ?? 0;
      const srcTable = tableById.get(src.id());
      const tgtTable = tableById.get(tgt.id());
      const srcOffs = rowOffsets(srcTable);
      const tgtOffs = rowOffsets(tgtTable);
      const srcY = srcRowIdx >= 0 && srcRowIdx < srcOffs.length ? srcOffs[srcRowIdx] : null;
      const tgtY = tgtRowIdx >= 0 && tgtRowIdx < tgtOffs.length ? tgtOffs[tgtRowIdx] : null;
      const srcPos = src.position();
      const tgtPos = tgt.position();
      const dxNode = tgtPos.x - srcPos.x;
      const srcSide: 'left' | 'right' = dxNode >= 0 ? 'right' : 'left';
      const tgtSide: 'left' | 'right' = dxNode >= 0 ? 'left' : 'right';
      const srcOff = computeEndpointOffset(srcY, srcCollapsed, srcW, srcH, srcSide);
      const tgtOff = computeEndpointOffset(tgtY, tgtCollapsed, tgtW, tgtH, tgtSide);
      // Absolute endpoint positions in cytoscape model coordinates. These are
      // what cytoscape uses internally for the segments calculation, so the
      // bends we compute below land at exactly (midX, sy) and (midX, ty).
      const sx = srcPos.x + srcOff.x;
      const sy = srcPos.y + srcOff.y;
      const tx = tgtPos.x + tgtOff.x;
      const ty = tgtPos.y + tgtOff.y;
      const { weights, distances } = computeSegments(sx, sy, tx, ty);
      e.data('srcEndpoint', `${srcOff.x.toFixed(1)}px ${srcOff.y.toFixed(1)}px`);
      e.data('tgtEndpoint', `${tgtOff.x.toFixed(1)}px ${tgtOff.y.toFixed(1)}px`);
      e.data('segWeights', weights);
      e.data('segDistances', distances);
    });
  });
}
