import type { ForeignKey, Schema } from '../parser/types';
import type { InferredFK } from '../infer/inferForeignKeys';
import type { NoteSeverity, NoteStatus } from '../store/types';
import { severityLabel, statusLabel } from '../store/notesSlice';
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
  /** Auditable table-level decisions. Tables marked delete are already absent
   *  from `schema`; their names and operation times remain in this report. */
  tableDecisions?: Array<{ table: string; action: 'delete'; updatedAt: string }>;
  /** Field-level review annotations, keyed `table::column` (fieldNoteKey);
   *  each carries the text, WHEN it was written, plus 级别/状态 (absent on
   *  legacy notes → 建议/待处理). */
  fieldNotes?: Record<
    string,
    { text: string; updatedAt: string; severity?: NoteSeverity; status?: NoteStatus }
  >;
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
  const { schema, inferred, decisions, manualFks } = input;
  const tableDecisions = input.tableDecisions ?? [];
  const fieldNotes = input.fieldNotes ?? {};
  const includeFkCandidates = input.include?.inferredFkCandidates ?? true;
  const includeLogicalCandidates = input.include?.logicalCandidates ?? true;
  const when = input.generatedAt ?? new Date();

  const hiddenLower = new Set(tableDecisions.map((decision) => decision.table.toLowerCase()));
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
  lines.push('# 数据库评审记录');
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

  lines.push('## 表级评审决策');
  lines.push('');
  if (tableDecisions.length === 0) {
    lines.push('（无）');
  } else {
    lines.push('| 表名 | 操作时间 | 决策 |');
    lines.push('| --- | --- | --- |');
    for (const decision of [...tableDecisions].sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    )) {
      lines.push(
        `| \`${decision.table}\` | ${decision.updatedAt ? formatIso(decision.updatedAt) : '—'} | 标记删除 |`,
      );
    }
  }
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

  // Field-level review annotations use one audit-friendly table. Keep 级别 and
  // 状态 inside the suggestion cell so the four requested record columns stay
  // stable: 时间、表、字段、评审建议.
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
            severity: note.severity ?? ('suggest' as NoteSeverity),
            status: note.status ?? ('open' as NoteStatus),
          };
    })
    .filter((n): n is NonNullable<typeof n> => !!n);
  const visibleNotes = noteEntries.filter((n) => !hiddenLower.has(n.table.toLowerCase()));
  lines.push('## 字段评审意见');
  lines.push('');
  if (visibleNotes.length === 0) {
    lines.push('（无）');
    lines.push('');
  } else {
    const countBy = (pred: (n: (typeof visibleNotes)[number]) => boolean) =>
      visibleNotes.filter(pred).length;
    lines.push(
      `共 ${visibleNotes.length} 条：` +
        (['block', 'warn', 'suggest'] as const)
          .map((s) => `${severityLabel(s)} ${countBy((n) => n.severity === s)}`)
          .join(' · ') +
        '；' +
        (['open', 'accepted', 'rejected'] as const)
          .map((s) => `${statusLabel(s)} ${countBy((n) => n.status === s)}`)
          .join(' · '),
    );
    lines.push('');
    lines.push('| 时间 | 表 | 字段 | 评审建议 |');
    lines.push('| --- | --- | --- | --- |');
    const sorted = [...visibleNotes].sort(
      (a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '') ||
        a.table.localeCompare(b.table) ||
        a.column.localeCompare(b.column),
    );
    for (const note of sorted) {
      const at = note.updatedAt ? formatIso(note.updatedAt) : '—';
      const meta = `${severityLabel(note.severity)} · ${statusLabel(note.status)}`;
      lines.push(
        `| ${at} | \`${note.table}\` | \`${note.column}\` | **${meta}** — ${cell(note.text)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Escape text into one Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
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
