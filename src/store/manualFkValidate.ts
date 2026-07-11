import type { ForeignKey, Schema } from '../parser/types';
import { canonicalFkKey } from '../parser/utils';

/** A manual relation as the user is composing it (panel form or
 *  drag-to-connect). `kind` absent = physical FK. */
export interface ManualFkDraft {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  kind?: 'fk' | 'logical';
  /** Which connect dot the drag started from (persisted — drives which side a
   *  same-table loop bulges out of). */
  side?: 'left' | 'right';
}

export function manualFkFromDraft(d: ManualFkDraft): ForeignKey {
  // The drawn direction is preserved verbatim — drag start stays `from`, so a
  // later 逻辑→物理 kind flip means "start references end" as the user drew
  // it. Logical keys are order-normalized inside `canonicalFkKey` instead.
  return {
    fromTable: d.fromTable,
    fromColumns: [d.fromColumn],
    toTable: d.toTable,
    toColumns: [d.toColumn],
    source: 'manual',
    kind: d.kind ?? 'fk',
    drawSide: d.side,
    reason: d.kind === 'logical' ? '用户手动添加（业务键逻辑关联）' : '用户手动添加',
  };
}

/**
 * Shared validation for adding a manual relation. Returns a user-facing error
 * message, or null when the draft is addable. Collision checks run against ALL
 * explicit/inferred FKs (even rejected/hidden ones) — visibility must never
 * change whether a key is takeable, or buildGraph's route-key invariant breaks.
 * The message names the KIND of the existing edge that owns the key, so the
 * user knows what to do (accept the candidate / remove the other edge).
 */
export function validateManualFk(
  d: ManualFkDraft,
  schema: Schema | null,
  inferred: ForeignKey[],
  manualFks: ForeignKey[],
): string | null {
  if (d.fromTable === d.toTable && d.fromColumn === d.toColumn) return '不能指向自身同一列';
  const key = canonicalFkKey(manualFkFromDraft(d));
  const hit = (f: ForeignKey) => canonicalFkKey(f) === key;

  const explicit = (schema?.explicitForeignKeys ?? []).find(hit);
  if (explicit) return '该外键已在 DDL 中显式声明';
  const candidate = inferred.find(hit);
  if (candidate)
    return candidate.kind === 'logical'
      ? '已有同路径的逻辑关联候选，请直接接受它'
      : '已有同路径的推断候选，请直接接受它';
  const manual = manualFks.find(hit);
  if (manual)
    return manual.kind === 'logical'
      ? d.kind === 'logical'
        ? '已添加过该逻辑关联'
        : '该路径已存在手动逻辑关联，请先移除它'
      : '已添加过该外键';
  return null;
}
