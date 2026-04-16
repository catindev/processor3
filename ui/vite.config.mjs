import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(process.cwd(), 'ui'),
  build: {
    outDir: path.resolve(process.cwd(), 'ui-dist'),
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: path.resolve(process.cwd(), 'ui/graph.html'),
      output: {
        entryFileNames: 'assets/graph-[hash].js',
        chunkFileNames: 'assets/graph-[hash].js',
        assetFileNames: 'assets/graph-[hash][extname]'
      }
    }
  }
});
