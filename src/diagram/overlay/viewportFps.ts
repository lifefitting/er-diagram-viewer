import type { Viewport } from '../../store/types';

export const VIEWPORT_FPS_IDLE_MS = 180;

/** Observe actual camera values, not input devices. The HUD start callback is
 * idempotent, so a newer viewport movement can resume after a table drag without
 * resetting the sample on every animation frame. No polling or rAF loop. */
export function createViewportFpsTracker(initial: Viewport, start: () => void, stop: () => void) {
  let previous = { ...initial };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    update(next: Viewport, enabled = true) {
      if (disposed) return;
      if (next.x === previous.x && next.y === previous.y && next.zoom === previous.zoom) return;
      previous = { ...next };
      if (!enabled) return; // A live table drag owns the same HUD.
      start();
      clearTimer();
      timer = setTimeout(() => {
        timer = undefined;
        stop();
      }, VIEWPORT_FPS_IDLE_MS);
    },
    dispose() {
      disposed = true;
      clearTimer();
      stop();
    },
  };
}
