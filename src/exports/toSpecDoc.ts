import type { ForeignKey, Schema, Table } from '../parser/types';

/**
 * Formal database design specification. The document follows the conventional
 * database-design handoff structure: document control → purpose/scope → design
 * conventions → inventory → per-table data dictionary → relationship summary
 * → terminology. It only states confirmed facts from DDL and review decisions.
 */
export interface SpecDocInput {
  /** Visible schema: tables currently marked 建议删除 are excluded. */
  schema: Schema;
  /** Confirmed relations only (explicit + accepted inferred + manual). */
  relations: ForeignKey[];
  generatedAt?: Date;
}

export function buildSpecDoc(input: SpecDocInput): string {
  const { schema, relations } = input;
  const when = input.generatedAt ?? new Date();
  const physical = relations.filter((relation) => relation.kind !== 'logical');
  const logical = relations.filter((relation) => relation.kind === 'logical');
  const fieldCount = schema.tables.reduce((sum, table) => sum + table.columns.length, 0);
  const indexCount = schema.tables.reduce(
    (sum, table) => sum + table.indexes.length + (table.primaryKey.length > 0 ? 1 : 0),
    0,
  );
  const pkTableCount = schema.tables.filter((table) => table.primaryKey.length > 0).length;

  const lines: string[] = [];
  lines.push('# 数据库设计说明书');
  lines.push('');

  lines.push('## 文档控制');
  lines.push('');
  lines.push('| 项目 | 内容 |');
  lines.push('| --- | --- |');
  lines.push('| 文档名称 | 数据库设计说明书 |');
  lines.push('| 文档版本 | V1.0 |');
  lines.push('| 文档状态 | 草稿（自动生成） |');
  lines.push(`| 生成时间 | ${formatDate(when)} |`);
  lines.push('| 数据来源 | 导入 DDL + 已确认评审关系 |');
  lines.push('');

  lines.push('## 1. 文档目的与范围');
  lines.push('');
  lines.push(
    '本文档用于描述当前数据库基线中的表、字段、约束、索引及已确认关系，作为设计评审、开发实现、测试验证和后续维护的共同依据。',
  );
  lines.push('');
  lines.push(
    '> 范围说明：仅纳入当前可见数据表，以及 DDL 显式关系、已采纳的推断关系和人工确认关系；待定候选与已标记删除的表不作为设计基线。',
  );
  lines.push('');

  lines.push('## 2. 设计约定');
  lines.push('');
  lines.push('| 类别 | 文档约定 |');
  lines.push('| --- | --- |');
  lines.push('| 对象命名 | 表名、字段名和约束名按 DDL 原文记录，不在导出时改写 |');
  lines.push('| 主键 | PK；主键字段按非空处理 |');
  lines.push('| 唯一约束 | UK / UNIQUE |');
  lines.push('| 普通索引 | IDX / INDEX |');
  lines.push('| 外键 | FK；包括 DDL 声明及评审确认的物理关系 |');
  lines.push('| 逻辑关联 | 业务键关联，不生成数据库物理约束 |');
  lines.push('| 缺失信息 | 使用“—”表示 DDL 未提供或不适用 |');
  lines.push('');

  lines.push('## 3. 数据库概览');
  lines.push('');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 数据表 | ${schema.tables.length} |`);
  lines.push(`| 字段 | ${fieldCount} |`);
  lines.push(`| 含主键的数据表 | ${pkTableCount} |`);
  lines.push(`| 主键及索引 | ${indexCount} |`);
  lines.push(`| 物理外键关系 | ${physical.length} |`);
  lines.push(`| 业务键逻辑关联 | ${logical.length} |`);
  lines.push('');

  lines.push('### 3.1 数据表清单');
  lines.push('');
  lines.push('| 序号 | Schema | 表名 | 表说明 | 字段数 | 主键 | 索引数 |');
  lines.push('| ---: | --- | --- | --- | ---: | --- | ---: |');
  schema.tables.forEach((table, index) => {
    lines.push(
      `| ${index + 1} | ${display(table.schema)} | \`${table.name}\` | ${display(table.comment)} | ${table.columns.length} | ${display(table.primaryKey.join(', '))} | ${table.indexes.length} |`,
    );
  });
  lines.push('');

  lines.push('## 4. 数据字典');
  lines.push('');
  schema.tables.forEach((table, index) => {
    lines.push(...tableSection(table, index + 1, physical, logical));
  });

  lines.push('## 5. 关系汇总');
  lines.push('');
  if (physical.length === 0 && logical.length === 0) {
    lines.push('（无已确认的表间关系）');
    lines.push('');
  }
  if (physical.length > 0) {
    lines.push('### 5.1 物理外键');
    lines.push('');
    lines.push('| 序号 | 从表 | 从字段 | 到表 | 到字段 | 约束名 | 来源 |');
    lines.push('| ---: | --- | --- | --- | --- | --- | --- |');
    physical.forEach((relation, index) => {
      lines.push(
        `| ${index + 1} | \`${relation.fromTable}\` | \`${relation.fromColumns.join(',')}\` | \`${relation.toTable}\` | \`${relation.toColumns.join(',')}\` | ${display(relation.constraintName)} | ${sourceLabel(relation)} |`,
      );
    });
    lines.push('');
  }
  if (logical.length > 0) {
    lines.push('### 5.2 业务键逻辑关联（无物理约束）');
    lines.push('');
    lines.push('| 序号 | 端点 A | 字段 | 端点 B | 字段 | 来源 |');
    lines.push('| ---: | --- | --- | --- | --- | --- |');
    logical.forEach((relation, index) => {
      lines.push(
        `| ${index + 1} | \`${relation.fromTable}\` | \`${relation.fromColumns.join(',')}\` | \`${relation.toTable}\` | \`${relation.toColumns.join(',')}\` | ${sourceLabel(relation)} |`,
      );
    });
    lines.push('');
  }

  lines.push('## 6. 附录：术语与符号');
  lines.push('');
  lines.push('| 符号 | 含义 |');
  lines.push('| --- | --- |');
  lines.push('| PK | 主键（Primary Key） |');
  lines.push('| FK | 外键（Foreign Key） |');
  lines.push('| UK | 唯一键（Unique Key） |');
  lines.push('| IDX | 普通索引（Index） |');
  lines.push('| NOT NULL | 字段不允许为空 |');
  lines.push('| 逻辑关联 | 应用层维护的业务关联，不对应物理外键约束 |');
  lines.push('');

  return lines.join('\n');
}

