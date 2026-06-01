import type { Column, ForeignKey, Schema, Table } from '../parser/types';
import { typesCompatible } from '../parser/normalizeType';
import { canonicalFkKey } from '../parser/utils';
import {
  canonicalize,
  candidateBaseNames,
  pluralize,
  singularize,
  stripFkSuffix,
  tablePrefixes,
  tailFallbacks,
} from './nameMatching';

export type Confidence = 'high' | 'medium' | 'low';

export interface InferredFK extends ForeignKey {
  source: 'inferred';
  confidence: Confidence;
  reason: string;
}

export function inferForeignKeys(schema: Schema): InferredFK[] {
  const tableIndex = buildTableIndex(schema.tables);
  // Suppress inferred FKs whose (from-table, from-col) is already covered by
  // an explicit FK — even if the inferred target would differ, the explicit
  // declaration is authoritative.
  const explicitKeys = new Set(
    schema.explicitForeignKeys.map(
      (fk) => `${fk.fromTable.toLowerCase()}.${fk.fromColumns[0]?.toLowerCase()}`,
    ),
  );

  const inferred: InferredFK[] = [];

  for (const table of schema.tables) {
    for (const col of table.columns) {
      if (col.isPrimaryKey && table.primaryKey.length === 1) {
        // The PK column itself rarely points at another table — skip to avoid noise.
        if (col.name.toLowerCase() === 'id') continue;
      }

      const stripped = stripFkSuffix(col.name);
      if (!stripped) continue;
      const base = stripped.base;

      const result = pickBestTarget(base, col, table, tableIndex);
      if (!result) continue;

      const key = `${table.name.toLowerCase()}.${col.name.toLowerCase()}`;
      if (explicitKeys.has(key)) continue;
      if (result.target.name.toLowerCase() === table.name.toLowerCase()) {
        // Self-reference inferred only if base matches table singular form clearly
        if (canonicalize(base) !== canonicalize(singularize(table.name))) continue;
      }

      // Note the matched suffix family so the inference panel explains why a
      // `_ref`-named column was treated as a foreign key.
      if (stripped.via === 'ref') result.reason += ' (column uses _ref suffix)';

      inferred.push(buildFk(table, col, result));
    }
  }

  return inferred;
}

interface MatchResult {
  target: Table;
  targetPkColumn: Column;
  confidence: Confidence;
  reason: string;
  fallbackUsed: boolean;
}

