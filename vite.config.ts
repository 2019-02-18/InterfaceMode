import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Pages deploy: npm run build:pages
  // Outputs dist/ with base /interface-mode-demo/ for GitHub Pages subpath.
  if (mode === 'pages') {
    return {
      base: '/interface-mode-demo/',
      build: {
        outDir: 'dist',
      },
    };
  }

  // Library build: npm run build:lib
  // Outputs dist/lib/im.umd.js and dist/lib/im.es.js for embedding in any website.
  if (mode === 'lib') {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, 'src/framework/embed.ts'),
          name: 'InterfaceMode',
          fileName: 'im',
          formats: ['umd', 'es'],
        },
        outDir: 'dist/lib',
        sourcemap: true,
        rollupOptions: {
          // All dependencies bundled — the UMD file must be self-contained.
          external: [],
        },
      },
    };
  }

  // Default: demo app build / dev server
  return {
    root: '.',
    server: {
      port: 5173,
      open: true,
    },
    build: {
      outDir: 'dist',
    },
  };
});
