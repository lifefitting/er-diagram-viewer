export const PERF_SCENARIOS = Object.freeze({
  small: Object.freeze({ name: 'small', tables: 14, columns: null, useDefault: true }),
  medium: Object.freeze({ name: 'medium', tables: 80, columns: 10, useDefault: false }),
  large: Object.freeze({ name: 'large', tables: 160, columns: 12, useDefault: false }),
  wide: Object.freeze({
    name: 'wide',
    tables: 80,
    columns: 28,
    topology: 'chain',
    useDefault: false,
  }),
  hub: Object.freeze({
    name: 'hub',
    tables: 100,
    columns: 10,
    topology: 'star',
    useDefault: false,
  }),
  dense: Object.freeze({
    name: 'dense',
    tables: 80,
    columns: 12,
    topology: 'dense',
    useDefault: false,
  }),
  incremental: Object.freeze({
    name: 'incremental',
    tables: 80,
    columns: 10,
    topology: 'chain',
    incremental: true,
    useDefault: false,
  }),
});

/**
 * Generate a deterministic FK chain. Table names deliberately do not end in
 * digits because the application treats numeric suffixes as possible shards.
 */
export function generateSql(tableCount, columnsPerTable, topology = 'chain') {
  const statements = [];

  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const suffix = String(tableIndex).padStart(3, '0');
    const tableName = `perf_entity_${suffix}_record`;
    const lines = ['  id BIGINT NOT NULL'];

    const references =
      tableIndex === 0
        ? []
        : topology === 'star'
          ? [0]
          : topology === 'dense'
            ? Array.from({ length: Math.min(3, tableIndex) }, (_, offset) => tableIndex - offset - 1)
            : [tableIndex - 1];
    references.forEach((_, index) => lines.push(`  parent_key_${index} BIGINT`));
    const structuralColumns = 1 + references.length;
    for (let columnIndex = structuralColumns; columnIndex < columnsPerTable; columnIndex += 1) {
      lines.push(`  field_${String(columnIndex).padStart(2, '0')} VARCHAR(96)`);
    }

    lines.push('  PRIMARY KEY (id)');
    references.forEach((referencedTable, index) => {
      const previous = `perf_entity_${String(referencedTable).padStart(3, '0')}_record`;
      lines.push(
        `  CONSTRAINT fk_${suffix}_parent_${index} FOREIGN KEY (parent_key_${index}) REFERENCES ${previous}(id)`,
      );
    });
    statements.push(`CREATE TABLE ${tableName} (\n${lines.join(',\n')}\n);`);
  }

  return statements.join('\n\n');
}
