import type { ForeignKey, Schema } from '../parser/types';
import type { InferredFK } from '../infer/inferForeignKeys';
import { canonicalFkKey } from '../parser/utils';

/**
 * Markdown review report — the DB-refactor deliverable: every relation the
 * diagram knows about (physical FKs, inference candidates with their decision
 * state, logical business-key links, manual additions), plus what the recycle
 * bin excluded. Pure function, DOM-free, deterministic given `generatedAt`.
 */
export interface ReportInput {
  /** The visible schema (recycle-bin'd tables already filtered out). */
  schema: Schema;
  /** ALL inference candidates — including rejected and low-confidence ones;
   *  the report's value is showing what was reviewed, not just what's drawn. */
  inferred: InferredFK[];
  decisions: Record<string, 'accept' | 'reject'>;
  manualFks: ForeignKey[];
  /** Original names of recycle-bin'd tables (edges touching them are excluded
   *  from the sections above and called out at the end). */
  deletedTableNames: string[];
  /** Field-level review annotations, keyed `table::column` (fieldNoteKey);
   *  each carries the text and WHEN it was written. */
  fieldNotes?: Record<string, { text: string; updatedAt: string }>;
  /** Section toggles (export dialog): a reviewer may want a "facts + opinions
   *  only" report without the engine's candidate lists. Both default true. */
  include?: {
    /** 推断外键候选 section (accepted/pending/rejected engine candidates). */
    inferredFkCandidates?: boolean;
    /** Engine-scanned logical-link candidates (manual logical links are the
     *  user's own assertions and are always listed). */
    logicalCandidates?: boolean;
  };
  /** Injectable for deterministic tests. */
  generatedAt?: Date;
}

