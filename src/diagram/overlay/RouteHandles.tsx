import clsx from 'clsx';
import type { Pt } from '../routing/channelRoute';

const EPS = 0.5;

/**
 * Draggable dots at the midpoint of each *interior* orthogonal segment of the
 * hovered connector (a segment whose BOTH endpoints are bends, never a port).
 * Dragging a dot shifts that segment perpendicular (handled by the parent's
 * `onSegmentDragStart` → `dragSegment`), keeping the route H/V-only. Positions
 * are derived from the edge's live `routePoints` (model space) projected to
 * screen via `model*zoom + pan` — the same transform the table overlays use.
 */
export function RouteHandles({
  points,
  zoom,
  pan,
  onSegmentDragStart,
  onEnter,
  onLeave,
}: {
  points: Pt[];
  zoom: number;
  pan: { x: number; y: number };
  onSegmentDragStart: (segIndex: number, e: React.MouseEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const handles: { segIndex: number; x: number; y: number; orient: 'h' | 'v' }[] = [];
  // Segment [i, i+1] is fully interior when 1 <= i <= n-3 (both ends are bends).
  for (let i = 1; i <= points.length - 3; i++) {
    const a = points[i];
    const b = points[i + 1];
    const orient: 'h' | 'v' = Math.abs(a.y - b.y) < EPS ? 'h' : 'v';
    handles.push({
      segIndex: i,
      x: ((a.x + b.x) / 2) * zoom + pan.x,
      y: ((a.y + b.y) / 2) * zoom + pan.y,
      orient,
    });
  }
  if (handles.length === 0) return null;
  return (
    <>
      {handles.map((h) => (
        <div
          key={h.segIndex}
          className={clsx(
            'absolute z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full',
            'border-2 border-white bg-sky-500 shadow ring-1 ring-sky-600/30 dark:border-inkd-100',
            h.orient === 'h' ? 'cursor-row-resize' : 'cursor-col-resize',
          )}
          style={{ left: h.x, top: h.y }}
          title="拖拽调整折线"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onMouseDown={(e) => onSegmentDragStart(h.segIndex, e)}
        />
      ))}
    </>
  );
}
