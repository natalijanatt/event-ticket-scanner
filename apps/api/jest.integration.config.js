/** Integration tests – real PostgreSQL (TEST_DATABASE_URL), mocked e-mail, inline queue. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/integration-env.ts'],
  testTimeout: 30000,
};
