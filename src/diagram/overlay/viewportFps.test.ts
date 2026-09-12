import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewportFpsTracker, VIEWPORT_FPS_IDLE_MS } from './viewportFps';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('viewport FPS activity', () => {
  it('ignores unchanged camera notifications, including zoom limits', () => {
    const initial = { x: 0, y: 0, zoom: 1 };
    const start = vi.fn(),
      stop = vi.fn();
    const tracker = createViewportFpsTracker(initial, start, stop);
    tracker.update(initial);
    expect(start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // Cytoscape exposes mutable objects: comparison must retain a snapshot.
    initial.x = 20;
    tracker.update(initial);
    expect(start).toHaveBeenCalledOnce();
    tracker.dispose();
  });

  it('tracks pan and zoom across successive animation frames, then stops once', () => {
    const start = vi.fn(),
      stop = vi.fn();
    const tracker = createViewportFpsTracker({ x: 0, y: 0, zoom: 1 }, start, stop);
    tracker.update({ x: 5, y: 0, zoom: 1 });
    vi.advanceTimersByTime(100);
    tracker.update({ x: 5, y: 0, zoom: 0.75 });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(VIEWPORT_FPS_IDLE_MS - 1);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    tracker.update({ x: 8, y: 0, zoom: 0.75 });
    expect(start).toHaveBeenCalledTimes(3);
    tracker.dispose();
  });

  it('does not take over a table drag, and resumes on the next camera movement', () => {
    const start = vi.fn(),
      stop = vi.fn();
    const tracker = createViewportFpsTracker({ x: 0, y: 0, zoom: 1 }, start, stop);
    tracker.update({ x: 5, y: 0, zoom: 1 }, false);
    expect(start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    tracker.update({ x: 8, y: 0, zoom: 1 });
    expect(start).toHaveBeenCalledOnce();
    tracker.dispose();
  });

  it('cancels its pending timeout on unmount and ignores late notifications', () => {
    const start = vi.fn(),
      stop = vi.fn();
    const tracker = createViewportFpsTracker({ x: 0, y: 0, zoom: 1 }, start, stop);
    tracker.update({ x: 5, y: 0, zoom: 1 });
    tracker.dispose();
    expect(vi.getTimerCount()).toBe(0);
    tracker.update({ x: 10, y: 0, zoom: 1 });
    vi.advanceTimersByTime(1000);
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
