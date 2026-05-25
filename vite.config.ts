import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two build modes:
 *
 *   - default (`vite build`) → `dist/`:
 *       Chunked output for HTTP hosting at domain root or any sub-path.
 *       Cytoscape sits in its own chunk and lazy-loads via React.lazy, so
 *       the first paint isn't blocked by the graph engine.
 *       Minified with terser (a few % tighter than esbuild's default).
 *
 *   - `vite build --mode singlefile` → `dist-single/index.html`:
 *       Everything inlined into a single file. Double-clickable, mail-able,
 *       USB-portable.
 *
 * Why no `vite-plugin-javascript-obfuscator` in singlefile mode anymore:
 *   The obfuscator's `stringArray` / `stringArrayEncoding` rewrites string
 *   literals into `arr[idx]` lookups. That includes the specifier inside
 *   `React.lazy(() => import('./diagram/DiagramCanvas'))`. After rollup has
 *   already resolved that dynamic import to its inlined chunk reference, the
 *   obfuscator rewrites the call site into `import(ea(211))` where ea(211)
 *   decodes back to the ORIGINAL source string `./diagram/DiagramCanvas`
 *   (not an asset URL). At runtime the browser then tries to fetch that
 *   bare path as a separate module — guaranteed 404 in a single-file HTML.
 *   With `viteSingleFile`'s `inlineDynamicImports: true` there is no second
 *   chunk to fetch in the first place, so dynamic-import callsites are
 *   particularly fragile under any post-rollup transform that touches them.
 *   Terser minification (still on below) is enough deterrent for casual
 *   source-readers.
 *
 * Minification choices:
 *   - terser with `passes: 2` and `pure_funcs` for log-stripping.
 *   - In singlefile mode we additionally drop `console.log/info/debug`
 *     (warn/error kept so genuine failures still surface in the receiver's
 *     devtools).
 *   - Property mangling is OFF — React + cytoscape both rely on reflective
 *     property names (`__reactInternals`, cy.scratch keys, etc.), and
 *     property mangling silently corrupts those.
 */
export default defineConfig(({ mode }) => {
  const isSingle = mode === 'singlefile';

  return {
    plugins: [
      react(),
      ...(isSingle ? [viteSingleFile()] : []),
    ],
    // Emit asset URLs as `./assets/…` (relative) so the build also works
    // under sub-path hosting. Moot in singlefile mode (plugin inlines all).
    base: './',
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: isSingle ? 5000 : 600,
      outDir: isSingle ? 'dist-single' : 'dist',

      // Terser instead of esbuild for an extra 2–5% squeeze. Pulled in via
      // the `terser` dev-dep; vite auto-detects.
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_debugger: true,
          passes: 2,
          // In singlefile mode strip noisy logs so the recipient's devtools
          // stays clean. Keep warn/error in both modes — they're the channel
          // through which actual problems get reported.
          pure_funcs: isSingle
            ? ['console.log', 'console.info', 'console.debug']
            : [],
        },
        format: {
          comments: false,
        },
        // mangle property names: OFF. React + cytoscape break (`__reactInternals`,
        // `n.scratch('_lastLayout')`, etc.) if their property names get touched.
      },

      // singlefile mode delegates rollup output config to viteSingleFile
      // (which sets `inlineDynamicImports: true`, `cssCodeSplit: false`,
      // `assetsInlineLimit: ∞`). Our manualChunks split is only useful for
      // the chunked-deployment scenario.
      rollupOptions: isSingle
        ? undefined
        : {
            output: {
              manualChunks(id) {
                if (id.includes('node_modules')) {
                  if (id.includes('react') || id.includes('scheduler')) {
                    return 'react-vendor';
                  }
                  if (id.includes('cytoscape') || id.includes('dagre')) {
                    return 'cytoscape';
                  }
                }
                return undefined;
              },
            },
          },
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
