import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './index';
import { effectiveForeignKeys } from './selectors';
import { canonicalFkKey } from '../parser/utils';
import type { ForeignKey } from '../parser/types';

// The motivating case: a detail table references its parent by a short
// `task_id`, but the parent's real name (`biz_check_task`) is reachable neither
// from the bare base `task` nor from the source table's own namespace prefix
// (`check_` → `check_task`, which doesn't exist) — so inference produces
// nothing and the user must add the FK by hand. (NB: when parent and detail
// share the namespace — `check_task` + `check_task_detail` — the prefix-retry
// rule DOES infer this; the manual path is for when naming defeats it.)
const SQL = [
  'CREATE TABLE biz_check_task (id BIGINT PRIMARY KEY, name VARCHAR(64));',
  'CREATE TABLE check_task_detail (id BIGINT PRIMARY KEY, task_id BIGINT, item VARCHAR(64));',
  'CREATE TABLE users (id BIGINT PRIMARY KEY);',
  'CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT);',
].join('\n');

const MANUAL: ForeignKey = {
  fromTable: 'check_task_detail',
  fromColumns: ['task_id'],
  toTable: 'biz_check_task',
  toColumns: ['id'],
  source: 'manual',
  reason: '用户手动添加',
};

beforeEach(() => {
  useApp.getState().setSql(SQL);
});

describe('addManualFk / removeManualFk', () => {
  it('adds a manual FK the engine could not infer', () => {
    const inferredKeys = useApp.getState().inferred.map(canonicalFkKey);
    expect(inferredKeys).not.toContain(canonicalFkKey(MANUAL)); // premise: not inferable

    useApp.getState().addManualFk(MANUAL);
    expect(useApp.getState().manualFks).toHaveLength(1);
    expect(useApp.getState().manualFks[0].source).toBe('manual');
  });

  it('refuses a duplicate of an existing manual FK', () => {
    useApp.getState().addManualFk(MANUAL);
    useApp.getState().addManualFk({ ...MANUAL, reason: 'again' });
    expect(useApp.getState().manualFks).toHaveLength(1);
  });

  it('refuses a key already taken by an inferred candidate (route-key invariant)', () => {
    const inferred = useApp.getState().inferred;
    const target = inferred.find((fk) => fk.fromTable === 'orders'); // user_id → users
    expect(target).toBeDefined();
    useApp.getState().addManualFk({ ...target!, source: 'manual' });
    expect(useApp.getState().manualFks).toHaveLength(0);
  });

  it('removes by canonical key', () => {
    useApp.getState().addManualFk(MANUAL);
    useApp.getState().removeManualFk(canonicalFkKey(MANUAL));
    expect(useApp.getState().manualFks).toHaveLength(0);
  });

  it('preserves kind and the DRAWN direction; the reverse still collides by key', () => {
    // Reverse-lexicographic input: storage must keep the drawn direction
    // (drag start = from) — only the KEY is order-normalized for logical.
    useApp.getState().addManualFk({
      fromTable: 'users',
      fromColumns: ['id'],
      toTable: 'check_task_detail',
      toColumns: ['item'],
      source: 'manual',
      kind: 'logical',
    });
    const stored = useApp.getState().manualFks[0];
    expect(stored.kind).toBe('logical');
    expect(stored.fromTable).toBe('users');
    expect(stored.toTable).toBe('check_task_detail');
    // Adding the reverse direction is refused (same normalized key).
    useApp.getState().addManualFk({
      fromTable: 'check_task_detail',
      fromColumns: ['item'],
      toTable: 'users',
      toColumns: ['id'],
      source: 'manual',
      kind: 'logical',
    });
    expect(useApp.getState().manualFks).toHaveLength(1);
  });

  it('is cleared by a new import (setSql) like decisions', () => {
    useApp.getState().addManualFk(MANUAL);
    useApp.getState().setSql('CREATE TABLE other (id INT PRIMARY KEY);');
    expect(useApp.getState().manualFks).toHaveLength(0);
  });

  it('survives reparse (refresh path)', () => {
    useApp.getState().addManualFk(MANUAL);
    useApp.getState().reparse();
    expect(useApp.getState().manualFks).toHaveLength(1);
  });
});

describe('setManualFkKind (手动连线面板的类型切换)', () => {
  it('flips kind while PRESERVING the drawn direction (start = FK holder)', () => {
    useApp.getState().addManualFk(MANUAL); // check_task_detail.task_id → biz_check_task.id (fk)
    const key = canonicalFkKey(useApp.getState().manualFks[0]);
    const err = useApp.getState().setManualFkKind(key, 'logical');
    expect(err).toBeNull();
    const logical = useApp.getState().manualFks[0];
    expect(logical.kind).toBe('logical');
    expect(logical.fromTable).toBe('check_task_detail'); // drawn direction kept
    // Flip back to physical: the FK must point drag-start → drag-end again.
    const err2 = useApp.getState().setManualFkKind(canonicalFkKey(logical), 'fk');
    expect(err2).toBeNull();
    const fk = useApp.getState().manualFks[0];
    expect(fk.kind).toBe('fk');
    expect(fk.fromTable).toBe('check_task_detail');
    expect(fk.toTable).toBe('biz_check_task');
  });

  it('refuses a flip whose re-normalized key collides with another relation', () => {
    // Existing logical link on the normalized path…
    useApp.getState().addManualFk({
      fromTable: 'check_task_detail',
      fromColumns: ['item'],
      toTable: 'users',
      toColumns: ['id'],
      source: 'manual',
      kind: 'logical',
    });
    // …plus a physical FK stored in the reverse direction (distinct key).
    useApp.getState().addManualFk({
      fromTable: 'users',
      fromColumns: ['id'],
      toTable: 'check_task_detail',
      toColumns: ['item'],
      source: 'manual',
      kind: 'fk',
    });
    expect(useApp.getState().manualFks).toHaveLength(2);
    const fkKey2 = canonicalFkKey(useApp.getState().manualFks[1]);
    const err = useApp.getState().setManualFkKind(fkKey2, 'logical');
    expect(err).toBe('同路径已存在其他关系，无法切换类型');
    expect(useApp.getState().manualFks[1].kind).toBe('fk'); // unchanged
  });
});

describe('effectiveForeignKeys with manual FKs', () => {
  it('always includes manual FKs (no decision gating)', () => {
    const { schema, inferred } = useApp.getState();
    const out = effectiveForeignKeys(schema, inferred, {}, false, {}, [MANUAL]);
    expect(out.some((fk) => canonicalFkKey(fk) === canonicalFkKey(MANUAL))).toBe(true);
  });

  it('filters manual FKs touching a recycle-binned table', () => {
    const { schema, inferred } = useApp.getState();
    const out = effectiveForeignKeys(
      schema,
      inferred,
      {},
      false,
      { 't:biz_check_task': { action: 'delete', updatedAt: '' } },
      [MANUAL],
    );
    expect(out.some((fk) => canonicalFkKey(fk) === canonicalFkKey(MANUAL))).toBe(false);
  });

  it('skips a stale manual FK whose table no longer exists in the schema', () => {
    const { schema, inferred } = useApp.getState();
    const stale: ForeignKey = { ...MANUAL, toTable: 'gone_table' };
    const out = effectiveForeignKeys(schema, inferred, {}, false, {}, [stale]);
    expect(out.some((fk) => fk.toTable === 'gone_table')).toBe(false);
  });
});
