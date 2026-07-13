import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort guard around the canvas subtree: a render/effect crash degrades
 * to an inline message instead of unmounting the whole app. The store (and
 * sessionStorage persistence) is untouched, so the user's SQL, decisions and
 * layout survive a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
        <div className="text-sm font-medium text-ink-800 dark:text-inkd-800">画布渲染出错</div>
        <div className="text-[12px] text-ink-400 dark:text-inkd-500 font-mono max-w-[560px] break-all">
          {this.state.error.message}
        </div>
        <div className="text-[12px] text-ink-400 dark:text-inkd-500">
          已导入的 SQL 与布局仍然保留，刷新页面即可恢复。
        </div>
        <button
          type="button"
          className="mt-1 px-3 py-1.5 text-sm rounded-md bg-ink-800 dark:bg-inkd-700 text-white dark:text-inkd-50 hover:bg-ink-900 dark:hover:bg-inkd-800 transition-colors"
          onClick={() => window.location.reload()}
        >
          刷新页面
        </button>
      </div>
    );
  }
}
