import type { Table } from '../parser/types';
import type { ModuleColor } from '../infer/inferModules';

export interface NodePos {
  id: string;
  table: Table;
  x: number;
  y: number;
  w: number;
  h: number;
  moduleColor: ModuleColor;
  moduleKey: string;
}

export type OverlayState = 'match' | 'neighbor' | 'dim' | 'neutral';

export type Selection = { matches: Set<string>; neighborhood: Set<string> } | null;
