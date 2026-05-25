import type { ForeignKey } from '../parser/types';

/** Build `ALTER TABLE ... ADD CONSTRAINT ...` statements for a list of FKs. */
export function toAlterTableDdl(fks: ForeignKey[]): string {
  if (fks.length === 0) return '';
  const lines: string[] = ['-- Inferred / confirmed foreign keys'];
  for (const fk of fks) {
    const name = constraintName(fk);
    lines.push(
      `ALTER TABLE \`${fk.fromTable}\` ADD CONSTRAINT \`${name}\` ` +
        `FOREIGN KEY (${fk.fromColumns.map(quote).join(', ')}) ` +
        `REFERENCES \`${fk.toTable}\` (${fk.toColumns.map(quote).join(', ')});`,
    );
  }
  return lines.join('\n');
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
