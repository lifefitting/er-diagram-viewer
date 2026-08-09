import { useCallback, useEffect, useRef, useState } from 'react';
import { decryptWorkspaceArchive } from '../../exports/archive';

export interface ArchiveUnlockRequest {
  content: string;
  fileName: string;
}

/** Promise bridge between file inspection and the shared password dialog. */
export function useArchiveUnlock(active = true) {
  const [request, setRequest] = useState<ArchiveUnlockRequest | null>(null);
  const resolverRef = useRef<((text: string | null) => void) | null>(null);

  const cancel = useCallback(() => {
    resolverRef.current?.(null);
    resolverRef.current = null;
    setRequest(null);
  }, []);

  const requestUnlock = useCallback((content: string, fileName: string) => {
    return new Promise<string | null>((resolve) => {
      resolverRef.current?.(null);
      resolverRef.current = resolve;
      setRequest({ content, fileName });
    });
  }, []);

  const confirmPassword = useCallback(
    async (password: string) => {
      if (!request) throw new Error('没有等待解锁的工作区存档');
      const result = await decryptWorkspaceArchive(request.content, password);
      if (!result.ok) throw new Error(result.error);
      const resolve = resolverRef.current;
      resolverRef.current = null;
      setRequest(null);
      resolve?.(result.text);
    },
    [request],
  );

  useEffect(() => {
    if (!active) cancel();
    return cancel;
  }, [active, cancel]);

  return { request, requestUnlock, confirmPassword, cancel };
}
