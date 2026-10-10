const ESM_PACKAGES =
  '(file-type|strtok3|token-types|peek-readable|uint8array-extras|@tokenizer/inflate|@borewit/text-codec)';

export default {
  roots: ['<rootDir>/apps', '<rootDir>/libraries'],
  testMatch: ['**/?(*.)+(spec|test).[tj]s?(x)'],
  // CI runs `pnpm build` before `pnpm test`, so never treat compiled output
  // (.next chunks, dist/) as tests.
  testPathIgnorePatterns: ['/node_modules/', '/\\.next/', '/dist/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup-dispose.js'],
  clearMocks: true,
  // Mirror the @gitroom/* path aliases from tsconfig.base.json so specs can
  // import source files that use them.
  moduleNameMapper: {
    '\\.(css|scss|sass)$': '<rootDir>/jest.style-stub.js',
    // Jest 29 cannot load jsdom 30 (jest.isomorphic-dompurify.js says why).
    '^isomorphic-dompurify$': '<rootDir>/jest.isomorphic-dompurify.js',
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/react/(.*)$': '<rootDir>/libraries/react-shared-libraries/src/$1',
    '^@gitroom/plugins/(.*)$': '<rootDir>/libraries/plugins/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
    '^@gitroom/extension/(.*)$': '<rootDir>/apps/extension/src/$1',
  },
  // Transpile-only (isolatedModules): compile TS/TSX for tests without full
  // type-checking, so a strict-tsc error in unrelated app code can't break the
  // test run. jsx is set for component tests that opt into the jsdom env.
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: { jsx: 'react-jsx', esModuleInterop: true },
      },
    ],
    // file-type is ESM-only. Node 22 requires it as is; Jest 29 cannot, so
    // it and its ESM dependencies are compiled to CommonJS for the tests.
    [`/node_modules/${ESM_PACKAGES}/.+\\.js$`]: [
      'ts-jest',
      { isolatedModules: true, tsconfig: { allowJs: true, esModuleInterop: true } },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!${ESM_PACKAGES}/)`],
  // Coverage from source only. Restricting to {ts,tsx} already skips compiled
  // .js output, and the explicit negations + ignore patterns keep the reporter
  // away from .next (its sectioned source maps crash the reporter and time the
  // job out) and dist/.
  collectCoverageFrom: [
    'apps/**/*.{ts,tsx}',
    'libraries/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/*.{spec,test}.{ts,tsx}',
    '!**/.next/**',
    '!**/dist/**',
    '!**/node_modules/**',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/\\.next/', '/dist/', '/coverage/'],
  // A ratchet, not a target: the floor sits just under what the suite covers
  // today (2026-10-06: lines 18.3, statements 18.72, functions 11.92, branches
  // 13.78), so deleting tests fails CI. Raise it whenever coverage goes up.
  coverageThreshold: {
    global: { lines: 17, statements: 18, functions: 11, branches: 13 },
  },
};
