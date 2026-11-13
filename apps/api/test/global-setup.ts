import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Applies the Prisma migrations to the test schema once per test run. */
export default async function globalSetup(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./integration-env');
  try {
    execSync('npx prisma migrate deploy', {
      cwd: resolve(__dirname, '..'),
      env: process.env,
      stdio: 'pipe',
    });
  } catch (err) {
    const output = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    throw new Error(
      `Could not prepare the test database (${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':***@')}).\n` +
        `Start it with \`docker compose up -d postgres\`.\n\n${output}`,
    );
  }
}
