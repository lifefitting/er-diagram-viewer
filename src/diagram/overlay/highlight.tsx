import type { ReactNode } from 'react';

/**
 * Wrap every case-insensitive occurrence of `query` inside `text` with a
 * Chrome-style yellow find-highlight `<mark>`. Returns the plain string when
 * there's no active query or no match — that's the common path (no search /
 * non-matching cards), so it stays allocation-free. The match logic mirrors
 * `deriveSearchSelection` (trim + lowercase substring) so the highlighted text
 * is exactly what made the card a search hit.
 */
export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const ql = q.toLowerCase();
  const lower = text.toLowerCase();
  if (!lower.includes(ql)) return text;
  const out: ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (let idx = lower.indexOf(ql); idx !== -1; idx = lower.indexOf(ql, from)) {
    if (idx > from) out.push(text.slice(from, idx));
    out.push(
      <mark key={key++} className="rounded-sm bg-amber-300 text-ink-900">
        {text.slice(idx, idx + ql.length)}
      </mark>,
    );
    from = idx + ql.length;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}
