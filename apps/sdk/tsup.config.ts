import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Both: `import Postra from '@postra/node'` in plain Node ESM got the CJS
  // module object and threw "Postra is not a constructor".
  format: ['cjs', 'esm'],
  // tsup 8 builds the declarations with baseUrl "." unless told otherwise;
  // the path aliases are relative to the repository root, and TypeScript 6
  // only warns about baseUrl here (tsup itself sets it).
  dts: { compilerOptions: { baseUrl: '../..', ignoreDeprecations: '6.0' } },
  minify: true,
  clean: true,
  outDir: 'dist',
});