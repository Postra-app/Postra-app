import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Both: `import Postra from '@postra/node'` in plain Node ESM got the CJS
  // module object and threw "Postra is not a constructor" (E2E-08-55).
  format: ['cjs', 'esm'],
  dts: true,
  minify: true,
  clean: true,
  outDir: 'dist',
});