import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type FpsInteraction = 'pan' | 'table';

export interface InteractionFpsHudHandle {
  start: (interaction: FpsInteraction) => void;
  frame: (timestamp?: number) => void;
  stop: () => void;
}

interface FpsSample {
  interaction: FpsInteraction;
  fps: number | null;
}

const PUBLISH_INTERVAL_MS = 80;
const NO_MOVEMENT_AFTER_MS = 220;
const FRAME_SMOOTHING = 0.35;

/** Smooth real canvas-update intervals while reacting quickly to a dropped frame. */
export function smoothFrameInterval(previous: number | null, interval: number): number | null {
  if (!Number.isFinite(interval) || interval <= 0 || interval >= NO_MOVEMENT_AFTER_MS) return null;
  if (previous == null) return interval;
  return previous * (1 - FRAME_SMOOTHING) + interval * FRAME_SMOOTHING;
}

function interactionLabel(interaction: FpsInteraction): string {
  return interaction === 'pan' ? 'CANVAS PAN' : 'TABLE DRAG';
}

function meterTone(fps: number | null): { dot: string; value: string } {
  if (fps == null) return { dot: 'bg-sky-400', value: 'text-sky-300' };
  if (fps >= 55) return { dot: 'bg-emerald-400', value: 'text-emerald-300' };
  if (fps >= 40) return { dot: 'bg-amber-400', value: 'text-amber-300' };
  return { dot: 'bg-rose-400', value: 'text-rose-300' };
}

/**
 * A transient FPS readout owned by its own React subtree. DiagramCanvas drives
 * it imperatively so publishing a sample never re-renders tables or routes.
 */
export const InteractionFpsHud = forwardRef<InteractionFpsHudHandle>(
  function InteractionFpsHud(_props, ref) {
    const [sample, setSample] = useState<FpsSample | null>(null);
    const interactionRef = useRef<FpsInteraction | null>(null);
    const previousFrameAtRef = useRef<number | null>(null);
    const smoothedFrameMsRef = useRef<number | null>(null);
    const lastPublishedAtRef = useRef<number | null>(null);
    const noMovementTimerRef = useRef<number | null>(null);

    const clearNoMovementTimer = useCallback(() => {
      if (noMovementTimerRef.current == null) return;
      window.clearTimeout(noMovementTimerRef.current);
      noMovementTimerRef.current = null;
    }, []);

    const start = useCallback(
      (interaction: FpsInteraction) => {
        clearNoMovementTimer();
        interactionRef.current = interaction;
        previousFrameAtRef.current = null;
        smoothedFrameMsRef.current = null;
        lastPublishedAtRef.current = null;
        setSample({ interaction, fps: null });
      },
      [clearNoMovementTimer],
    );

    const frame = useCallback(
      (timestamp = performance.now()) => {
        const interaction = interactionRef.current;
        if (!interaction) return;

        const previous = previousFrameAtRef.current;
        previousFrameAtRef.current = timestamp;

        if (previous != null) {
          smoothedFrameMsRef.current = smoothFrameInterval(
            smoothedFrameMsRef.current,
            timestamp - previous,
          );
        }

        const lastPublished = lastPublishedAtRef.current;
        if (lastPublished != null && timestamp - lastPublished < PUBLISH_INTERVAL_MS) return;
        lastPublishedAtRef.current = timestamp;

        const frameMs = smoothedFrameMsRef.current;
        const fps = frameMs == null ? null : Math.min(999, 1000 / frameMs);
        setSample({ interaction, fps });

        clearNoMovementTimer();
        noMovementTimerRef.current = window.setTimeout(() => {
          if (interactionRef.current === interaction) {
            setSample({ interaction, fps: 0 });
          }
          noMovementTimerRef.current = null;
        }, NO_MOVEMENT_AFTER_MS);
      },
      [clearNoMovementTimer],
    );

    const stop = useCallback(() => {
      interactionRef.current = null;
      previousFrameAtRef.current = null;
      smoothedFrameMsRef.current = null;
      lastPublishedAtRef.current = null;
      clearNoMovementTimer();
      setSample(null);
    }, [clearNoMovementTimer]);

    useImperativeHandle(ref, () => ({ start, frame, stop }), [frame, start, stop]);

    useEffect(
      () => () => {
        interactionRef.current = null;
        clearNoMovementTimer();
      },
      [clearNoMovementTimer],
    );

    if (!sample) return null;

    const tone = meterTone(sample.fps);
    const frameTime = sample.fps && sample.fps > 0 ? 1000 / sample.fps : null;
    const fpsText = sample.fps == null ? '--' : sample.fps.toFixed(1);

    return (
      <div
        className={
          'pointer-events-none absolute bottom-16 left-1/2 z-30 min-w-[146px] -translate-x-1/2 overflow-hidden rounded-lg ' +
          'border border-emerald-400/25 bg-slate-950/90 px-3 py-2 font-mono text-slate-300 ' +
          'shadow-2xl shadow-black/25 backdrop-blur-md'
        }
        data-interaction-fps
        data-interaction-kind={sample.interaction}
        data-fps-value={sample.fps == null ? undefined : sample.fps.toFixed(1)}
        role="status"
        aria-live="off"
        aria-label={`${interactionLabel(sample.interaction)} ${sample.fps == null ? '正在采样' : sample.fps.toFixed(1)} FPS`}
      >
        <div className="flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.16em] text-slate-400">
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
          <span>{interactionLabel(sample.interaction)}</span>
          <span className="ml-auto text-[8px] tracking-wider text-slate-500">LIVE</span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
          <span className={`text-[26px] font-semibold leading-none ${tone.value}`}>{fpsText}</span>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-400">FPS</span>
        </div>
        <div className="mt-1 text-[9px] tabular-nums text-slate-500">
          {sample.fps === 0
            ? 'NO CANVAS UPDATES'
            : frameTime == null
              ? 'SAMPLING CANVAS UPDATES'
              : `${frameTime.toFixed(1)} MS / FRAME`}
        </div>
      </div>
    );
  },
);
