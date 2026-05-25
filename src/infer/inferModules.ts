import type { ForeignKey, Schema } from '../parser/types';
import { singularize } from './nameMatching';

export interface ModuleColor {
  /** Header background (used for table top bar and edge color). */
  header: string;
  /** Border around the table card. */
  border: string;
  /** Light tint, suitable for backgrounds / chips. */
  tint: string;
  /** Header text color (white / dark depending on contrast). */
  text: string;
}

export interface ModuleInfo {
  /** Canonical module key (lowercase, after prefix-stripping). */
  name: string;
  /** Display label (Title-cased). */
  label: string;
  /** Member table names (original casing as in schema). */
  tables: string[];
  color: ModuleColor;
}

export interface ModulesResult {
  /** table name (as in schema) → module key */
  byTable: Map<string, string>;
  /** module key → info */
  modules: Map<string, ModuleInfo>;
  /** Stable ordered list of modules (largest first, then alphabetical). */
  ordered: ModuleInfo[];
}

export type PaletteName = 'vibrant' | 'pastel' | 'earth' | 'mono';

/**
 * Four hand-tuned palettes, each with 12 distinct slots. All palettes keep header
 * text legible (white on dark headers, ink on light headers) and pair a darker
 * `header` with a lighter `border` and a near-white `tint` so the same module
 * color renders consistently across the table card, the edge line, and chips.
 */
export const MODULE_PALETTES: Record<PaletteName, ModuleColor[]> = {
  // Vibrant: saturated Tailwind 600-tier hues. Default / loudest.
  vibrant: [
    { header: '#2563eb', border: '#60a5fa', tint: '#dbeafe', text: '#ffffff' }, // blue
    { header: '#ea580c', border: '#fb923c', tint: '#ffedd5', text: '#ffffff' }, // orange
    { header: '#16a34a', border: '#4ade80', tint: '#dcfce7', text: '#ffffff' }, // green
    { header: '#9333ea', border: '#c084fc', tint: '#f3e8ff', text: '#ffffff' }, // purple
    { header: '#db2777', border: '#f472b6', tint: '#fce7f3', text: '#ffffff' }, // pink
    { header: '#0891b2', border: '#22d3ee', tint: '#cffafe', text: '#ffffff' }, // cyan
    { header: '#ca8a04', border: '#facc15', tint: '#fef9c3', text: '#1f2235' }, // amber (dark text)
    { header: '#65a30d', border: '#a3e635', tint: '#ecfccb', text: '#ffffff' }, // lime
    { header: '#7c3aed', border: '#a78bfa', tint: '#ede9fe', text: '#ffffff' }, // violet
    { header: '#0d9488', border: '#2dd4bf', tint: '#ccfbf1', text: '#ffffff' }, // teal
    { header: '#dc2626', border: '#f87171', tint: '#fee2e2', text: '#ffffff' }, // red
    { header: '#475569', border: '#94a3b8', tint: '#e2e8f0', text: '#ffffff' }, // slate
  ],
  // Pastel: soft tints. Headers use Tailwind 300/400-tier so text stays dark.
  pastel: [
    { header: '#93c5fd', border: '#bfdbfe', tint: '#eff6ff', text: '#1e3a8a' }, // sky
    { header: '#fcd5b5', border: '#fed7aa', tint: '#fff7ed', text: '#7c2d12' }, // peach
    { header: '#bbf7d0', border: '#d1fae5', tint: '#f0fdf4', text: '#14532d' }, // mint
    { header: '#ddd6fe', border: '#ede9fe', tint: '#faf5ff', text: '#581c87' }, // lavender
    { header: '#fbcfe8', border: '#fce7f3', tint: '#fdf2f8', text: '#831843' }, // rose
    { header: '#a5f3fc', border: '#cffafe', tint: '#ecfeff', text: '#155e75' }, // sky-aqua
    { header: '#fde68a', border: '#fef3c7', tint: '#fffbeb', text: '#713f12' }, // butter
    { header: '#d9f99d', border: '#ecfccb', tint: '#f7fee7', text: '#365314' }, // lime-mist
    { header: '#c7d2fe', border: '#e0e7ff', tint: '#eef2ff', text: '#312e81' }, // periwinkle
    { header: '#99f6e4', border: '#ccfbf1', tint: '#f0fdfa', text: '#134e4a' }, // sea
    { header: '#fecaca', border: '#fee2e2', tint: '#fef2f2', text: '#7f1d1d' }, // blush
    { header: '#cbd5e1', border: '#e2e8f0', tint: '#f1f5f9', text: '#1f2937' }, // stone
  ],
  // Earth: warm browns / olives / muted neutrals. Magazine-page feel.
  earth: [
    { header: '#78350f', border: '#b45309', tint: '#fef3c7', text: '#fef3c7' }, // amber-bark
    { header: '#854d0e', border: '#a16207', tint: '#fef9c3', text: '#fefce8' }, // ochre
    { header: '#3f6212', border: '#65a30d', tint: '#ecfccb', text: '#f7fee7' }, // moss
    { header: '#7c2d12', border: '#c2410c', tint: '#ffedd5', text: '#fff7ed' }, // brick
    { header: '#365314', border: '#4d7c0f', tint: '#ecfccb', text: '#f7fee7' }, // olive
    { header: '#713f12', border: '#a16207', tint: '#fef9c3', text: '#fefce8' }, // sand
    { header: '#92400e', border: '#d97706', tint: '#fef3c7', text: '#fffbeb' }, // copper
    { header: '#44403c', border: '#78716c', tint: '#f5f5f4', text: '#fafaf9' }, // stone-warm
    { header: '#57534e', border: '#a8a29e', tint: '#e7e5e4', text: '#fafaf9' }, // taupe
    { header: '#581c87', border: '#7e22ce', tint: '#f3e8ff', text: '#faf5ff' }, // grape (accent)
    { header: '#0f766e', border: '#0d9488', tint: '#ccfbf1', text: '#f0fdfa' }, // pine
    { header: '#1f2937', border: '#374151', tint: '#e5e7eb', text: '#f9fafb' }, // charcoal
  ],
  // Mono: blue-grey stepwise scale, lightest → darkest. Useful for printouts.
  mono: [
    { header: '#1e293b', border: '#334155', tint: '#e2e8f0', text: '#f8fafc' }, // slate-900
    { header: '#334155', border: '#475569', tint: '#e2e8f0', text: '#f8fafc' }, // slate-700
    { header: '#475569', border: '#64748b', tint: '#e2e8f0', text: '#f8fafc' }, // slate-600
    { header: '#0f172a', border: '#1e293b', tint: '#cbd5e1', text: '#f8fafc' }, // slate-950 (anchor)
    { header: '#0c4a6e', border: '#075985', tint: '#e0f2fe', text: '#f0f9ff' }, // sky-900
    { header: '#075985', border: '#0369a1', tint: '#e0f2fe', text: '#f0f9ff' }, // sky-800
    { header: '#0369a1', border: '#0284c7', tint: '#dbeafe', text: '#f0f9ff' }, // sky-700
    { header: '#1e3a8a', border: '#1e40af', tint: '#dbeafe', text: '#eff6ff' }, // blue-900
    { header: '#1e40af', border: '#1d4ed8', tint: '#dbeafe', text: '#eff6ff' }, // blue-800
    { header: '#64748b', border: '#94a3b8', tint: '#f1f5f9', text: '#f8fafc' }, // slate-500
    { header: '#94a3b8', border: '#cbd5e1', tint: '#f1f5f9', text: '#0f172a' }, // slate-400 (dark text)
    { header: '#cbd5e1', border: '#e2e8f0', tint: '#f8fafc', text: '#0f172a' }, // slate-300 (dark text)
  ],
};

