/**
 * Next active-match index for Chrome-find-style search navigation, with
 * wraparound. `current < 0` means "not yet stepped into the results": stepping
 * forward lands on the first match, backward on the last. Returns -1 when there
 * are no matches at all.
 */
export function nextMatchIndex(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : total - 1;
  return (current + dir + total) % total;
}
