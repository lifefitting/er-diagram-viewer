import { describe, it, expect } from 'vitest';
import { resolveDragGroup, toggleSelected } from './dragGroup';

describe('resolveDragGroup', () => {
  it('drags the whole group when grabbing a member of a multi-selection', () => {
    const sel = new Set(['a', 'b', 'c']);
    expect(resolveDragGroup(sel, 'b').sort()).toEqual(['a', 'b', 'c']);
  });

  it('drags only the grabbed card when it is not in the selection', () => {
    expect(resolveDragGroup(new Set(['a', 'b']), 'z')).toEqual(['z']);
  });

  it('drags only the grabbed card when the selection is a single card', () => {
    // size 1 is not a "group" — behaves like a plain single drag
    expect(resolveDragGroup(new Set(['a']), 'a')).toEqual(['a']);
  });

  it('drags only the grabbed card when nothing is selected', () => {
    expect(resolveDragGroup(new Set(), 'a')).toEqual(['a']);
  });
});

describe('toggleSelected', () => {
  it('adds a missing id and removes a present one, without mutating the input', () => {
    const sel = new Set(['a']);
    const added = toggleSelected(sel, 'b');
    expect([...added].sort()).toEqual(['a', 'b']);
    expect([...sel]).toEqual(['a']); // original untouched (fresh Set)
    expect([...toggleSelected(added, 'a')]).toEqual(['b']);
  });
});
