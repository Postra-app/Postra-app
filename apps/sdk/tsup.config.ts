import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Both: `import Postra from '@postra/node'` in plain Node ESM got the CJS
  // module object and threw "Postra is not a constructor".
  format: ['cjs', 'esm'],
  // The declaration bundle inlines the DTOs it imports through the
  // @gitroom/* path aliases, which are relative to the repository root.
  // Without a baseUrl there it leaves those imports in index.d.ts and the
  // published types break (package.spec.ts: README example in strict TS);
  // tsup 9 stopped injecting its own baseUrl ".", tsup 8 needed this
  // override to replace it. TypeScript 6 only warns about baseUrl here.
  dts: { compilerOptions: { baseUrl: '../..', ignoreDeprecations: '6.0' } },
  minify: true,
  clean: true,
  outDir: 'dist',
});