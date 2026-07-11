import { describe, expect, it } from 'vitest';
import type { ForeignKey, Schema } from '../parser/types';
import type { InferredFK } from '../infer/inferForeignKeys';
import { canonicalFkKey } from '../parser/utils';
import { buildReviewReport } from './toReport';

const schema: Schema = {
  tables: [
    { name: 'orders', columns: [], primaryKey: [], indexes: [] },
    { name: 'payments', columns: [], primaryKey: [], indexes: [] },
    { name: 'users', columns: [], primaryKey: [], indexes: [] },
  ],
  explicitForeignKeys: [
    {
      fromTable: 'orders',
      fromColumns: ['user_id'],
      toTable: 'users',
      toColumns: ['id'],
      source: 'explicit',
      constraintName: 'fk_o_u',
    },
  ],
  warnings: [],
};

const fkCandidate: InferredFK = {
  fromTable: 'payments',
  fromColumns: ['order_id'],
  toTable: 'orders',
  toColumns: ['id'],
  source: 'inferred',
  confidence: 'high',
  reason: 'Exact name match',
};

const logicalCandidate: InferredFK = {
  fromTable: 'orders',
  fromColumns: ['out_trade_no'],
  toTable: 'payments',
  toColumns: ['out_trade_no'],
  source: 'inferred',
  kind: 'logical',
  confidence: 'medium',
  reason: 'Shared business key "out_trade_no" across 2 tables; unique on payments (hub)',
};

const manualLogical: ForeignKey = {
  fromTable: 'orders',
  fromColumns: ['batch_no'],
  toTable: 'payments',
  toColumns: ['batch_no'],
  source: 'manual',
  kind: 'logical',
  reason: '用户手动添加（业务键逻辑关联）',
};

const AT = new Date(2026, 6, 11, 10, 30);

describe('buildReviewReport', () => {
  it('renders every section with decision states and undirected paths', () => {
    const md = buildReviewReport({
      schema,
      inferred: [fkCandidate, logicalCandidate],
      decisions: { [canonicalFkKey(fkCandidate)]: 'accept' },
      manualFks: [manualLogical],
      deletedTableNames: [],
      generatedAt: AT,
    });
    expect(md).toContain('# 数据库关系评审报告');
    expect(md).toContain('2026-07-11 10:30');
    expect(md).toContain('`orders.user_id` → `users.id`（`fk_o_u`）');
    expect(md).toContain('[已接受] `payments.order_id` → `orders.id` · 置信度 high');
    expect(md).toContain('[待定] `orders.out_trade_no` ~ `payments.out_trade_no`');
    expect(md).toContain('[手动添加] `orders.batch_no` ~ `payments.batch_no`');
  });

  it('renders field review notes grouped by table, excluding hidden tables', () => {
    const md = buildReviewReport({
      schema,
      inferred: [],
      decisions: {},
      manualFks: [],
      deletedTableNames: ['users'],
      fieldNotes: {
        'orders::out_trade_no': {
          text: '命名建议改为 external_trade_no\n且应加唯一索引',
          updatedAt: new Date(2026, 6, 11, 9, 5).toISOString(),
        },
        'users::id': { text: '隐藏表上的批注不应出现', updatedAt: '' },
      },
      generatedAt: AT,
    });
    expect(md).toContain('## 字段评审意见');
    expect(md).toContain('### orders');
    expect(md).toContain('- `orders.out_trade_no`（2026-07-11 09:05）');
    expect(md).toContain('  > 命名建议改为 external_trade_no');
    expect(md).toContain('  > 且应加唯一索引');
    expect(md).not.toContain('隐藏表上的批注');
  });

  it('marks rejected candidates and excludes edges touching recycle-binned tables', () => {
    const md = buildReviewReport({
      schema,
      inferred: [fkCandidate, logicalCandidate],
      decisions: { [canonicalFkKey(fkCandidate)]: 'reject' },
      manualFks: [],
      deletedTableNames: ['payments'],
      generatedAt: AT,
    });
    expect(md).toContain('## 已排除（回收站）');
    expect(md).toContain('- `payments`');
    // Both candidates touch payments → dropped from the candidate sections.
    expect(md).not.toContain('payments.order_id');
    expect(md).not.toContain('out_trade_no');
  });
});
