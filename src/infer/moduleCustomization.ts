import type { PaletteName } from './paletteCatalog';

export interface CustomModule {
  label: string;
  palette: PaletteName;
  /** Stable slot: adding/removing tables must not recolor a custom module. */
  colorIndex: number;
}

export interface ModuleCustomization {
  customModules: Record<string, CustomModule>;
  /** Requested HEX color; display shades are derived, never persisted. */
  moduleColors: Record<string, string>;
}

export const MAX_MODULE_LABEL_LENGTH = 64;

export function normalizeModuleLabel(value: string): string {
  return value.trim().normalize('NFC');
}

export function validModuleLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    normalizeModuleLabel(value).length > 0 &&
    value.length <= MAX_MODULE_LABEL_LENGTH &&
    !Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}

export function validModuleColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
