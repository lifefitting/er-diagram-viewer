import type { ForeignKey, IndexDef } from './types';
import { splitTopLevel, unquoteIdent } from './tokenize';
import { splitQualified } from './utils';

export interface AlterEffects {
  table: string;
  foreignKeys: ForeignKey[];
  indexes: IndexDef[];
}

/** Parse `ALTER TABLE name ADD ...`. Returns null if not an ALTER TABLE. */
export function parseAlterTable(stmt: string): AlterEffects | null {
  const header = stmt.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([^\s]+)\s+/i);
  if (!header) return null;
  const tableName = splitQualified(header[1]).name;
  const rest = stmt.slice(header[0].length);

  const foreignKeys: ForeignKey[] = [];
  const indexes: IndexDef[] = [];

  for (const clause of splitTopLevel(rest)) {
    const fkMatch = clause.match(
      /ADD\s+(?:CONSTRAINT\s+(\S+)\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i,
    );
    if (fkMatch) {
      const constraintName = fkMatch[1] ? unquoteIdent(fkMatch[1]) : undefined;
      const fromColumns = splitTopLevel(fkMatch[2]).map(unquoteIdent);
      const target = splitQualified(fkMatch[3]);
      const toColumns = splitTopLevel(fkMatch[4]).map(unquoteIdent);
      foreignKeys.push({
        fromTable: tableName,
        fromColumns,
        toTable: target.name,
        toColumns,
        constraintName,
        source: 'explicit',
      });
      continue;
    }

    const idxMatch = clause.match(/ADD\s+(UNIQUE\s+)?(?:INDEX|KEY)\s+(\S+)?\s*\(([^)]+)\)/i);
    if (idxMatch) {
      indexes.push({
        name: idxMatch[2] ? unquoteIdent(idxMatch[2]) : undefined,
        columns: splitTopLevel(idxMatch[3]).map((s) => unquoteIdent(s.split(/\s+/)[0])),
        unique: Boolean(idxMatch[1]),
      });
    }
  }

  if (foreignKeys.length === 0 && indexes.length === 0) return null;
  return { table: tableName, foreignKeys, indexes };
}

/** Parse `CREATE [UNIQUE] INDEX name ON table(cols)`. */
export function parseCreateIndex(stmt: string): { table: string; index: IndexDef } | null {
  const m = stmt.match(
    /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+ON\s+([^\s(]+)\s*\(([^)]+)\)/i,
  );
  if (!m) return null;
  const tableParts = m[3].split('.').map(unquoteIdent);
  return {
    table: tableParts[tableParts.length - 1],
    index: {
      name: unquoteIdent(m[2]),
      columns: splitTopLevel(m[4]).map((s) => unquoteIdent(s.split(/\s+/)[0])),
      unique: Boolean(m[1]),
    },
  };
}
