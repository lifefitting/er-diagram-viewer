import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './index';

const SQL = [
  'CREATE TABLE orders (id BIGINT PRIMARY KEY, out_trade_no VARCHAR(64));',
  'CREATE TABLE payments (id BIGINT PRIMARY KEY, out_trade_no VARCHAR(64), UNIQUE KEY uk (out_trade_no));',
  'CREATE TABLE refunds (id BIGINT PRIMARY KEY, out_trade_no VARCHAR(64));',
].join('\n');

const logicalCount = () =>
  useApp.getState().inferred.filter((f) => f.kind === 'logical').length;

describe('logicalKeys lifecycle (user-triggered logical inference)', () => {
  beforeEach(() => {
    useApp.getState().setSql(SQL);
  });

  it('import produces NO logical candidates by default', () => {
    expect(useApp.getState().logicalKeys).toEqual([]);
    expect(logicalCount()).toBe(0);
  });

  it('setLogicalKeys generates candidates; clearing removes them', () => {
    useApp.getState().setLogicalKeys(['out_trade_no']);
    expect(logicalCount()).toBe(2); // star around payments
    useApp.getState().setLogicalKeys([]);
    expect(logicalCount()).toBe(0);
  });

  it('reparse (refresh) re-derives candidates from the persisted keys', () => {
    useApp.getState().setLogicalKeys(['out_trade_no']);
    useApp.getState().reparse();
    expect(logicalCount()).toBe(2);
  });

  it('a new import clears the picked keys (old schema column names)', () => {
    useApp.getState().setLogicalKeys(['out_trade_no']);
    useApp.getState().setSql('CREATE TABLE t (id INT PRIMARY KEY);');
    expect(useApp.getState().logicalKeys).toEqual([]);
    expect(logicalCount()).toBe(0);
  });
});
