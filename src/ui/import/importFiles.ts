import {
  isEncryptedWorkspaceArchive,
  looksLikeArchive,
  parseWorkspaceArchive,
  type ParseArchiveResult,
} from '../../exports/archive';

export type LoadedArchive = Extract<ParseArchiveResult, { ok: true }>;

export interface InspectedImportFile {
  content: string;
  fileName: string;
  size: number;
  encrypted: boolean;
  archive: ParseArchiveResult | null;
}

export type RequestArchiveUnlock = (
  encryptedContent: string,
  fileName: string,
) => Promise<string | null>;

export type InspectImportFilesResult =
  | { cancelled: true; files: [] }
  | { cancelled: false; files: InspectedImportFile[] };

/** Classify already-readable text without mutating the application store. */
export function inspectImportContent(
  content: string,
  fileName: string,
  size: number,
  encrypted = false,
): InspectedImportFile {
  return {
    content,
    fileName,
    size,
    encrypted,
    archive: looksLikeArchive(content) ? parseWorkspaceArchive(content) : null,
  };
}

/**
 * Read and classify files for both the full import dialog and the empty
 * workspace fast path. Encrypted archives are unlocked through a UI callback;
 * no store write happens here, so callers retain atomic commit semantics.
 */
export async function inspectImportFiles(
  files: readonly File[],
  requestUnlock: RequestArchiveUnlock,
): Promise<InspectImportFilesResult> {
  const inspected: InspectedImportFile[] = [];
  for (const file of files) {
    const originalContent = await file.text();
    const encrypted = isEncryptedWorkspaceArchive(originalContent);
    const content = encrypted ? await requestUnlock(originalContent, file.name) : originalContent;
    if (content === null) return { cancelled: true, files: [] };
    inspected.push(inspectImportContent(content, file.name, file.size, encrypted));
  }
  return { cancelled: false, files: inspected };
}
