import type { NormalizedType } from './types';

const TYPE_MAP: Array<[RegExp, NormalizedType]> = [
  [/^uuid$/i, 'uuid'],
  [/^(tinyint|smallint|mediumint|int|integer|bigint|serial|bigserial|smallserial|int2|int4|int8)\b/i, 'int'],
  [/^(numeric|decimal|float|double|real|money)\b/i, 'float'],
  [/^(char|varchar|text|longtext|mediumtext|tinytext|nvarchar|nchar|character|string|clob|enum|set)\b/i, 'string'],
  [/^(date|datetime|timestamp|time|timestamptz|timetz|year|interval)\b/i, 'date'],
  [/^(bool|boolean|bit)\b/i, 'bool'],
  [/^(blob|binary|varbinary|longblob|mediumblob|tinyblob|bytea)\b/i, 'blob'],
  [/^json(b)?\b/i, 'json'],
];

export function normalizeType(raw: string): NormalizedType {
  const trimmed = raw.trim();
  for (const [re, kind] of TYPE_MAP) {
    if (re.test(trimmed)) return kind;
  }
  return 'unknown';
}

export function typesCompatible(a: NormalizedType, b: NormalizedType): boolean {
  if (a === 'unknown' || b === 'unknown') return true;
  return a === b;
}
