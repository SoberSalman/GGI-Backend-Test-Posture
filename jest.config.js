/**
 * Unit-test configuration. The e2e suite runs against a real Postgres and has
 * its own config at test/jest-e2e.json.
 *
 * Coverage is collected from the domain, application, interface and shared
 * layers. Repositories are excluded here because they are thin TypeORM query
 * wrappers whose behaviour (row locks, `ON CONFLICT`, pagination) is only
 * meaningful against a real database — the e2e suite covers them.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFilesAfterEnv: ['<rootDir>/../test/setup-unit.ts'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!main.ts',
    '!seed.ts',
    '!**/*.module.ts',
    '!**/*.repository.ts',
    '!**/*.scheduler.ts',
    '!**/dto/*.ts',
    '!migrations/**',
    '!config/data-source.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  coverageThreshold: {
    global: { statements: 80, branches: 70, functions: 80, lines: 80 },
  },
};
