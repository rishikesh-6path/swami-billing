import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// Strict CSP only in built output. Dev needs inline scripts and a websocket for HMR.
const productionCsp: Plugin = {
  name: 'shopledger-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'",
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  main: {
    build: {
      // core is TypeScript source consumed directly, so it must be bundled, not externalized;
      // zod is bundled too, so the installed app needs no node_modules at all
      externalizeDeps: { exclude: ['@shopledger/core', 'zod'] },
    },
  },
  preload: {
    build: {
      // a sandboxed preload cannot require node_modules, so bundle what it imports (zod)
      externalizeDeps: { exclude: ['zod'] },
      // sandboxed preload scripts cannot be ES modules
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
    plugins: [react(), productionCsp],
  },
});
