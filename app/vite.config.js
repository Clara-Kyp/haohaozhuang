import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'showcase' ? './' : '/',
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('./', import.meta.url)),
        fileURLToPath(new URL('../roomvoice/dist/plan-detection.js', import.meta.url)),
      ],
    },
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
}));
