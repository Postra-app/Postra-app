export default {
  roots: ['<rootDir>/apps', '<rootDir>/libraries'],
  testMatch: ['**/?(*.)+(spec|test).[tj]s?(x)'],
  // CI runs `pnpm build` before `pnpm test`, so never treat compiled output
  // (.next chunks, dist/) as tests.
  testPathIgnorePatterns: ['/node_modules/', '/\\.next/', '/dist/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testEnvironment: 'node',
  clearMocks: true,
  // Mirror the @gitroom/* path aliases from tsconfig.base.json so specs can
  // import source files that use them.
  moduleNameMapper: {
    '\\.(css|scss|sass)$': '<rootDir>/jest.style-stub.js',
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
  },
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
};
