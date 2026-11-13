/** Unit tests – no database, no network. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  setupFiles: ['<rootDir>/test/unit-env.ts'],
};
