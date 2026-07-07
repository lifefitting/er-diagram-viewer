import { lazy, Suspense, useEffect, useState } from 'react';
import { Toolbar } from './ui/overlays/Toolbar';
import { CanvasControls } from './ui/overlays/CanvasControls';
import { RecycleBin } from './ui/overlays/RecycleBin';
import { SqlInputDialog } from './ui/overlays/SqlInputDialog';
import { Sidebar } from './ui/sidebar/Sidebar';
import { useApp } from './store';
import { SAMPLE_ECOMMERCE } from './samples';
import { useApplyTheme } from './ui/theme/useApplyTheme';
import { ErrorBoundary } from './ui/ErrorBoundary';

// Lazy-load the diagram canvas. Pulling cytoscape (≈250 KB minified) only
// when there's actually a schema to render lets the first paint complete
// before the graph engine code is even parsed. Combined with the
// manualChunks split in vite.config.ts, cytoscape ends up in its own
// cacheable chunk that downloads in parallel with the main bundle but
// does not block FCP.
const DiagramCanvas = lazy(() => import('./diagram/DiagramCanvas'));

export default function App() {
  useApplyTheme();
  const [importOpen, setImportOpen] = useState(false);
  const schema = useApp((s) => s.schema);
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed);
  const setSql = useApp((s) => s.setSql);

  useEffect(() => {
    // Three startup paths, in priority order:
    //   1. Persisted `rawSql` exists → just rebuild derived state (schema,
    //      inferred FKs, modules). The user's last imported SQL, decisions,
    //      collapse states, etc. all come back. Survives ⌘R.
    //   2. No persisted SQL → first-time visit, load the bundled sample so
    //      the canvas isn't empty.
    //   3. Persisted SQL exists but parse failed → KEEP rawSql (it may be
    //      irreplaceable production DDL; the import dialog still shows it for
    //      hand-fixing) and surface the failure as an empty canvas plus a
    //      sidebar warning. Never overwrite the user's SQL with the sample.
    const state = useApp.getState();
    if (state.rawSql) {
      try {
        state.reparse();
      } catch (err) {
        console.error('[startup] failed to reparse persisted SQL:', err);
        const msg = err instanceof Error ? err.message : String(err);
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
    } else {
      state.setSql(SAMPLE_ECOMMERCE);
    }
  }, [setSql]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-inkd-50 text-ink-800 dark:text-inkd-800">
      {/* Toolbar gets its own stacking context so canvas overlays can never sit
          on top of it, even before the canvas container clips them. */}
      <div className="relative z-30">
        <Toolbar onOpenImport={() => setImportOpen(true)} />
      </div>
      {/* The canvas region clips overflow so dragged table cards cannot bleed
          out past the canvas edges (under the toolbar or behind the sidebar). */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        <main className="absolute inset-0">
          {schema && schema.tables.length > 0 ? (
            <ErrorBoundary>
              <Suspense fallback={<CanvasLoading />}>
                <DiagramCanvas />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div className="h-full flex items-center justify-center text-ink-400 dark:text-inkd-500 text-sm">
              点击「导入 SQL」开始
            </div>
          )}
        </main>
        {schema && schema.tables.length > 0 && <CanvasControls />}
        {schema && schema.tables.length > 0 && <RecycleBin />}
        <Sidebar collapsed={sidebarCollapsed} />
      </div>
      <SqlInputDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/**
 * Loading state shown while the lazy `DiagramCanvas` chunk (cytoscape +
 * extensions) downloads and parses. Mirrors the visual rhythm of the inline
 * skeleton in index.html so there's no jarring swap when React takes over
 * from the static skeleton.
 */
function CanvasLoading() {
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
        正在加载图表引擎…
      </div>
    </div>
  );
}
