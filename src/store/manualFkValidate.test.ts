import { describe, expect, it } from 'vitest';
import { manualFkFromDraft, validateManualFk } from './manualFkValidate';
import { canonicalFkKey } from '../parser/utils';
import { parseSql } from '../parser';
import { inferForeignKeys } from '../infer/inferForeignKeys';

const SQL = [
  'CREATE TABLE biz_check_task (id BIGINT PRIMARY KEY, name VARCHAR(64));',
  'CREATE TABLE check_task_detail (id BIGINT PRIMARY KEY, task_id BIGINT);',
  'CREATE TABLE users (id BIGINT PRIMARY KEY);',
  'CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT,',
  '  CONSTRAINT fk_o_u FOREIGN KEY (user_id) REFERENCES users (id));',
].join('\n');

const schema = parseSql(SQL);
const inferred = inferForeignKeys(schema);

const DRAFT = {
  fromTable: 'check_task_detail',
  fromColumn: 'task_id',
  toTable: 'biz_check_task',
  toColumn: 'id',
};

describe('validateManualFk', () => {
  it('accepts a draft the engine cannot infer', () => {
    expect(validateManualFk(DRAFT, schema, inferred, [])).toBeNull();
  });

  it('rejects a self same-column draft', () => {
    const d = { ...DRAFT, toTable: DRAFT.fromTable, toColumn: DRAFT.fromColumn };
    expect(validateManualFk(d, schema, inferred, [])).toBe('不能指向自身同一列');
  });

  it('rejects a duplicate of an explicit FK (case-insensitive)', () => {
    const d = { fromTable: 'ORDERS', fromColumn: 'USER_ID', toTable: 'users', toColumn: 'id' };
    expect(validateManualFk(d, schema, inferred, [])).toBe('该外键已在 DDL 中显式声明');
  });

  it('rejects a duplicate of an already-added manual FK', () => {
    const existing = [manualFkFromDraft(DRAFT)];
    expect(validateManualFk(DRAFT, schema, inferred, existing)).toBe('已添加过该外键');
  });

  it('manualFkFromDraft tags source=manual with single-column sides', () => {
    const fk = manualFkFromDraft(DRAFT);
    expect(fk.source).toBe('manual');
    expect(fk.kind).toBe('fk');
    expect(fk.fromColumns).toEqual(['task_id']);
    expect(fk.toColumns).toEqual(['id']);
  });
});

describe('logical drafts', () => {
  const LOGICAL = {
    fromTable: 'orders',
    fromColumn: 'out_no',
    toTable: 'biz_check_task',
    toColumn: 'name',
    kind: 'logical' as const,
  };

  it('keeps the drawn direction but a draft and its reverse share one key', () => {
    const a = manualFkFromDraft(LOGICAL);
    const b = manualFkFromDraft({
      ...LOGICAL,
      fromTable: LOGICAL.toTable,
      fromColumn: LOGICAL.toColumn,
      toTable: LOGICAL.fromTable,
      toColumn: LOGICAL.fromColumn,
    });
    // Storage preserves how the user drew it (drag start = from)…
    expect(a.fromTable).toBe('orders');
    expect(b.fromTable).toBe('biz_check_task');
    // …while the canonical key is direction-normalized for logical links.
    expect(canonicalFkKey(a)).toBe(canonicalFkKey(b));
  });

  it('rejects the reverse of an existing manual logical link', () => {
    const existing = [manualFkFromDraft(LOGICAL)];
    const reversed = {
      ...LOGICAL,
      fromTable: LOGICAL.toTable,
      fromColumn: LOGICAL.toColumn,
      toTable: LOGICAL.fromTable,
      toColumn: LOGICAL.fromColumn,
    };
    expect(validateManualFk(reversed, schema, inferred, existing)).toBe('已添加过该逻辑关联');
  });

  it('names the existing kind when a physical draft hits a logical link path', () => {
    const existing = [manualFkFromDraft(LOGICAL)];
    // Physical draft along the stored (normalized) direction shares the key.
    const physical = {
      fromTable: 'biz_check_task',
      fromColumn: 'name',
      toTable: 'orders',
      toColumn: 'out_no',
    };
    expect(validateManualFk(physical, schema, inferred, existing)).toBe(
      '该路径已存在手动逻辑关联，请先移除它',
    );
  });
});