function tableSection(
  table: Table,
  index: number,
  physical: ForeignKey[],
  logical: ForeignKey[],
): string[] {
  const lines: string[] = [];
  lines.push(`### 4.${index} ${table.name}`);
  lines.push('');

  lines.push(`#### 4.${index}.1 基本信息`);
  lines.push('');
  lines.push('| 属性 | 内容 |');
  lines.push('| --- | --- |');
  lines.push(`| Schema | ${display(table.schema)} |`);
  lines.push(`| 表名 | \`${table.name}\` |`);
  lines.push(`| 表说明 | ${display(table.comment)} |`);
  lines.push(`| 主键 | ${display(table.primaryKey.join(', '))} |`);
  lines.push(
    `| 分表信息 | ${table.shardInfo ? `${table.shardInfo.shards.length} 张物理分表：${cell(table.shardInfo.shards.join(', '))}` : '—'} |`,
  );
  lines.push('');

  lines.push(`#### 4.${index}.2 字段定义`);
  lines.push('');
  lines.push('| 序号 | 字段名 | 数据类型 | 主键 | 允许空 | 默认值 | 自增 | 索引 | 字段说明 |');
  lines.push('| ---: | --- | --- | :---: | :---: | --- | :---: | --- | --- |');
  table.columns.forEach((column, columnIndex) => {
    const isPk = column.isPrimaryKey || table.primaryKey.includes(column.name);
    const indexes = [
      column.isUnique && !isPk ? 'UK' : '',
      !column.isUnique && !isPk && column.hasIndex ? 'IDX' : '',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(
      `| ${columnIndex + 1} | \`${column.name}\` | ${cell(column.rawType)} | ${isPk ? '是' : '否'} | ${column.nullable && !isPk ? '是' : '否'} | ${display(column.defaultValue)} | ${column.isAutoIncrement ? '是' : '否'} | ${indexes || '—'} | ${display(column.comment)} |`,
    );
  });
  lines.push('');

  lines.push(`#### 4.${index}.3 约束与索引`);
  lines.push('');
  if (table.primaryKey.length === 0 && table.indexes.length === 0) {
    lines.push('（无 DDL 声明的主键或索引）');
  } else {
    lines.push('| 名称 | 类型 | 字段 |');
    lines.push('| --- | --- | --- |');
    if (table.primaryKey.length > 0) {
      lines.push(`| PRIMARY | 主键 | \`${table.primaryKey.join(', ')}\` |`);
    }
    for (const item of table.indexes) {
      lines.push(
        `| ${display(item.name)} | ${item.unique ? '唯一索引' : '普通索引'} | \`${item.columns.join(', ')}\` |`,
      );
    }
  }
  lines.push('');

  lines.push(`#### 4.${index}.4 关系定义`);
  lines.push('');
  const relatedPhysical = physical.filter(
    (relation) => relation.fromTable === table.name || relation.toTable === table.name,
  );
  const relatedLogical = logical.filter(
    (relation) => relation.fromTable === table.name || relation.toTable === table.name,
  );
  if (relatedPhysical.length === 0 && relatedLogical.length === 0) {
    lines.push('（无已确认关系）');
  } else {
    lines.push('| 类型 | 本表字段 | 关联表 | 关联字段 | 方向 | 来源 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const relation of relatedPhysical) {
      const outgoing = relation.fromTable === table.name;
      lines.push(
        `| 物理外键 | \`${(outgoing ? relation.fromColumns : relation.toColumns).join(', ')}\` | \`${outgoing ? relation.toTable : relation.fromTable}\` | \`${(outgoing ? relation.toColumns : relation.fromColumns).join(', ')}\` | ${outgoing ? '引用' : '被引用'} | ${sourceLabel(relation)} |`,
      );
    }
    for (const relation of relatedLogical) {
      const fromSide = relation.fromTable === table.name;
      lines.push(
        `| 逻辑关联 | \`${(fromSide ? relation.fromColumns : relation.toColumns).join(', ')}\` | \`${fromSide ? relation.toTable : relation.fromTable}\` | \`${(fromSide ? relation.toColumns : relation.fromColumns).join(', ')}\` | 双向 | ${sourceLabel(relation)} |`,
      );
    }
  }
  lines.push('');
  return lines;
}

function sourceLabel(relation: ForeignKey): string {
  if (relation.source === 'explicit') return 'DDL 声明';
  if (relation.source === 'manual') return '人工确认';
  return '推断（已确认）';
}

/** Escape a value into one Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function display(value: string | undefined): string {
  return value ? cell(value) : '—';
}

function formatDate(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
