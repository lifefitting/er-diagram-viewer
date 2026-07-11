import type { ForeignKey } from '../parser/types';

/**
 * Build the "added relations" block appended to the exported script:
 * physical FKs (inferred-accepted / manual) become real `ALTER TABLE ... ADD
 * CONSTRAINT` statements; logical (business-key) links have NO physical
 * constraint by design — sharded databases can't reference each other — so
 * they are emitted as comment lines a reviewer (or a later tool) can read.
 */
export function toAlterTableDdl(fks: ForeignKey[]): string {
  const physical = fks.filter((fk) => fk.kind !== 'logical');
  const logical = fks.filter((fk) => fk.kind === 'logical');
  const sections: string[] = [];

  if (physical.length > 0) {
    const lines = ['-- Inferred / confirmed foreign keys'];
    for (const fk of physical) {
      const name = constraintName(fk);
      lines.push(
        `ALTER TABLE \`${fk.fromTable}\` ADD CONSTRAINT \`${name}\` ` +
          `FOREIGN KEY (${fk.fromColumns.map(quote).join(', ')}) ` +
          `REFERENCES \`${fk.toTable}\` (${fk.toColumns.map(quote).join(', ')});`,
      );
    }
    sections.push(lines.join('\n'));
  }

  if (logical.length > 0) {
    const lines = ['-- Logical links (business keys, no physical constraint)'];
    for (const fk of logical) {
      const path =
        `${fk.fromTable}.${fk.fromColumns.join(',')} ~ ` +
        `${fk.toTable}.${fk.toColumns.join(',')}`;
      lines.push(`-- LOGICAL: ${path}${fk.reason ? `  (${fk.reason})` : ''}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

function constraintName(fk: ForeignKey): string {
  if (fk.constraintName) return fk.constraintName;
  return `fk_${fk.fromTable}_${fk.fromColumns.join('_')}`;
}

function quote(name: string): string {
  return '`' + name + '`';
}

export function appendInferredToScript(originalSql: string, inferredFks: ForeignKey[]): string {
  const ddl = toAlterTableDdl(inferredFks);
  if (!ddl) return originalSql;
  return originalSql.replace(/\s*$/, '') + '\n\n' + ddl + '\n';
}
