import { describe, expect, it } from 'vitest';
import { parseSql } from '../parser';
import type { ForeignKey } from '../parser/types';
import { buildSpecDoc } from './toSpecDoc';

const SQL = [
  "CREATE TABLE users (id BIGINT PRIMARY KEY, email VARCHAR(255) NOT NULL COMMENT '登录邮箱', UNIQUE KEY uk_email (email)) COMMENT='用户表';",
  "CREATE TABLE orders (id BIGINT PRIMARY KEY, user_id BIGINT NOT NULL, status VARCHAR(32) DEFAULT 'pending', out_trade_no VARCHAR(64), KEY idx_user (user_id));",
].join('\n');

const schema = parseSql(SQL);

const fkRel: ForeignKey = {
  fromTable: 'orders',
  fromColumns: ['user_id'],
  toTable: 'users',
  toColumns: ['id'],
  source: 'inferred',
  confidence: 'high',
};

const logicalRel: ForeignKey = {
  fromTable: 'orders',
  fromColumns: ['out_trade_no'],
  toTable: 'users',
  toColumns: ['email'],
  source: 'manual',
  kind: 'logical',
};

const AT = new Date(2026, 6, 11, 18, 0);

describe('buildSpecDoc', () => {
  const md = buildSpecDoc({ schema, relations: [fkRel, logicalRel], generatedAt: AT });

  it('renders the standard sections and overview', () => {
    expect(md).toContain('# 数据库设计说明书');
    expect(md).toContain('2026-07-11 18:00');
    expect(md).toContain('## 文档控制');
    expect(md).toContain('| 文档版本 | V1.0 |');
    expect(md).toContain('## 1. 文档目的与范围');
    expect(md).toContain('## 2. 设计约定');
    expect(md).toContain('## 3. 数据库概览');
    expect(md).toContain('| 1 | — | `users` | 用户表 | 2 | id | 1 |');
    expect(md).toContain('## 4. 数据字典');
    expect(md).toContain('### 4.1 users');
    expect(md).toContain('## 5. 关系汇总');
    expect(md).toContain('## 6. 附录：术语与符号');
  });

  it('renders a complete field dictionary with constraints and descriptions', () => {
    expect(md).toContain(
      '| 序号 | 字段名 | 数据类型 | 主键 | 允许空 | 默认值 | 自增 | 索引 | 字段说明 |',
    );
    expect(md).toContain('| 1 | `id` | BIGINT | 是 | 否 | — | 否 | — | — |');
    expect(md).toContain('| 2 | `email` | VARCHAR(255) | 否 | 否 | — | 否 | UK | 登录邮箱 |');
    expect(md).toContain("| 3 | `status` | VARCHAR(32) | 否 | 是 | 'pending' | 否 | — | — |");
    expect(md).toContain('| 2 | `user_id` | BIGINT | 否 | 否 | — | 否 | IDX | — |');
  });

  it('lists PK/index definitions and incoming/outgoing per-table relations', () => {
    expect(md).toContain('| PRIMARY | 主键 | `id` |');
    expect(md).toContain('| uk_email | 唯一索引 | `email` |');
    expect(md).toContain('| 物理外键 | `user_id` | `users` | `id` | 引用 | 推断（已确认） |');
    expect(md).toContain('| 逻辑关联 | `out_trade_no` | `users` | `email` | 双向 | 人工确认 |');
  });

  it('summarizes relations with source labels and splits logical from FK', () => {
    expect(md).toContain('### 5.1 物理外键');
    expect(md).toContain('| 1 | `orders` | `user_id` | `users` | `id` | — | 推断（已确认） |');
    expect(md).toContain('### 5.2 业务键逻辑关联（无物理约束）');
    expect(md).toContain('| 1 | `orders` | `out_trade_no` | `users` | `email` | 人工确认 |');
  });
});
