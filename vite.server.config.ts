import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'server/hosted/entry.ts',
    outDir: 'dist-server',
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'entry.js' } },
  },
});
