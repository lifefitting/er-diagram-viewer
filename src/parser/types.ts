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
  /** 'explicit' = declared in the DDL; 'inferred' = produced by the inference
   *  engine; 'manual' = added by the user in the inference panel (treated as
   *  authoritative, like explicit — always drawn solid, never gated by
   *  decisions). */
  source: 'explicit' | 'inferred' | 'manual';
  /** 'fk' (default when absent) = physical foreign-key semantics; 'logical' =
   *  a business-key association (e.g. two sharded services joined by
   *  `out_trade_no`) with NO physical constraint: rendered undirected
   *  (dotted, circle endpoints) and exported as a SQL comment instead of an
   *  ALTER TABLE. Logical FKs are ALWAYS stored with endpoints ordered by
   *  (table, column) — see `canonicalizeLogicalFk` — so the reversed form of a
   *  link can never exist and its `canonicalFkKey` is direction-stable. */
  kind?: 'fk' | 'logical';
  /** Manual (hand-drawn) relations only: which connect dot the drag STARTED
   *  from. Drives which side a same-table loop bulges out of, and is worth
   *  persisting — it captures the user's spatial intent. */
  drawSide?: 'left' | 'right';
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
