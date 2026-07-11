import { describe, expect, it } from 'vitest';
import type { ForeignKey } from '../parser/types';
import { appendInferredToScript, toAlterTableDdl } from './toDdl';

const physical: ForeignKey = {
  fromTable: 'orders',
  fromColumns: ['user_id'],
  toTable: 'users',
  toColumns: ['id'],
  source: 'inferred',
};

const logical: ForeignKey = {
  fromTable: 'orders',
  fromColumns: ['out_trade_no'],
  toTable: 'payments',
  toColumns: ['out_trade_no'],
  source: 'inferred',
  kind: 'logical',
  reason: 'Shared business key "out_trade_no" across 2 tables; unique on payments (hub)',
};

describe('toAlterTableDdl kind split', () => {
  it('physical FKs become ALTER TABLE statements', () => {
    const out = toAlterTableDdl([physical]);
    expect(out).toContain('ALTER TABLE `orders` ADD CONSTRAINT');
    expect(out).not.toContain('LOGICAL');
  });

  it('logical links become comment lines only — never a constraint', () => {
    const out = toAlterTableDdl([logical]);
    expect(out).toContain('-- Logical links (business keys, no physical constraint)');
    expect(out).toContain('-- LOGICAL: orders.out_trade_no ~ payments.out_trade_no');
    expect(out).toContain('(Shared business key');
    expect(out).not.toContain('ALTER TABLE');
  });

  it('mixed input produces both sections', () => {
    const out = toAlterTableDdl([logical, physical]);
    expect(out).toContain('ALTER TABLE `orders`');
    expect(out).toContain('-- LOGICAL: orders.out_trade_no ~ payments.out_trade_no');
    // Physical section first, blank line between sections.
    expect(out.indexOf('ALTER TABLE')).toBeLessThan(out.indexOf('-- LOGICAL'));
  });

  it('empty input appends nothing to the script', () => {
    expect(toAlterTableDdl([])).toBe('');
    expect(appendInferredToScript('CREATE TABLE a (id INT);', [])).toBe(
      'CREATE TABLE a (id INT);',
    );
  });
});
