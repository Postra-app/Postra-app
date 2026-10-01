import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// eslint-config-next 16 ships native flat config (it needs ESLint 9); the
// FlatCompat wrapper this file used before crashed on load, so lint never ran.
const eslintConfig = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.results/**',
      'reports/**',
      'var/**',
      '**/next-env.d.ts',
      // Third-party bundles served as-is.
      'apps/frontend/public/**',
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    // CommonJS config files can only require().
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // These rules check code is ready for the React Compiler, which this app
    // does not use. They stay visible as warnings; rules-of-hooks and the
    // rest of the recommended set stay errors.
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    rules: {
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/globals': 'warn',
    },
  },
  {
    // apps/frontend is the only Next app; without this the Next plugin looks
    // for a pages/ directory at the repo root on every file.
    settings: { next: { rootDir: 'apps/frontend/' } },
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react/display-name': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    },
  },
];

export default eslintConfig;
