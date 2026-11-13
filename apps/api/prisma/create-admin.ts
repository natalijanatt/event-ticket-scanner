/**
 * Creates (or promotes) a platform administrator.
 *
 *   npm run create-admin
 *
 * Asks for e-mail, name and password. Values can also be supplied through
 * ADMIN_EMAIL, ADMIN_FIRST_NAME, ADMIN_LAST_NAME and ADMIN_PASSWORD.
 * Runs against the database configured in `.env` (DATABASE_URL).
 */
import '../src/config/load-env';
import { createInterface } from 'node:readline/promises';
import { emailSchema, passwordSchema } from '@event-platform/shared';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label: string, env: string | undefined) => (env ?? (await rl.question(`${label}: `))).trim();

  const email = emailSchema.safeParse(await ask('Email', process.env.ADMIN_EMAIL));
  if (!email.success) throw new Error(email.error.issues[0].message);
  const firstName = (await ask('Ime', process.env.ADMIN_FIRST_NAME)) || 'Admin';
  const lastName = await ask('Prezime', process.env.ADMIN_LAST_NAME);
  const password = passwordSchema.safeParse(await ask('Lozinka (min. 10 znakova, slovo + cifra)', process.env.ADMIN_PASSWORD));
  rl.close();
  if (!password.success) throw new Error(password.error.issues[0].message);

  const passwordHash = await argon2.hash(password.data, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const existing = await prisma.user.findUnique({ where: { email: email.data } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPER_ADMIN', isActive: true, passwordHash, firstName, lastName } });
    await prisma.session.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
    console.log(`\nPostojeći nalog ${email.data} je sada administrator platforme (lozinka je zamenjena).`);
  } else {
    await prisma.user.create({ data: { email: email.data, firstName, lastName, role: 'SUPER_ADMIN', passwordHash } });
    console.log(`\nAdministrator ${email.data} je kreiran.`);
  }
  console.log(`Baza: ${new URL(process.env.DATABASE_URL ?? 'postgresql://unknown').host}`);
}

main()
  .catch((err) => {
    console.error(`\nGreška: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
