import { nodeId } from '../diagram/nodeId';
import type { Schema, Table } from '../parser/types';

export type ColumnOrders = Record<string, string[]>;
export type ColumnDropPosition = 'before' | 'after';

/**
 * Return a complete column order for one drag/drop operation. The dragged
 * column is inserted before/after the target; unknown names are ignored so a
 * stale pointer gesture can never corrupt the schema.
 */
export function reorderColumnNames(
  names: readonly string[],
  dragged: string,
  target: string,
  position: ColumnDropPosition,
): string[] {
  if (dragged === target || !names.includes(dragged) || !names.includes(target)) return [...names];
  const next = names.filter((name) => name !== dragged);
  const targetIndex = next.indexOf(target);
  if (targetIndex < 0) return [...names];
  next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, dragged);
  return next;
}

function reconcileTableOrder(table: Table, requested: readonly string[]): string[] {
  const live = new Map(table.columns.map((column) => [column.name.toLowerCase(), column.name]));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of requested) {
    const key = name.toLowerCase();
    const canonical = live.get(key);
    if (canonical && !seen.has(key)) {
      seen.add(key);
      ordered.push(canonical);
    }
  }
  for (const column of table.columns) {
    const key = column.name.toLowerCase();
    if (!seen.has(key)) ordered.push(column.name);
  }
  return ordered;
}

/** Preserve orders for surviving tables/columns and append newly imported
 * columns in their SQL order. Table and column case-only renames are re-keyed. */
export function reconcileColumnOrders(orders: ColumnOrders, schema: Schema): ColumnOrders {
  const byTableId = new Map(Object.entries(orders).map(([name, order]) => [nodeId(name), order]));
  const next: ColumnOrders = {};
  for (const table of schema.tables) {
    const requested = byTableId.get(nodeId(table.name));
    if (requested) next[table.name] = reconcileTableOrder(table, requested);
  }
  return next;
}

/** Apply persisted presentation order without mutating parser output. */
export function applyColumnOrders(schema: Schema, orders: ColumnOrders): Schema {
  const reconciled = reconcileColumnOrders(orders, schema);
  let changed = false;
  const tables = schema.tables.map((table) => {
    const order = reconciled[table.name];
    if (!order) return table;
    const byName = new Map(table.columns.map((column) => [column.name.toLowerCase(), column]));
    const columns = order.flatMap((name) => {
      const column = byName.get(name.toLowerCase());
      return column ? [column] : [];
    });
    if (columns.every((column, index) => column === table.columns[index])) return table;
    changed = true;
    return { ...table, columns };
  });
  return changed ? { ...schema, tables } : schema;
}
