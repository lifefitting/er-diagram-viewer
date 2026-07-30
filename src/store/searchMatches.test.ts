import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './index';

// setSearchMatches must (a) preserve the active cursor across a pure REORDER
// (e.g. the user dragged a matched card), (b) reset it when the match SET
// changes, and (c) apply a deferred Enter step (pendingSearchStep) once the
// fresh list lands. Guards findings: stale find order after drag (#1) and the
// first-Enter-steps-stale-list bug (#2).
describe('search match navigation store', () => {
  beforeEach(() => {
    useApp.setState({
      searchScope: 'all',
      searchMatchIds: [],
      searchActiveIndex: -1,
      pendingSearchStep: null,
    });
  });

  it('preserves the active match across a pure reorder', () => {
    const s = useApp.getState();
    s.setSearchMatches(['a', 'b', 'c']);
    s.cycleSearchMatch(1); // step to index 0 → node 'a'
    expect(useApp.getState().searchActiveIndex).toBe(0);

    // Same SET, new order (a drag re-published the list): cursor follows 'a'.
    s.setSearchMatches(['c', 'a', 'b']);
    expect(useApp.getState().searchMatchIds).toEqual(['c', 'a', 'b']);
    expect(useApp.getState().searchActiveIndex).toBe(1); // 'a' is now at index 1
  });

  it('resets the cursor when the match set changes', () => {
    const s = useApp.getState();
    s.setSearchMatches(['a', 'b']);
    s.cycleSearchMatch(1); // index 0 → 'a'
    s.setSearchMatches(['x', 'y']); // 'a' no longer a match
    expect(useApp.getState().searchActiveIndex).toBe(-1);
  });

  it('applies a deferred Enter step when the fresh list lands', () => {
    const s = useApp.getState();
    s.requestSearchStep(1); // user pressed Enter while the query was still flushing
    s.setSearchMatches(['p', 'q', 'r']); // recomputed matches arrive
    expect(useApp.getState().searchActiveIndex).toBe(0); // stepped into first match
    expect(useApp.getState().pendingSearchStep).toBeNull(); // consumed
  });

  it('a deferred backward step lands on the last match', () => {
    const s = useApp.getState();
    s.requestSearchStep(-1);
    s.setSearchMatches(['p', 'q', 'r']);
    expect(useApp.getState().searchActiveIndex).toBe(2);
  });

  it('a deferred step on an empty result set clears cleanly', () => {
    const s = useApp.getState();
    s.requestSearchStep(1);
    s.setSearchMatches([]);
    expect(useApp.getState().searchActiveIndex).toBe(-1);
    expect(useApp.getState().pendingSearchStep).toBeNull();
  });

  it('applies a pending step even when the id list is unchanged', () => {
    const s = useApp.getState();
    s.setSearchMatches(['p', 'q']);
    expect(useApp.getState().searchActiveIndex).toBe(-1);
    s.requestSearchStep(1);
    s.setSearchMatches(['p', 'q']); // same list, but a step is pending
    expect(useApp.getState().searchActiveIndex).toBe(0);
  });

  it('resets navigation when the search scope changes', () => {
    const s = useApp.getState();
    s.setSearchMatches(['table-a', 'table-b']);
    s.cycleSearchMatch(1);
    s.requestSearchStep(1);
    s.setSearchScope('field');
    expect(useApp.getState().searchScope).toBe('field');
    expect(useApp.getState().searchActiveIndex).toBe(-1);
    expect(useApp.getState().pendingSearchStep).toBeNull();
  });
});
