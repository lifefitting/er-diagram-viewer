import type { ForeignKey, ParseWarning, Schema, Table } from './types';
import { splitStatements, stripComments, splitTopLevel } from './tokenize';
import { parseCreateTable, detectInlineColumnRef } from './parseCreateTable';
import { parseAlterTable, parseCreateIndex } from './parseAlterTable';
import { applyIndexFlags, canonicalFkKey } from './utils';

export * from './types';
export { canonicalFkKey } from './utils';

/**
 * Statements we don't parse today but the user *might* expect us to. Worth a
 * warning instead of the silent skip branch — silence here looks like a bug.
 */
const KNOWN_UNSUPPORTED: Array<{ test: RegExp; message: string }> = [
  {
    test: /^\s*COMMENT\s+ON\b/i,
    message:
      "PostgreSQL `COMMENT ON` is not supported. Use inline column COMMENT or table-level COMMENT='...' instead.",
  },
  {
    test: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i,
    message: 'CREATE VIEW is skipped (not represented in the ER diagram).',
  },
  {
    test: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\b/i,
    message: 'CREATE MATERIALIZED VIEW is skipped.',
  },
  { test: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i, message: 'CREATE TRIGGER is skipped.' },
  { test: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i, message: 'CREATE FUNCTION is skipped.' },
  {
    test: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\b/i,
    message: 'CREATE PROCEDURE is skipped.',
  },
  {
    test: /^\s*CREATE\s+SEQUENCE\b/i,
    message: 'CREATE SEQUENCE is skipped (column-level SERIAL/IDENTITY is still detected).',
  },
  { test: /^\s*CREATE\s+TYPE\b/i, message: 'CREATE TYPE is skipped.' },
];

export function parseSql(sql: string): Schema {
  const tables: Table[] = [];
  const explicitForeignKeys: ForeignKey[] = [];
  const warnings: ParseWarning[] = [];
  const byName = new Map<string, Table>();

  for (const stmt of splitStatements(sql)) {
    const clean = stripComments(stmt.text);
    const upper = clean.trimStart().toUpperCase();

    if (upper.startsWith('CREATE') && /\bTABLE\b/i.test(upper.slice(0, 50))) {
      const result = parseCreateTable(clean);
      if (!result) {
        warnings.push({
          line: stmt.startLine,
          message: 'Could not parse CREATE TABLE',
          snippet: preview(stmt.text),
        });
        continue;
      }
      // Inline column REFERENCES (e.g. `user_id INT REFERENCES users(id)`)
      const bodyMatch = clean.match(/\(([\s\S]*)\)/);
      if (bodyMatch) {
        for (const part of splitTopLevel(bodyMatch[1])) {
          const fk = detectInlineColumnRef(part, result.table.name);
          if (fk) explicitForeignKeys.push(fk);
        }
      }
      tables.push(result.table);
      byName.set(result.table.name.toLowerCase(), result.table);
      explicitForeignKeys.push(...result.foreignKeys);
      continue;
    }

    if (upper.startsWith('ALTER')) {
      const eff = parseAlterTable(clean);
      if (!eff) {
        warnings.push({
          line: stmt.startLine,
          message: 'ALTER TABLE clause ignored',
          snippet: preview(stmt.text),
        });
        continue;
      }
      explicitForeignKeys.push(...eff.foreignKeys);
      const target = byName.get(eff.table.toLowerCase());
      if (target) {
        target.indexes.push(...eff.indexes);
        applyIndexFlags(target);
      }
      continue;
    }

    if (upper.startsWith('CREATE') && /\bINDEX\b/i.test(upper.slice(0, 40))) {
      const idx = parseCreateIndex(clean);
      if (idx) {
        const target = byName.get(idx.table.toLowerCase());
        if (target) {
          target.indexes.push(idx.index);
          applyIndexFlags(target);
        }
      }
      continue;
    }

    const unsupported = KNOWN_UNSUPPORTED.find((u) => u.test.test(clean));
    if (unsupported) {
      warnings.push({
        line: stmt.startLine,
        message: unsupported.message,
        snippet: preview(stmt.text),
      });
      continue;
    }

    // Silently skip unrelated statements (INSERT, COMMIT, SET, GRANT, ...).
  }

  return { tables, explicitForeignKeys: dedupeFks(explicitForeignKeys), warnings };
}

function preview(s: string): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed;
}

function dedupeFks(list: ForeignKey[]): ForeignKey[] {
  const seen = new Set<string>();
  const out: ForeignKey[] = [];
  for (const fk of list) {
    const key = canonicalFkKey(fk);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fk);
  }
  return out;
}
