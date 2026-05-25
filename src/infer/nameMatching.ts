const TABLE_PREFIXES = ['t_', 'tbl_', 'tb_'];

/** Lowercase a name and strip common table-name prefixes (`t_`, `tbl_`, `tb_`). */
export function canonicalize(name: string): string {
  let lower = name.toLowerCase();
  for (const p of TABLE_PREFIXES) {
    if (lower.startsWith(p)) {
      lower = lower.slice(p.length);
      break;
    }
  }
  return lower;
}

/** Naive singularization: drops trailing s/es/ies (handling a few common cases). */
export function singularize(name: string): string {
  if (name.endsWith('ies') && name.length > 3) return name.slice(0, -3) + 'y';
  if (name.endsWith('ses') || name.endsWith('xes') || name.endsWith('zes') || name.endsWith('ches') || name.endsWith('shes')) {
    return name.slice(0, -2);
  }
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

/** Inverse of singularize (best-effort), used when the SQL has a plural table form. */
export function pluralize(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(name)) return name + 'es';
  return name + 's';
}

/** Strip a trailing `_id` / `Id` from a column name. Returns null if it has no id suffix. */
export function stripIdSuffix(colName: string): string | null {
  if (colName.endsWith('_id') && colName.length > 3) return colName.slice(0, -3);
  if (colName.endsWith('Id') && colName.length > 2 && /[a-z]/.test(colName[colName.length - 3])) {
    return colName.slice(0, -2);
  }
  if (colName.toLowerCase() === 'id') return null;
  return null;
}

/**
 * Generate ranked candidate base names to look up as target tables.
 * Returns multiple shapes (singular/plural, with/without common prefixes) ordered
 * roughly from highest to lowest precision so the inference engine can pick the best match.
 */
export function candidateBaseNames(rawBase: string): string[] {
  const base = rawBase.toLowerCase();
  const out = new Set<string>();
  const variants = [base, singularize(base), pluralize(base)];
  for (const v of variants) {
    if (!v) continue;
    out.add(v);
    out.add(pluralize(v));
    out.add(singularize(v));
    for (const p of TABLE_PREFIXES) {
      out.add(p + v);
      out.add(p + pluralize(v));
      out.add(p + singularize(v));
    }
  }
  return Array.from(out);
}

/**
 * Reduce a compound prefix name like `parent_user_id` (base = `parent_user`)
 * down to progressively shorter tails: `parent_user`, `user`. The first segment
 * (`parent`) is dropped because role prefixes (parent/owner/created_by) rarely
 * are themselves table names.
 */
export function tailFallbacks(base: string): string[] {
  const parts = base.split('_').filter(Boolean);
  if (parts.length <= 1) return [];
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(i).join('_'));
  }
  return out;
}
