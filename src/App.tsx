import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Toolbar } from './ui/overlays/Toolbar';
import { CanvasControls } from './ui/overlays/CanvasControls';
import { RecycleBin } from './ui/overlays/RecycleBin';
import { ReviewNotesOverlay } from './ui/overlays/ReviewNotes';
import { SqlInputDialog, type ImportMode } from './ui/overlays/SqlInputDialog';
import { Sidebar } from './ui/sidebar/Sidebar';
import { useApp } from './store';
import { useApplyTheme } from './ui/theme/useApplyTheme';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { CanvasContextMenu, type CanvasContextMenuPosition } from './ui/overlays/CanvasContextMenu';
import { EmptyWorkspace, WorkspaceRecovery } from './ui/empty/EmptyWorkspace';
import { resolveStartupView } from './store/startupState';

// Lazy-load the diagram canvas. Pulling cytoscape (≈250 KB minified) only
// when there's actually a schema to render lets the first paint complete
// before the graph engine code is even parsed. Combined with the
// manualChunks split in vite.config.ts, cytoscape ends up in its own
// cacheable chunk that downloads in parallel with the main bundle but
// does not block FCP.
const DiagramCanvas = lazy(() => import('./diagram/DiagramCanvas'));

export default function App() {
  useApplyTheme();
  const hydrated = usePersistHydrated();
  const [startupComplete, setStartupComplete] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const startupHandledRef = useRef(false);
  const [importDialog, setImportDialog] = useState<{
    open: boolean;
    mode: ImportMode;
    initialFiles: File[];
  }>({ open: false, mode: 'sql', initialFiles: [] });
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuPosition | null>(
    null,
  );
  const schema = useApp((s) => s.schema);
  const rawSql = useApp((s) => s.rawSql);
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed);
  const workspaceEpoch = useApp((s) => s.workspaceEpoch);
  const closeCanvasContextMenu = useCallback(() => setCanvasContextMenu(null), []);
  const openImport = useCallback((mode: ImportMode = 'sql', initialFiles: File[] = []) => {
    setImportDialog({ open: true, mode, initialFiles });
  }, []);
  const closeImport = useCallback(
    () => setImportDialog((current) => ({ ...current, open: false, initialFiles: [] })),
    [],
  );

  useEffect(() => {
    if (!hydrated || startupHandledRef.current) return;
    startupHandledRef.current = true;
    // Hydration-safe startup paths:
    //   1. Persisted rawSql → rebuild derived state and restore the workspace.
    //   2. No rawSql → leave the store empty and show the explicit launcher.
    //   3. Reparse failure → keep the irreplaceable SQL and offer recovery.
    // Never infer "empty" before hydration, and never overwrite a failed
    // restore with the bundled sample.
    const state = useApp.getState();
    if (state.rawSql.trim()) {
      try {
        state.reparse();
      } catch (err) {
        console.error('[startup] failed to reparse persisted SQL:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setStartupError(msg);
        useApp.setState({
          schema: {
            tables: [],
            explicitForeignKeys: [],
            warnings: [
              {
                line: 0,
                message: `已保存的 SQL 解析失败：${msg} —— 原文仍保留，打开「导入 SQL」可查看并修改。`,
              },
            ],
          },
        });
      }
    }
    setStartupComplete(true);
  }, [hydrated]);

  const tableCount = schema?.tables.length ?? 0;
  const startupView = resolveStartupView({ hydrated, startupComplete, rawSql, tableCount });
  const hasSchema = startupView === 'workspace';

  return (
    <div className="h-full flex flex-col bg-white dark:bg-inkd-50 text-ink-800 dark:text-inkd-800">
      {/* Toolbar gets its own stacking context so canvas overlays can never sit
          on top of it, even before the canvas container clips them. */}
      <div className="relative z-30">
        <Toolbar onOpenImport={() => openImport('sql')} />
      </div>
      {/* The canvas region clips overflow so dragged table cards cannot bleed
          out past the canvas edges (under the toolbar or behind the sidebar). */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        <main
          data-testid="canvas-region"
          className="absolute inset-0"
          onContextMenu={(event) => {
            if (!hasSchema) return;
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest('input, textarea, select, [contenteditable="true"]')
            ) {
              return;
            }
            event.preventDefault();
            setCanvasContextMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          {startupView === 'workspace' ? (
            <ErrorBoundary>
              <Suspense fallback={<CanvasLoading />}>
                {/* keyed so an archive import (importWorkspace) remounts the
                    canvas — a fresh mount re-arms the one-shot camera restore
                    and drops stale in-session positions, replaying the
                    page-refresh restore path against the imported layout. */}
                <DiagramCanvas key={workspaceEpoch} />
              </Suspense>
            </ErrorBoundary>
          ) : startupView === 'empty' ? (
            <EmptyWorkspace onOpenImport={openImport} />
          ) : startupView === 'recovery' ? (
            <WorkspaceRecovery error={startupError} onOpenSql={() => openImport('sql')} />
          ) : (
            <CanvasLoading label="正在恢复当前会话…" />
          )}
          {hasSchema && canvasContextMenu && (
            <CanvasContextMenu position={canvasContextMenu} onClose={closeCanvasContextMenu} />
          )}
        </main>
        {hasSchema && <CanvasControls />}
        {hasSchema && <RecycleBin />}
        {hasSchema && <ReviewNotesOverlay />}
        {hasSchema && <Sidebar collapsed={sidebarCollapsed} />}
      </div>
      <SqlInputDialog
        open={importDialog.open}
        initialMode={importDialog.mode}
        initialFiles={importDialog.initialFiles}
        onClose={closeImport}
      />
    </div>
  );
}

/**
 * Loading state shown while the lazy `DiagramCanvas` chunk (cytoscape +
 * extensions) downloads and parses. Mirrors the visual rhythm of the inline
 * skeleton in index.html so there's no jarring swap when React takes over
 * from the static skeleton.
 */
function CanvasLoading({ label = '正在加载图表引擎…' }: { label?: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-ink-50/40 dark:bg-inkd-50/40">
      <div className="flex items-center gap-2 text-ink-400 dark:text-inkd-500 text-[12px]">
        <svg
          className="animate-spin"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
        >
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path
            d="M14 8a6 6 0 0 0-6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        {label}
      </div>
    </div>
  );
}

function usePersistHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useApp.persist.hasHydrated());

  useEffect(() => {
    setHydrated(useApp.persist.hasHydrated());
    const unsubscribeHydrate = useApp.persist.onHydrate(() => setHydrated(false));
    const unsubscribeFinish = useApp.persist.onFinishHydration(() => setHydrated(true));
    return () => {
      unsubscribeHydrate();
      unsubscribeFinish();
    };
  }, []);

  return hydrated;
}
