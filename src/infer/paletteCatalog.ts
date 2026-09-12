/** One registry for the toolbar and workspace validation. IDs are persisted. */
export const PALETTE_OPTIONS = [
  { id: 'professional', label: '沉稳', description: '低饱和，评审默认' },
  { id: 'qingci', label: '青瓷', description: '青绿珊瑚，清爽耐看' },
  { id: 'twilight', label: '暮光', description: '紫红琥珀，层次鲜明' },
  { id: 'contrast', label: '高辨识', description: '模块分明，演示优先' },
  { id: 'vibrant', label: '明快', description: '高饱和，色彩鲜明' },
  { id: 'pastel', label: '柔和', description: '浅色表头，清晰连线' },
  { id: 'earth', label: '大地', description: '暖褐色调' },
  { id: 'mono', label: '单色', description: '蓝灰阶，适合打印' },
] as const;

export type PaletteName = (typeof PALETTE_OPTIONS)[number]['id'];
export const PALETTE_IDS: ReadonlySet<string> = new Set(PALETTE_OPTIONS.map(({ id }) => id));

/** One foreground per palette, including generated overflow slots. Never
 * switch individual table titles between black and white. */
export const PALETTE_HEADER_TEXT: Record<PaletteName, string> = {
  professional: '#ffffff',
  qingci: '#ffffff',
  twilight: '#ffffff',
  contrast: '#ffffff',
  vibrant: '#ffffff',
  pastel: '#1f2937',
  earth: '#ffffff',
  mono: '#ffffff',
};