export function buildReviewReport(input: ReportInput): string {
  const { schema, inferred, decisions, manualFks, deletedTableNames } = input;
  const fieldNotes = input.fieldNotes ?? {};
  const includeFkCandidates = input.include?.inferredFkCandidates ?? true;
  const includeLogicalCandidates = input.include?.logicalCandidates ?? true;
  const when = input.generatedAt ?? new Date();

  const hiddenLower = new Set(deletedTableNames.map((n) => n.toLowerCase()));
  const touchesHidden = (fk: ForeignKey) =>
    hiddenLower.has(fk.fromTable.toLowerCase()) || hiddenLower.has(fk.toTable.toLowerCase());

  const inferredVisible = inferred.filter((fk) => !touchesHidden(fk));
  const fkCandidates = inferredVisible.filter((fk) => fk.kind !== 'logical');
  const logicalCandidates = inferredVisible.filter((fk) => fk.kind === 'logical');
  const manualVisible = manualFks.filter((fk) => !touchesHidden(fk));
  const manualPhysical = manualVisible.filter((fk) => fk.kind !== 'logical');
  const manualLogical = manualVisible.filter((fk) => fk.kind === 'logical');
  const explicit = schema.explicitForeignKeys;

  const decisionOf = (fk: ForeignKey) => decisions[canonicalFkKey(fk)];
  const stateLabel = (fk: ForeignKey) => {
    const d = decisionOf(fk);
    return d === 'accept' ? '已接受' : d === 'reject' ? '已拒绝' : '待定';
  };
  const path = (fk: ForeignKey, sep: string) =>
    `\`${fk.fromTable}.${fk.fromColumns.join(',')}\` ${sep} \`${fk.toTable}.${fk.toColumns.join(',')}\``;

  const lines: string[] = [];
  lines.push('# 数据库关系评审报告');
  lines.push('');
  lines.push(`- 生成时间：${formatDate(when)}`);
  lines.push(`- 表：${schema.tables.length} 张`);
  const summaryParts = [`显式外键 ${explicit.length}`];
  if (includeFkCandidates) summaryParts.push(`推断外键候选 ${fkCandidates.length}`);
  if (includeLogicalCandidates) summaryParts.push(`逻辑关联候选 ${logicalCandidates.length}`);
  summaryParts.push(`手动添加 ${manualVisible.length}`);
  lines.push(`- 关系：${summaryParts.join(' · ')}`);
  const omitted = [
    !includeFkCandidates ? '推断外键候选' : '',
    !includeLogicalCandidates ? '逻辑关联候选' : '',
  ].filter(Boolean);
  if (omitted.length) lines.push(`- 本报告按导出选项省略：${omitted.join('、')}`);
  lines.push('');

  lines.push('## 物理外键（DDL 显式声明）');
  lines.push('');
  if (explicit.length === 0) lines.push('（无）');
  for (const fk of explicit) {
    lines.push(`- ${path(fk, '→')}${fk.constraintName ? `（\`${fk.constraintName}\`）` : ''}`);
  }
  lines.push('');

  if (includeFkCandidates) {
    lines.push('## 推断外键候选');
    lines.push('');
    if (fkCandidates.length === 0) lines.push('（无）');
    for (const fk of fkCandidates) {
      lines.push(
        `- [${stateLabel(fk)}] ${path(fk, '→')} · 置信度 ${fk.confidence}` +
          (fk.reason ? ` · ${fk.reason}` : ''),
      );
    }
    lines.push('');
  }

  lines.push('## 逻辑关联（业务键，无物理约束）');
  lines.push('');
  const logicalShown = includeLogicalCandidates ? logicalCandidates : [];
  if (logicalShown.length === 0 && manualLogical.length === 0) lines.push('（无）');
  for (const fk of logicalShown) {
    lines.push(
      `- [${stateLabel(fk)}] ${path(fk, '~')} · 置信度 ${fk.confidence}` +
        (fk.reason ? ` · ${fk.reason}` : ''),
    );
  }
  for (const fk of manualLogical) {
    lines.push(`- [手动添加] ${path(fk, '~')}${fk.reason ? ` · ${fk.reason}` : ''}`);
  }
  lines.push('');

  lines.push('## 手动添加的物理外键');
  lines.push('');
  if (manualPhysical.length === 0) lines.push('（无）');
  for (const fk of manualPhysical) {
    lines.push(`- ${path(fk, '→')}${fk.reason ? ` · ${fk.reason}` : ''}`);
  }
  lines.push('');

  // Field-level review annotations, grouped by table in schema order — each
  // with the timestamp it was written (the review is a PROCESS record). Notes
  // on recycle-bin'd tables are held back with the other excluded material.
  const noteEntries = Object.entries(fieldNotes)
    .map(([key, note]) => {
      const i = key.indexOf('::');
      return i < 0
        ? null
        : {
            table: key.slice(0, i),
            column: key.slice(i + 2),
            text: note.text,
            updatedAt: note.updatedAt,
          };
    })
    .filter((n): n is NonNullable<typeof n> => !!n);
  const visibleNotes = noteEntries.filter((n) => !hiddenLower.has(n.table.toLowerCase()));
  lines.push('## 字段评审意见');
  lines.push('');
  if (visibleNotes.length === 0) lines.push('（无）');
  for (const table of schema.tables) {
    const notes = visibleNotes.filter((n) => n.table === table.name);
    if (notes.length === 0) continue;
    lines.push(`### ${table.name}`);
    lines.push('');
    for (const n of notes) {
      const at = n.updatedAt ? formatIso(n.updatedAt) : '';
      lines.push(`- \`${n.table}.${n.column}\`${at ? `（${at}）` : ''}`);
      for (const l of n.text.split('\n')) lines.push(`  > ${l}`);
    }
    lines.push('');
  }
  if (visibleNotes.length === 0) lines.push('');

  if (deletedTableNames.length > 0) {
    lines.push('## 已排除（回收站）');
    lines.push('');
    lines.push(
      `以下 ${deletedTableNames.length} 张表已从视图中隐藏，其关联边未纳入上述统计：`,
    );
    for (const name of deletedTableNames) lines.push(`- \`${name}\``);
    lines.push('');
  }

  return lines.join('\n');
}

function formatDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO timestamp → local `YYYY-MM-DD HH:mm`; '' for invalid input. */
function formatIso(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDate(d);
}
