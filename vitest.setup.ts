// Test setup: provide a minimal in-memory `sessionStorage` for the `node` test
// environment. The Zustand store (`src/store/index.ts`) persists to
// sessionStorage; without this shim, store tests print benign
// "storage currently unavailable" warnings. In the browser the real
// sessionStorage is used.
if (typeof globalThis.sessionStorage === 'undefined') {
  const mem = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return mem.size;
    },
    clear: () => mem.clear(),
    getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
    key: (index: number) => Array.from(mem.keys())[index] ?? null,
    removeItem: (key: string) => {
      mem.delete(key);
    },
    setItem: (key: string, value: string) => {
      mem.set(key, String(value));
    },
  };
  globalThis.sessionStorage = shim;
}
