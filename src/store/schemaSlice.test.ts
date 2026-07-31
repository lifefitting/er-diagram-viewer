import { beforeEach, describe, expect, it } from 'vitest';
import { nodeId } from '../diagram/nodeId';
import { canonicalFkKey } from '../parser/utils';
import { fieldNoteKey } from './notesSlice';
import { useApp } from './index';

const BASE_SQL = [
  'CREATE TABLE users (id BIGINT PRIMARY KEY, email VARCHAR(128));',
  'CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT, total INT);',
].join('\n');

const APPENDED_SQL = [
  BASE_SQL,
  'CREATE TABLE payments (id BIGINT PRIMARY KEY, order_id BIGINT);',
].join('\n');

describe('incremental SQL updates', () => {
  beforeEach(() => {
    // setSql intentionally remains the full-replacement API and gives every
    // test a clean workspace even though the table set overlaps.
    useApp.getState().setSql(BASE_SQL);
  });

  it('preserves surviving layout and review state when tables are appended', () => {
    const inferredKey = canonicalFkKey(useApp.getState().inferred[0]);
    useApp.setState({
      nodePositions: {
        [nodeId('users')]: { x: 120, y: 80 },
        [nodeId('orders')]: { x: 520, y: 260 },
      },
      viewport: { x: -20, y: 40, zoom: 1.4 },
      collapsed: { users: true },
      tableWidths: { orders: 360 },
      decisions: { [inferredKey]: 'accept' },
      manualRoutes: {
        [inferredKey]: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
      deletedTables: {
        [nodeId('users')]: { action: 'delete', updatedAt: '2026-07-31T10:00:00.000Z' },
      },
    });
    useApp.getState().setFieldNote('orders', 'total', '金额字段需统一精度');

    useApp.getState().updateSql(APPENDED_SQL);
    const state = useApp.getState();

    expect(state.schema?.tables.map((table) => table.name)).toEqual([
      'users',
      'orders',
      'payments',
    ]);
    expect(state.nodePositions).toEqual({
      [nodeId('users')]: { x: 120, y: 80 },
      [nodeId('orders')]: { x: 520, y: 260 },
    });
    expect(nodeId('payments') in state.nodePositions).toBe(false);
    expect(state.viewport).toEqual({ x: -20, y: 40, zoom: 1.4 });
    expect(state.collapsed).toEqual({ users: true });
    expect(state.tableWidths).toEqual({ orders: 360 });
    expect(state.decisions).toEqual({ [inferredKey]: 'accept' });
    expect(state.manualRoutes[inferredKey]).toHaveLength(2);
    expect(state.deletedTables[nodeId('users')].action).toBe('delete');
    expect(state.fieldNotes[fieldNoteKey('orders', 'total')].text).toBe('金额字段需统一精度');
  });

  it('prunes state belonging to removed tables, columns and relations', () => {
    const inferredKey = canonicalFkKey(useApp.getState().inferred[0]);
    useApp.setState({
      nodePositions: {
        [nodeId('users')]: { x: 100, y: 100 },
        [nodeId('orders')]: { x: 400, y: 100 },
      },
      collapsed: { users: true, orders: true },
      tableWidths: { users: 280, orders: 320 },
      decisions: { [inferredKey]: 'reject' },
      manualRoutes: {
        [inferredKey]: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
      deletedTables: {
        [nodeId('orders')]: { action: 'delete', updatedAt: '2026-07-31T10:00:00.000Z' },
      },
    });
    useApp.getState().setFieldNote('orders', 'total', '将随表一起移除');

    useApp
      .getState()
      .updateSql(
        [
          'CREATE TABLE users (id BIGINT PRIMARY KEY, email VARCHAR(128));',
          'CREATE TABLE payments (id BIGINT PRIMARY KEY, user_id BIGINT);',
        ].join('\n'),
      );
    const state = useApp.getState();

    expect(state.nodePositions).toEqual({ [nodeId('users')]: { x: 100, y: 100 } });
    expect(state.collapsed).toEqual({ users: true });
    expect(state.tableWidths).toEqual({ users: 280 });
    expect(state.decisions).toEqual({});
    expect(state.manualRoutes).toEqual({});
    expect(state.deletedTables).toEqual({});
    expect(state.fieldNotes).toEqual({});
  });

  it('falls back to a fresh workspace for a completely unrelated schema', () => {
    useApp.setState({
      nodePositions: { [nodeId('users')]: { x: 100, y: 100 } },
      viewport: { x: 5, y: 8, zoom: 1.2 },
      collapsed: { users: true },
      tableWidths: { users: 300 },
    });

    useApp.getState().updateSql('CREATE TABLE ledger (id BIGINT PRIMARY KEY);');
    const state = useApp.getState();

    expect(state.schema?.tables.map((table) => table.name)).toEqual(['ledger']);
    expect(state.nodePositions).toEqual({});
    expect(state.viewport).toBeNull();
    expect(state.collapsed).toEqual({});
    expect(state.tableWidths).toEqual({});
  });

  it('rekeys table and field state across case-only identifier changes', () => {
    useApp.setState({
      tableWidths: { users: 333 },
      collapsed: { users: true },
    });
    useApp.getState().setFieldNote('users', 'email', '保留批注');

    useApp
      .getState()
      .updateSql(
        [
          'CREATE TABLE Users (id BIGINT PRIMARY KEY, Email VARCHAR(128));',
          'CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT, total INT);',
        ].join('\n'),
      );
    const state = useApp.getState();

    expect(state.tableWidths).toEqual({ Users: 333 });
    expect(state.collapsed).toEqual({ Users: true });
    expect(state.fieldNotes[fieldNoteKey('Users', 'Email')].text).toBe('保留批注');
  });
});