function pickBestTarget(
  base: string,
  col: Column,
  ownTable: Table,
  index: Map<string, Table>,
): MatchResult | null {
  // 1. direct candidates
  const direct = lookupCandidates(base, index);
  const directHits = direct.filter(
    (t) =>
      t.name.toLowerCase() !== ownTable.name.toLowerCase() ||
      canonicalize(base) === canonicalize(singularize(ownTable.name)),
  );

  const typed = directHits
    .map((t) => withPk(t))
    .filter(
      (x): x is { table: Table; pk: Column } =>
        x !== null && typesCompatible(col.normalizedType, x.pk.normalizedType),
    );

  if (typed.length > 0) {
    const chosen = chooseAmongTargets(typed, col);
    const tableCanon = canonicalize(chosen.table.name);
    const baseCanon = canonicalize(base);
    const exact =
      tableCanon === baseCanon ||
      tableCanon === canonicalize(pluralize(base)) ||
      tableCanon === canonicalize(singularize(base));
    let confidence: Confidence;
    let reason: string;
    if (exact && col.hasIndex && typed.length === 1) {
      confidence = 'high';
      reason = 'Exact name match, types compatible, source column indexed';
    } else if (exact && typed.length === 1) {
      confidence = 'medium';
      reason = 'Exact name match, types compatible (no index on source column)';
    } else if (typed.length > 1) {
      confidence = 'medium';
      reason = `Multiple targets matched; picked ${chosen.table.name} (indexed=${col.hasIndex})`;
    } else {
      confidence = 'medium';
      reason = 'Name match required prefix normalization';
    }
    return {
      target: chosen.table,
      targetPkColumn: chosen.pk,
      confidence,
      reason,
      fallbackUsed: false,
    };
  }

  // 1.5 same-namespace prefix retry: a column like `credential_ref` in table
  // `iam_credential_device` references `iam_credential`, which the bare base
  // `credential` never resolves to. Prepend the source table's leading
  // namespace prefix(es) and retry. Only reached when the direct lookup found
  // nothing, so it can't change an existing high/medium match.
  for (const prefix of tablePrefixes(ownTable.name)) {
    const prefixHits = lookupCandidates(prefix + base, index)
      .filter((t) => t.name.toLowerCase() !== ownTable.name.toLowerCase())
      .map(withPk)
      .filter(
        (x): x is { table: Table; pk: Column } =>
          x !== null && typesCompatible(col.normalizedType, x.pk.normalizedType),
      );
    if (prefixHits.length > 0) {
      const chosen = chooseAmongTargets(prefixHits, col);
      return {
        target: chosen.table,
        targetPkColumn: chosen.pk,
        confidence: 'medium',
        reason: `Same-namespace prefix match (${base} → ${chosen.table.name})`,
        fallbackUsed: true,
      };
    }
  }

  // 2. fallback: compound prefix retry (parent_user_id → user)
  for (const tail of tailFallbacks(base)) {
    const tailHits = lookupCandidates(tail, index)
      .map(withPk)
      .filter(
        (x): x is { table: Table; pk: Column } =>
          x !== null && typesCompatible(col.normalizedType, x.pk.normalizedType),
      );
    if (tailHits.length > 0) {
      const chosen = chooseAmongTargets(tailHits, col);
      return {
        target: chosen.table,
        targetPkColumn: chosen.pk,
        confidence: 'low',
        reason: `Compound prefix fallback (${base} → ${tail})`,
        fallbackUsed: true,
      };
    }
  }

  return null;
}

function lookupCandidates(base: string, index: Map<string, Table>): Table[] {
  const out: Table[] = [];
  const seen = new Set<string>();
  for (const c of candidateBaseNames(base)) {
    const hit = index.get(canonicalize(c));
    if (hit && !seen.has(hit.name)) {
      seen.add(hit.name);
      out.push(hit);
    }
  }
  return out;
}

function withPk(table: Table): { table: Table; pk: Column } | null {
  if (table.primaryKey.length !== 1) return null;
  const pkName = table.primaryKey[0];
  const pk = table.columns.find((c) => c.name === pkName);
  return pk ? { table, pk } : null;
}

function chooseAmongTargets(
  hits: Array<{ table: Table; pk: Column }>,
  col: Column,
): { table: Table; pk: Column } {
  if (hits.length === 1) return hits[0];
  // Prefer the candidate whose PK matches the source column's normalized type exactly.
  const exactType = hits.filter((h) => h.pk.normalizedType === col.normalizedType);
  const pool = exactType.length > 0 ? exactType : hits;
  // Prefer indexed source column → target with non-composite PK already enforced above.
  // Among ties, prefer shorter table name (often canonical), then alphabetical.
  return pool.sort(
    (a, b) => a.table.name.length - b.table.name.length || a.table.name.localeCompare(b.table.name),
  )[0];
}

function buildTableIndex(tables: Table[]): Map<string, Table> {
  const m = new Map<string, Table>();
  for (const t of tables) {
    m.set(canonicalize(t.name), t);
  }
  return m;
}

function buildFk(table: Table, col: Column, m: MatchResult): InferredFK {
  return {
    fromTable: table.name,
    fromColumns: [col.name],
    toTable: m.target.name,
    toColumns: [m.targetPkColumn.name],
    source: 'inferred',
    confidence: m.confidence,
    reason: m.reason,
  };
}

/**
 * Back-compat re-export. New code should import `canonicalFkKey` from
 * `../parser/utils` directly.
 */
export const fkKey = canonicalFkKey;