export const DEFAULT_PALETTE: PaletteName = 'vibrant';

const FALLBACK_COLORS: Record<PaletteName, ModuleColor> = {
  vibrant: { header: '#3f465e', border: '#7a82a0', tint: '#eceef2', text: '#ffffff' },
  pastel: { header: '#cbd5e1', border: '#e2e8f0', tint: '#f8fafc', text: '#1f2937' },
  earth: { header: '#57534e', border: '#a8a29e', tint: '#f5f5f4', text: '#fafaf9' },
  mono: { header: '#475569', border: '#64748b', tint: '#e2e8f0', text: '#f8fafc' },
};

const COMMON_PREFIXES = ['t_', 'tbl_', 'tb_'];

/** Words that are rarely the actual "domain" of a table; skip them when picking module seed. */
const NOISE_TOKENS = new Set([
  'tmp', 'temp', 'bak', 'backup', 'old', 'new', 'log', 'logs',
  'rel', 'ref', 'map', 'mapping', 'rec', 'record', 'records',
]);

function stripPrefix(name: string): string {
  const lower = name.toLowerCase();
  for (const p of COMMON_PREFIXES) {
    if (lower.startsWith(p)) return name.slice(p.length);
  }
  return name;
}

/** Split a table name into lowercase tokens. Handles snake_case and CamelCase. */
function tokens(name: string): string[] {
  const stripped = stripPrefix(name);
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

/**
 * Pick the leading non-noise token (singularized so `users` / `user` / `user_addresses`
 * all share the same `user` seed); fall back to the first token, then the raw name.
 */
function moduleSeed(name: string): string {
  const ts = tokens(name);
  if (ts.length === 0) return singularize(name.toLowerCase());
  for (const t of ts) {
    if (!NOISE_TOKENS.has(t)) return singularize(t);
  }
  return singularize(ts[0]);
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Infer table → module assignment from table names and FK topology.
 *
 * Strategy:
 * 1. Seed each table with the first meaningful token of its name (after stripping
 *    common `t_`/`tbl_`/`tb_` prefixes, skipping noise tokens like `tmp`/`log`,
 *    and singularizing — so `users` / `user` / `user_addresses` all share `user`).
 * 2. Single-pass merge: a singleton module whose table acts as an FK *source*
 *    (i.e. references another table) gets pulled into the largest target module
 *    among its outbound FKs — but only if that target is strictly larger than
 *    the current module. This is asymmetric on purpose: a "parent" table that
 *    is referenced (high in-degree, zero out-degree) keeps its own module rather
 *    than being swallowed by a child's module.
 * 3. Assign a color from a fixed palette in a stable, schema-order-independent
 *    way (modules with more tables get earlier palette slots).
 */
export function inferModules(
  schema: Schema,
  fks: ForeignKey[],
  palette: PaletteName = DEFAULT_PALETTE,
): ModulesResult {
  if (!schema || schema.tables.length === 0) {
    return { byTable: new Map(), modules: new Map(), ordered: [] };
  }
  const paletteColors = MODULE_PALETTES[palette] ?? MODULE_PALETTES[DEFAULT_PALETTE];
  const fallbackColor = FALLBACK_COLORS[palette] ?? FALLBACK_COLORS[DEFAULT_PALETTE];

  const seedByTable = new Map<string, string>();
  const seedCount = new Map<string, number>();
  for (const t of schema.tables) {
    const seed = moduleSeed(t.name);
    seedByTable.set(t.name, seed);
    seedCount.set(seed, (seedCount.get(seed) ?? 0) + 1);
  }

  // Per-table outbound FK targets (this table references those tables).
  const tableSet = new Set(schema.tables.map((t) => t.name));
  const outTargets = new Map<string, string[]>();
  for (const fk of fks) {
    if (!tableSet.has(fk.fromTable) || !tableSet.has(fk.toTable)) continue;
    if (fk.fromTable === fk.toTable) continue;
    if (!outTargets.has(fk.fromTable)) outTargets.set(fk.fromTable, []);
    outTargets.get(fk.fromTable)!.push(fk.toTable);
  }

  // Up to a couple of passes lets a table merge through a chain (e.g. t_post_tag → t_post → user
  // collapsing across two iterations), but we cap it so the algorithm can't snowball every table
  // into a single mega-module.
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const t of schema.tables) {
      const cur = seedByTable.get(t.name)!;
      const curSize = seedCount.get(cur) ?? 0;
      if (curSize !== 1) continue; // only merge singletons
      const out = outTargets.get(t.name);
      if (!out || out.length === 0) continue; // pure parent / hub — keep its own module

      const counts = new Map<string, number>();
      for (const n of out) {
        const m = seedByTable.get(n);
        if (!m || m === cur) continue;
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
      let best: { mod: string; cnt: number } | null = null;
      for (const [mod, cnt] of counts) {
        const size = seedCount.get(mod) ?? 0;
        if (size <= curSize) continue; // only merge into strictly larger modules
        if (!best || cnt > best.cnt || (cnt === best.cnt && mod < best.mod)) {
          best = { mod, cnt };
        }
      }
      if (best) {
        seedByTable.set(t.name, best.mod);
        seedCount.set(cur, curSize - 1);
        seedCount.set(best.mod, (seedCount.get(best.mod) ?? 0) + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Build module list and assign colors. Larger modules first (so they grab the most
  // distinctive palette slots), then alphabetical for determinism.
  const moduleKeys = Array.from(new Set(seedByTable.values()));
  moduleKeys.sort((a, b) => {
    const ca = seedCount.get(a) ?? 0;
    const cb = seedCount.get(b) ?? 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });

  const modules = new Map<string, ModuleInfo>();
  const ordered: ModuleInfo[] = [];
  moduleKeys.forEach((key, idx) => {
    const color = paletteColors[idx] ?? fallbackColor;
    const info: ModuleInfo = { name: key, label: titleCase(key), tables: [], color };
    modules.set(key, info);
    ordered.push(info);
  });
  for (const t of schema.tables) {
    const mod = seedByTable.get(t.name)!;
    modules.get(mod)?.tables.push(t.name);
  }

  return { byTable: seedByTable, modules, ordered };
}

/** Resolve a table's module color, or a neutral fallback if unassigned. */
export function colorForTableModule(
  tableName: string,
  byTable: Map<string, string>,
  modules: Map<string, ModuleInfo>,
): ModuleColor {
  const key = byTable.get(tableName);
  const fallback = FALLBACK_COLORS[DEFAULT_PALETTE];
  if (!key) return fallback;
  return modules.get(key)?.color ?? fallback;
}
