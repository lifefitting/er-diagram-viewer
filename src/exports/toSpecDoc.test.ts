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
    expect(md).toContain('# 数据库设计说明文档');
    expect(md).toContain('2026-07-11 18:00');
    expect(md).toContain('## 1. 数据表概览');
    expect(md).toContain('| 1 | `users` | 用户表 | 2 |');
    expect(md).toContain('## 2. 表结构定义');
    expect(md).toContain('### 2.1 users（用户表）');
    expect(md).toContain('## 3. 关系汇总');
  });

  it('renders column rows with type / nullability / default / keys / comment', () => {
    expect(md).toContain('| 1 | `id` | BIGINT | 否 |  | PK |  |');
    expect(md).toContain('| 2 | `email` | VARCHAR(255) | 否 |  | UK | 登录邮箱 |');
    expect(md).toContain("| 3 | `status` | VARCHAR(32) | 是 | 'pending' | — |");
    expect(md).toContain('| 2 | `user_id` | BIGINT | 否 |  | IDX |');
  });

  it('lists PK, indexes and per-table relations', () => {
    expect(md).toContain('- 主键：`id`');
    expect(md).toContain('- 索引：UNIQUE (email) `uk_email`');
    expect(md).toContain('- 外键：`user_id` → `users.id`（推断（已确认））');
    expect(md).toContain('- 逻辑关联：`out_trade_no` ~ `users.email`（业务键，无物理约束）');
  });

  it('summarizes relations with source labels and splits logical from FK', () => {
    expect(md).toContain('### 3.1 外键');
    expect(md).toContain('| `orders.user_id` | `users.id` |  | 推断（已确认） |');
    expect(md).toContain('### 3.2 业务键逻辑关联（无物理约束）');
    expect(md).toContain('| `orders.out_trade_no` | `users.email` | 人工确认 |');
  });
});
