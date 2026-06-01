import { describe, expect, it } from 'vitest';
import { nextMatchIndex } from './searchNav';

describe('nextMatchIndex', () => {
  it('returns -1 when there are no matches', () => {
    expect(nextMatchIndex(-1, 0, 1)).toBe(-1);
    expect(nextMatchIndex(3, 0, -1)).toBe(-1);
  });

  it('steps into the first match going forward from "none"', () => {
    expect(nextMatchIndex(-1, 5, 1)).toBe(0);
  });

  it('steps into the last match going backward from "none"', () => {
    expect(nextMatchIndex(-1, 5, -1)).toBe(4);
  });

  it('advances forward', () => {
    expect(nextMatchIndex(0, 3, 1)).toBe(1);
    expect(nextMatchIndex(1, 3, 1)).toBe(2);
  });

  it('wraps forward past the end back to the start', () => {
    expect(nextMatchIndex(2, 3, 1)).toBe(0);
  });

  it('wraps backward past the start to the end', () => {
    expect(nextMatchIndex(0, 3, -1)).toBe(2);
  });

  it('handles a single match', () => {
    expect(nextMatchIndex(-1, 1, 1)).toBe(0);
    expect(nextMatchIndex(0, 1, 1)).toBe(0);
    expect(nextMatchIndex(0, 1, -1)).toBe(0);
  });
});
