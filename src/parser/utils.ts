import type { ForeignKey, Table } from './types';
import { unquoteIdent } from './tokenize';

/**
 * Promote single-column indexes / unique indexes onto column flags so the UI
 * and FK inference engine can read `col.hasIndex` / `col.isUnique` without
 * scanning every index. Shared by `parseCreateTable` (table-local indexes)
 * and `parser/index.ts` (post ALTER/CREATE INDEX merges).
 */
export function applyIndexFlags(table: Table): void {
  for (const col of table.columns) {
    const singleCol = table.indexes.filter(
      (idx) => idx.columns.length === 1 && idx.columns[0] === col.name,
    );
    if (singleCol.length === 0) continue;
    col.hasIndex = true;
    if (singleCol.some((idx) => idx.unique)) col.isUnique = true;
  }
}

/**
 * Split a qualified identifier like `myschema.users` into its parts. The last
 * segment is the table name; any preceding segments are joined back into the
 * schema. Each segment is unquoted.
 */
export function splitQualified(raw: string): { schema?: string; name: string } {
  const parts = raw.split('.').map(unquoteIdent);
  if (parts.length === 1) return { name: parts[0] };
  return { schema: parts.slice(0, -1).join('.'), name: parts[parts.length - 1] };
}

/**
 * Canonical FK identity used everywhere downstream (decisions map, dedupe,
 * explicit/inferred merge). Case-insensitive so a schema with mixed-case
 * table names (`users` vs `Users`) doesn't fragment the key space.
 *
 * Must stay stable: the persisted `decisions` dict uses this exact string.
 */
export function canonicalFkKey(fk: ForeignKey): string {
  const from = `${fk.fromTable}.${fk.fromColumns.join(',')}`.toLowerCase();
  const to = `${fk.toTable}.${fk.toColumns.join(',')}`.toLowerCase();
  return `${from}->${to}`;
}
