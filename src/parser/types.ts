export type NormalizedType =
  | 'int'
  | 'float'
  | 'string'
  | 'date'
  | 'bool'
  | 'blob'
  | 'json'
  | 'uuid'
  | 'unknown';

export interface Column {
  name: string;
  rawType: string;
  normalizedType: NormalizedType;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  hasIndex: boolean;
  isAutoIncrement: boolean;
  defaultValue?: string;
  comment?: string;
}

export interface IndexDef {
  name?: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKey {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  constraintName?: string;
  source: 'explicit' | 'inferred';
  confidence?: 'high' | 'medium' | 'low';
  reason?: string;
}

export interface ShardInfo {
  /** Stripped base prefix shared by all shards (case preserved from the representative). */
  base: string;
  /** All original physical shard table names (lexicographically sorted). */
  shards: string[];
}

export interface Table {
  name: string;
  schema?: string;
  columns: Column[];
  primaryKey: string[];
  indexes: IndexDef[];
  comment?: string;
  /** Present iff this table is a representative for ≥2 merged shard tables. */
  shardInfo?: ShardInfo;
}

export interface ParseWarning {
  line: number;
  message: string;
  snippet?: string;
}

export interface Schema {
  tables: Table[];
  explicitForeignKeys: ForeignKey[];
  warnings: ParseWarning[];
  /** Non-error informational notices surfaced from later pipeline stages (e.g. shard merge). */
  notices?: string[];
}
