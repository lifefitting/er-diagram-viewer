import type { ForeignKey, Schema, Table } from '../parser/types';

/**
 * 数据库设计说明文档 (database specification document) — the standard-format
 * deliverable: an overview table plus one section per table with the full
 * column definition table (类型/允许空/默认值/键/说明), primary key, indexes,
 * and the table's confirmed relations. Pure function, deterministic given
 * `generatedAt`.
 *
 * `relations` must be the CONFIRMED set only (explicit + user-accepted
 * inferred + manual): a spec document states facts, not pending candidates.
 */
export interface SpecDocInput {
  /** The visible schema (recycle-bin'd tables already filtered out). */
  schema: Schema;
  relations: ForeignKey[];
  generatedAt?: Date;
}

export function buildSpecDoc(input: SpecDocInput): string {
  const { schema, relations } = input;
  const when = input.generatedAt ?? new Date();
  const physical = relations.filter((r) => r.kind !== 'logical');
  const logical = relations.filter((r) => r.kind === 'logical');

  const lines: string[] = [];
  lines.push('# 数据库设计说明文档');
  lines.push('');
  lines.push(`- 生成时间：${formatDate(when)}`);
  lines.push(`- 数据表：${schema.tables.length} 张`);
  lines.push(`- 关系：外键 ${physical.length} 条 · 业务键逻辑关联 ${logical.length} 条`);
  lines.push('');

  lines.push('## 1. 数据表概览');
  lines.push('');
  lines.push('| 序号 | 表名 | 说明 | 字段数 |');
  lines.push('| ---: | --- | --- | ---: |');
  schema.tables.forEach((t, i) => {
    lines.push(`| ${i + 1} | \`${t.name}\` | ${cell(t.comment)} | ${t.columns.length} |`);
  });
  lines.push('');

  lines.push('## 2. 表结构定义');
  lines.push('');
  schema.tables.forEach((t, i) => {
    lines.push(...tableSection(t, i + 1, physical, logical));
  });

  lines.push('## 3. 关系汇总');
  lines.push('');
  if (physical.length === 0 && logical.length === 0) {
    lines.push('（无已确认的表间关系）');
    lines.push('');
  }
  if (physical.length > 0) {
    lines.push('### 3.1 外键');
    lines.push('');
    lines.push('| 从表.字段 | 到表.字段 | 约束名 | 来源 |');
    lines.push('| --- | --- | --- | --- |');
    for (const r of physical) {
      lines.push(
        `| \`${r.fromTable}.${r.fromColumns.join(',')}\` | \`${r.toTable}.${r.toColumns.join(',')}\` | ${cell(r.constraintName)} | ${sourceLabel(r)} |`,
      );
    }
    lines.push('');
  }
  if (logical.length > 0) {
    lines.push('### 3.2 业务键逻辑关联（无物理约束）');
    lines.push('');
    lines.push('| 端点 A | 端点 B | 来源 |');
    lines.push('| --- | --- | --- |');
    for (const r of logical) {
      lines.push(
        `| \`${r.fromTable}.${r.fromColumns.join(',')}\` | \`${r.toTable}.${r.toColumns.join(',')}\` | ${sourceLabel(r)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function tableSection(
  t: Table,
  index: number,
  physical: ForeignKey[],
  logical: ForeignKey[],
): string[] {
  const lines: string[] = [];
  lines.push(`### 2.${index} ${t.name}${t.comment ? `（${t.comment}）` : ''}`);
  lines.push('');
  lines.push('| 序号 | 字段名 | 数据类型 | 允许空 | 默认值 | 键 | 说明 |');
  lines.push('| ---: | --- | --- | :---: | --- | :---: | --- |');
  t.columns.forEach((c, i) => {
    const isPk = c.isPrimaryKey || t.primaryKey.includes(c.name);
    const keys = [isPk ? 'PK' : '', c.isUnique && !isPk ? 'UK' : '', !c.isUnique && !isPk && c.hasIndex ? 'IDX' : '']
      .filter(Boolean)
      .join(' ');
    // A PK is implicitly NOT NULL even when the DDL omits it (the parser only
    // flags an explicit NOT NULL).
    const nullable = c.nullable && !isPk;
    lines.push(
      `| ${i + 1} | \`${c.name}\` | ${c.rawType} | ${nullable ? '是' : '否'} | ${cell(c.defaultValue)} | ${keys || '—'} | ${cell(c.comment)} |`,
    );
  });
  lines.push('');
  if (t.primaryKey.length > 0) lines.push(`- 主键：\`${t.primaryKey.join('`, `')}\``);
  if (t.indexes.length > 0) {
    const idx = t.indexes
      .map((x) => `${x.unique ? 'UNIQUE ' : ''}(${x.columns.join(', ')})${x.name ? ` \`${x.name}\`` : ''}`)
      .join('；');
    lines.push(`- 索引：${idx}`);
  }
  const outgoing = physical.filter((r) => r.fromTable === t.name);
  const touchesLogical = logical.filter((r) => r.fromTable === t.name || r.toTable === t.name);
  for (const r of outgoing) {
    lines.push(
      `- 外键：\`${r.fromColumns.join(',')}\` → \`${r.toTable}.${r.toColumns.join(',')}\`（${sourceLabel(r)}）`,
    );
  }
  for (const r of touchesLogical) {
    const other =
      r.fromTable === t.name
        ? `${r.toTable}.${r.toColumns.join(',')}`
        : `${r.fromTable}.${r.fromColumns.join(',')}`;
    const own = r.fromTable === t.name ? r.fromColumns.join(',') : r.toColumns.join(',');
    lines.push(`- 逻辑关联：\`${own}\` ~ \`${other}\`（业务键，无物理约束）`);
  }
  lines.push('');
  return lines;
}

function sourceLabel(r: ForeignKey): string {
  if (r.source === 'explicit') return 'DDL 声明';
  if (r.source === 'manual') return '人工确认';
  return '推断（已确认）';
}

/** Escape a value into a single Markdown table cell. */
function cell(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
