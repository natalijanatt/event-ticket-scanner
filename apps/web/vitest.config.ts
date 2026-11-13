import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: Vitest bundles its own Vite version.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@event-platform/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
