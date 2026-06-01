import type { Column, ForeignKey, IndexDef, Table } from './types';
import { normalizeType } from './normalizeType';
import { matchClosingParen, splitTopLevel, unquoteIdent } from './tokenize';
import { applyIndexFlags, splitQualified } from './utils';

const RESERVED_CONSTRAINT_KEYWORDS = new Set([
  'PRIMARY',
  'UNIQUE',
  'KEY',
  'INDEX',
  'FOREIGN',
  'CONSTRAINT',
  'CHECK',
  'FULLTEXT',
  'SPATIAL',
]);

interface CreateTableResult {
  table: Table;
  foreignKeys: ForeignKey[];
}

/**
 * Parse a `CREATE TABLE [schema.]name (... body ...) [trailing options];`
 * Returns null if the statement isn't a CREATE TABLE.
 */
export function parseCreateTable(stmt: string): CreateTableResult | null {
  const headerMatch = stmt.match(
    /^\s*CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMPORARY\s+|TEMP\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/i,
  );
  if (!headerMatch) return null;

  const fullName = headerMatch[1];
  const { schema, name } = splitQualified(fullName);

  const openIdx = stmt.indexOf('(', headerMatch.index! + headerMatch[0].length - 1);
  const closeIdx = matchClosingParen(stmt, openIdx);
  if (closeIdx < 0) return null;
  const body = stmt.slice(openIdx + 1, closeIdx);

  const tableComment = extractTableComment(stmt.slice(closeIdx + 1));

  const columns: Column[] = [];
  const indexes: IndexDef[] = [];
  const foreignKeys: ForeignKey[] = [];
  const primaryKey: string[] = [];

  for (const part of splitTopLevel(body)) {
    const upper = part.trimStart().toUpperCase();
    const firstToken = upper.split(/\s+/)[0];

    if (firstToken === 'CONSTRAINT') {
      const afterName = part.replace(/^\s*CONSTRAINT\s+\S+\s+/i, '');
      const constraintName = part.match(/^\s*CONSTRAINT\s+(\S+)/i)?.[1];
      handleNamedConstraint(
        afterName,
        name,
        constraintName ? unquoteIdent(constraintName) : undefined,
        {
          primaryKey,
          indexes,
          foreignKeys,
        },
      );
      continue;
    }

    if (firstToken === 'PRIMARY') {
      const cols = extractParenColumns(part);
      cols.forEach((c) => primaryKey.push(c));
      continue;
    }

    if (firstToken === 'UNIQUE') {
      const cols = extractParenColumns(part);
      const idxName = part.match(/UNIQUE\s+(?:KEY|INDEX)?\s*([^\s(]+)?/i)?.[1];
      indexes.push({
        name: idxName ? unquoteIdent(idxName) : undefined,
        columns: cols,
        unique: true,
      });
      continue;
    }

    if (
      firstToken === 'KEY' ||
      firstToken === 'INDEX' ||
      firstToken === 'FULLTEXT' ||
      firstToken === 'SPATIAL'
    ) {
      const cols = extractParenColumns(part);
      const idxName = part.match(/(?:KEY|INDEX)\s+([^\s(]+)?/i)?.[1];
      indexes.push({
        name: idxName ? unquoteIdent(idxName) : undefined,
        columns: cols,
        unique: false,
      });
      continue;
    }

    if (firstToken === 'FOREIGN') {
      const fk = parseInlineForeignKey(part, name);
      if (fk) foreignKeys.push(fk);
      continue;
    }

    if (firstToken === 'CHECK') {
      continue;
    }

    if (RESERVED_CONSTRAINT_KEYWORDS.has(firstToken)) continue;

    const col = parseColumnDef(part);
    if (col) {
      columns.push(col);
      if (col.isPrimaryKey && !primaryKey.includes(col.name)) primaryKey.push(col.name);
    }
  }

  // Promote PK + single-column index/unique onto column flags.
  for (const col of columns) {
    if (primaryKey.includes(col.name)) col.isPrimaryKey = true;
  }
  const table: Table = {
    name,
    schema,
    columns,
    primaryKey,
    indexes,
    comment: tableComment,
  };
  applyIndexFlags(table);

  return { table, foreignKeys };
}

function extractTableComment(trailing: string): string | undefined {
  const m = trailing.match(/COMMENT\s*=?\s*'((?:[^'\\]|\\.)*)'/i);
  return m ? m[1] : undefined;
}

function extractParenColumns(part: string): string[] {
  const m = part.match(/\(([^)]*)\)/);
  if (!m) return [];
  return splitTopLevel(m[1]).map((s) => {
    // Remove optional length/order: `col_name`(10) ASC
    const ident = s.replace(/\([^)]*\)/g, '').split(/\s+/)[0];
    return unquoteIdent(ident);
  });
}

function parseInlineForeignKey(
  part: string,
  fromTable: string,
  constraintName?: string,
): ForeignKey | null {
  const m = part.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i);
  if (!m) return null;
  const fromColumns = splitTopLevel(m[1]).map(unquoteIdent);
  const target = splitQualified(m[2]);
  const toColumns = splitTopLevel(m[3]).map(unquoteIdent);
  return {
    fromTable,
    fromColumns,
    toTable: target.name,
    toColumns,
    constraintName,
    source: 'explicit',
  };
}

