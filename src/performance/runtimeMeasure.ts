let sequence = 0;

/** Lightweight browser performance mark with a no-op fallback for tests/SSR. */
export function startRuntimeMeasure(name: string): () => void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return () => {};
  const suffix = `${++sequence}`;
  const start = `${name}:start:${suffix}`;
  const end = `${name}:end:${suffix}`;
  performance.mark(start);
  return () => {
    performance.mark(end);
    performance.measure(name, start, end);
    performance.clearMarks(start);
    performance.clearMarks(end);
  };
}

export function measureRuntimeStage<T>(name: string, operation: () => T): T {
  const finish = startRuntimeMeasure(name);
  try {
    return operation();
  } finally {
    finish();
  }
}
