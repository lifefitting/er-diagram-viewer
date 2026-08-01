import { describe, expect, it } from 'vitest';
import type { Schema } from '../parser/types';
import { applyColumnOrders, reconcileColumnOrders, reorderColumnNames } from './columnOrder';

function schema(columns: string[]): Schema {
  return {
    tables: [
      {
        name: 'orders',
        columns: columns.map((name) => ({
          name,
          rawType: 'INT',
          normalizedType: 'int' as const,
          nullable: true,
          isPrimaryKey: false,
          isUnique: false,
          hasIndex: false,
          isAutoIncrement: false,
        })),
        primaryKey: [],
        indexes: [],
      },
    ],
    explicitForeignKeys: [],
    warnings: [],
  };
}

describe('field display order', () => {
  it('inserts a dragged field before or after the target', () => {
    const names = ['id', 'user_id', 'status', 'created_at'];
    expect(reorderColumnNames(names, 'created_at', 'user_id', 'before')).toEqual([
      'id',
      'created_at',
      'user_id',
      'status',
    ]);
    expect(reorderColumnNames(names, 'id', 'status', 'after')).toEqual([
      'user_id',
      'status',
      'id',
      'created_at',
    ]);
  });

  it('ignores stale or no-op drag targets', () => {
    const names = ['id', 'status'];
    expect(reorderColumnNames(names, 'id', 'id', 'before')).toEqual(names);
    expect(reorderColumnNames(names, 'missing', 'status', 'after')).toEqual(names);
  });

  it('preserves surviving order, rekeys case changes and appends new fields', () => {
    const next = schema(['ID', 'status', 'created_at']);
    const reconciled = reconcileColumnOrders({ Orders: ['status', 'id', 'removed'] }, next);
    expect(reconciled).toEqual({ orders: ['status', 'ID', 'created_at'] });
    expect(
      applyColumnOrders(next, reconciled).tables[0].columns.map((column) => column.name),
    ).toEqual(['status', 'ID', 'created_at']);
  });
});