function handleNamedConstraint(
  rest: string,
  fromTable: string,
  constraintName: string | undefined,
  ctx: { primaryKey: string[]; indexes: IndexDef[]; foreignKeys: ForeignKey[] },
) {
  const upper = rest.trimStart().toUpperCase();
  if (upper.startsWith('PRIMARY')) {
    extractParenColumns(rest).forEach((c) => ctx.primaryKey.push(c));
    return;
  }
  if (upper.startsWith('UNIQUE')) {
    ctx.indexes.push({
      name: constraintName,
      columns: extractParenColumns(rest),
      unique: true,
    });
    return;
  }
  if (upper.startsWith('FOREIGN')) {
    const fk = parseInlineForeignKey(rest, fromTable, constraintName);
    if (fk) ctx.foreignKeys.push(fk);
    return;
  }
}

function parseColumnDef(part: string): Column | null {
  const trimmed = part.trim();
  if (!trimmed) return null;
  const nameMatch = trimmed.match(/^(`[^`]+`|"[^"]+"|\[[^\]]+\]|\S+)/);
  if (!nameMatch) return null;
  const name = unquoteIdent(nameMatch[1]);
  const rest = trimmed.slice(nameMatch[0].length).trim();

  // Single-word type with optional length; multi-word types are added via explicit continuations
  // below so we don't accidentally eat NOT / DEFAULT / etc. as part of the type.
  const typeMatch = rest.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(\([^)]*\))?/);
  let rawType = 'unknown';
  let afterType = rest;
  if (typeMatch) {
    rawType = (typeMatch[1] + (typeMatch[2] ?? '')).trim();
    afterType = rest.slice(typeMatch[0].length).trim();
    const head = typeMatch[1].toUpperCase();
    if (head === 'DOUBLE') {
      const m = afterType.match(/^PRECISION\b/i);
      if (m) {
        rawType += ' PRECISION';
        afterType = afterType.slice(m[0].length).trim();
      }
    } else if (head === 'CHARACTER' || head === 'BIT') {
      const m = afterType.match(/^VARYING\s*(\([^)]*\))?/i);
      if (m) {
        rawType += ' VARYING' + (m[1] ?? '');
        afterType = afterType.slice(m[0].length).trim();
      }
    } else if (head === 'TIMESTAMP' || head === 'TIME') {
      const m = afterType.match(/^WITH(?:OUT)?\s+TIME\s+ZONE\b/i);
      if (m) {
        rawType += ' ' + m[0].toUpperCase();
        afterType = afterType.slice(m[0].length).trim();
      }
    }
  }

  const upperAfter = afterType.toUpperCase();
  const nullable = !/\bNOT\s+NULL\b/i.test(afterType);
  const isPrimaryKey = /\bPRIMARY\s+KEY\b/i.test(afterType);
  const isUnique = /\bUNIQUE\b/i.test(afterType);
  const isAutoIncrement =
    /\bAUTO_INCREMENT\b/i.test(afterType) ||
    /\bAUTOINCREMENT\b/i.test(afterType) ||
    /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(afterType) ||
    /^(SERIAL|BIGSERIAL|SMALLSERIAL)\b/i.test(rawType);

  const defaultMatch = afterType.match(/\bDEFAULT\s+('(?:[^'\\]|\\.)*'|[^,\s]+(?:\([^)]*\))?)/i);
  const commentMatch = afterType.match(/\bCOMMENT\s+'((?:[^'\\]|\\.)*)'/i);
  const refMatch = upperAfter.match(/REFERENCES\s+[^\s(]+\s*\(/i);

  const column: Column = {
    name,
    rawType,
    normalizedType: normalizeType(rawType),
    nullable,
    isPrimaryKey,
    isUnique,
    hasIndex: isUnique || isPrimaryKey,
    isAutoIncrement,
    defaultValue: defaultMatch ? defaultMatch[1] : undefined,
    comment: commentMatch ? commentMatch[1] : undefined,
  };

  // (inline REFERENCES is collected by callers via parseInlineForeignKey on the column line;
  //  we don't synthesize here to keep responsibilities split — see parser/index.ts)
  void refMatch;

  return column;
}

/** Detect an inline `REFERENCES other(col)` on a column line and return a FK if present. */
export function detectInlineColumnRef(part: string, fromTable: string): ForeignKey | null {
  const trimmed = part.trim();
  const firstToken = trimmed.split(/\s+/)[0]?.toUpperCase();
  if (firstToken && RESERVED_CONSTRAINT_KEYWORDS.has(firstToken)) return null;
  const nameMatch = trimmed.match(/^(`[^`]+`|"[^"]+"|\[[^\]]+\]|\S+)/);
  if (!nameMatch) return null;
  const colName = unquoteIdent(nameMatch[1]);
  const refMatch = part.match(/REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i);
  if (!refMatch) return null;
  const target = refMatch[1].split('.').map(unquoteIdent);
  const targetName = target[target.length - 1];
  const toColumns = splitTopLevel(refMatch[2]).map(unquoteIdent);
  return {
    fromTable,
    fromColumns: [colName],
    toTable: targetName,
    toColumns,
    source: 'explicit',
  };
}
