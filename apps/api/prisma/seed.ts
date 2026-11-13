/**
 * Development seed – realistic Serbian demo data.
 *
 *   npm run db:seed            → seeds an EMPTY database, refuses otherwise
 *   npm run db:seed -- --reset → wipes all application data first
 *
 * Never runs in production.
 */
import '../src/config/load-env';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type EmailStatus, type Prisma, type ScanResult } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppConfig } from '../src/config/app-config';
import { TicketCryptoService } from '../src/tickets/ticket-crypto.service';

const prisma = new PrismaClient();
const config = new AppConfig();
const crypto = new TicketCryptoService(config);

const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo-lozinka-2026';

const GUESTS: [string, string][] = [
  ['Marko', 'Petrović'], ['Jelena', 'Jovanović'], ['Nikola', 'Nikolić'], ['Ana', 'Marković'], ['Stefan', 'Đorđević'],
  ['Milica', 'Stojanović'], ['Luka', 'Ilić'], ['Teodora', 'Stanković'], ['Aleksandar', 'Pavlović'], ['Katarina', 'Milošević'],
  ['Filip', 'Todorović'], ['Jovana', 'Kostić'], ['Nemanja', 'Živković'], ['Sara', 'Popović'], ['Uroš', 'Radovanović'],
  ['Tijana', 'Lazić'], ['Dušan', 'Simić'], ['Anđela', 'Mitrović'], ['Vuk', 'Ristić'], ['Isidora', 'Tomić'],
  ['Miloš', 'Vasić'], ['Nevena', 'Đukić'], ['Ognjen', 'Savić'], ['Maša', 'Aleksić'], ['Lazar', 'Bogdanović'],
  ['Dunja', 'Krstić'], ['Petar', 'Filipović'], ['Sofija', 'Matić'], ['Andrej', 'Obradović'], ['Emilija', 'Cvetković'],
  ['Bogdan', 'Janković'], ['Lena', 'Vuković'], ['Relja', 'Antić'], ['Iva', 'Milenković'], ['Strahinja', 'Gajić'],
  ['Mina', 'Perić'], ['Vanja', 'Lukić'], ['Tara', 'Babić'],
];

function emailOf([first, last]: [string, string]): string {
  const ascii = (s: string) =>
    s.toLowerCase().replace(/đ/g, 'dj').replace(/š/g, 's').replace(/č|ć/g, 'c').replace(/ž/g, 'z');
  return `${ascii(first)}.${ascii(last)}@example.com`;
}

/** 23:00 on 21 Nov 2026 in Belgrade (CET, UTC+1). */
const FRIDAY_NIGHT = new Date('2026-11-21T22:00:00.000Z');

async function wipe(): Promise<void> {
  await prisma.scanLog.deleteMany();
  await prisma.emailDelivery.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.eventGuest.deleteMany();
  await prisma.guest.deleteMany();
  await prisma.ticketType.deleteMany();
  await prisma.eventStaff.deleteMany();
  await prisma.event.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizerMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organizer.deleteMany();
}

function ticketRow(eventId: string, guestId: string, eventGuestId: string, ticketTypeId: string, extra: Partial<Prisma.TicketCreateManyInput> = {}): Prisma.TicketCreateManyInput {
  const id = randomUUID();
  const credentials = crypto.createCredentials(id);
  return {
    id,
    eventId,
    guestId,
    eventGuestId,
    ticketTypeId,
    reference: crypto.createReference(),
    tokenHash: credentials.tokenHash,
    tokenCipher: credentials.tokenCipher,
    ...extra,
  };
}

function delivery(
  eventId: string,
  eventGuestId: string,
  toEmail: string,
  subject: string,
  status: EmailStatus,
  ticketCount: number,
  createdById: string,
  queuedAt: Date,
): Prisma.EmailDeliveryCreateManyInput {
  const sentAt = ['SENT', 'DELIVERED', 'BOUNCED'].includes(status) ? new Date(queuedAt.getTime() + 4_000) : null;
  return {
    id: randomUUID(),
    eventId,
    eventGuestId,
    toEmail,
    subject,
    status,
    kind: 'INVITATION',
    idempotencyKey: `seed-${randomUUID()}`,
    providerMessageId: sentAt ? `seed_${randomUUID()}` : null,
    attempts: status === 'QUEUED' ? 0 : status === 'FAILED' ? 6 : 1,
    lastError:
      status === 'BOUNCED'
        ? 'Server primaoca je odbio poruku. Proveri email adresu.'
        : status === 'FAILED'
          ? 'Servis za slanje je odbio poruku (validation_error).'
          : null,
    ticketCount,
    createdById,
    queuedAt,
    sentAt,
    deliveredAt: status === 'DELIVERED' ? new Date(queuedAt.getTime() + 9_000) : null,
    bouncedAt: status === 'BOUNCED' ? new Date(queuedAt.getTime() + 12_000) : null,
    failedAt: status === 'FAILED' ? new Date(queuedAt.getTime() + 160_000) : null,
  };
}

async function main(): Promise<void> {
  if (config.isProduction) throw new Error('The seed script must not run in production.');

  const reset = process.argv.includes('--reset');
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !reset) {
    console.log('Database already contains data – seed skipped. Use `npm run db:seed -- --reset` to wipe and reseed.');
    return;
  }
  if (reset) await wipe();

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  // ── Organizers & users ────────────────────────────────────────────────────
  const central = await prisma.organizer.create({ data: { name: 'Club Central', contactEmail: 'info@clubcentral.example', retentionDays: 365 } });
  const horizont = await prisma.organizer.create({ data: { name: 'Splav Horizont', contactEmail: 'kontakt@horizont.example', retentionDays: 180 } });

  const user = (email: string, firstName: string, lastName: string, role: 'SUPER_ADMIN' | 'ORGANIZER' | 'SCANNER') =>
    prisma.user.create({ data: { email, firstName, lastName, role, passwordHash } });

  await user('admin@ulaznice.example', 'Vesna', 'Admin', 'SUPER_ADMIN');
  const marko = await user('marko@clubcentral.example', 'Marko', 'Petrović', 'ORGANIZER');
  const jelena = await user('jelena@horizont.example', 'Jelena', 'Ilić', 'ORGANIZER');
  const nikola = await user('nikola@clubcentral.example', 'Nikola', 'Stanković', 'SCANNER');
  const ana = await user('ana@clubcentral.example', 'Ana', 'Kovač', 'SCANNER');
  const dejan = await user('dejan@horizont.example', 'Dejan', 'Mirić', 'SCANNER');

  await prisma.organizerMembership.createMany({
    data: [
      { organizerId: central.id, userId: marko.id, role: 'OWNER' },
      { organizerId: horizont.id, userId: jelena.id, role: 'OWNER' },
      { organizerId: central.id, userId: nikola.id, role: 'SCANNER' },
      { organizerId: central.id, userId: ana.id, role: 'SCANNER' },
      { organizerId: horizont.id, userId: dejan.id, role: 'SCANNER' },
    ],
  });

  // ── Event 1: Friday Night Party (upcoming, invitations in mixed states) ───
  const friday = await prisma.event.create({
    data: {
      organizerId: central.id,
      name: 'Friday Night Party',
      description: 'Najveća žurka meseca u Club Central. Rezidenti kluba i specijalni gost iznenađenja. Ulaz isključivo uz pozivnicu.',
      startsAt: FRIDAY_NIGHT,
      endsAt: new Date(FRIDAY_NIGHT.getTime() + 6 * 3_600_000),
      venueName: 'Club Central',
      venueAddress: 'Karađorđeva 12, Beograd',
      status: 'ACTIVE',
      capacity: 400,
    },
  });
  const fridayRegular = await prisma.ticketType.create({ data: { eventId: friday.id, name: 'Regular', color: '#5B6577', sortOrder: 0, description: 'Standardni ulaz' } });
  const fridayVip = await prisma.ticketType.create({
    data: { eventId: friday.id, name: 'VIP', color: '#B8862B', sortOrder: 1, capacity: 60, description: 'VIP zona i separe', instructions: 'VIP ulaz je sa leve strane glavnog ulaza. Ponesi ličnu kartu.' },
  });

  // ── Event 2: Warm Up Thursday (in progress → live check-in history) ───────
  const warmup = await prisma.event.create({
    data: {
      organizerId: central.id,
      name: 'Warm Up četvrtak',
      description: 'Zagrevanje pred vikend uz domaće house izvođače.',
      startsAt: hoursAgo(3),
      endsAt: new Date(now.getTime() + 5 * 3_600_000),
      venueName: 'Club Central',
      venueAddress: 'Karađorđeva 12, Beograd',
      status: 'ACTIVE',
      capacity: 120,
      enforceCapacity: true,
    },
  });
  const warmRegular = await prisma.ticketType.create({ data: { eventId: warmup.id, name: 'Regular', color: '#5B6577', sortOrder: 0 } });
  const warmVip = await prisma.ticketType.create({ data: { eventId: warmup.id, name: 'VIP', color: '#B8862B', sortOrder: 1, instructions: 'Narukvicu preuzmi na VIP pultu.' } });
  const warmBackstage = await prisma.ticketType.create({ data: { eventId: warmup.id, name: 'Backstage', color: '#3D6B8E', sortOrder: 2, capacity: 10 } });

  // ── Event 3: other organizer (proves tenant isolation in the demo) ────────
  const splav = await prisma.event.create({
    data: {
      organizerId: horizont.id,
      name: 'Zimsko otvaranje',
      description: 'Otvaranje zimske sezone na Splavu Horizont.',
      startsAt: new Date('2026-12-05T21:00:00.000Z'),
      venueName: 'Splav Horizont',
      venueAddress: 'Ušće bb, Novi Beograd',
      status: 'DRAFT',
    },
  });
  const splavRegular = await prisma.ticketType.create({ data: { eventId: splav.id, name: 'Regular', color: '#5B6577', sortOrder: 0 } });
  await prisma.ticketType.create({ data: { eventId: splav.id, name: 'VIP', color: '#B8862B', sortOrder: 1 } });

  await prisma.eventStaff.createMany({
    data: [
      { eventId: friday.id, userId: nikola.id },
      { eventId: friday.id, userId: ana.id },
      { eventId: warmup.id, userId: nikola.id },
      { eventId: splav.id, userId: dejan.id },
    ],
  });

  // ── Guests ────────────────────────────────────────────────────────────────
  const centralGuests = await Promise.all(
    GUESTS.map((g, i) =>
      prisma.guest.create({
        data: { organizerId: central.id, firstName: g[0], lastName: g[1], email: emailOf(g), phone: i % 3 === 0 ? `+381 6${i % 5} ${String(1000000 + i * 73129).slice(0, 7)}` : null },
      }),
    ),
  );
  // Same people, same e-mails – but a completely separate record for the other organizer.
  const horizontGuests = await Promise.all(
    GUESTS.slice(0, 6).map((g) => prisma.guest.create({ data: { organizerId: horizont.id, firstName: g[0], lastName: g[1], email: emailOf(g) } })),
  );
  await prisma.eventGuest.createMany({
    data: horizontGuests.map((g, i) => ({ eventId: splav.id, guestId: g.id, ticketTypeId: splavRegular.id, ticketQuantity: i === 0 ? 2 : 1 })),
  });

  const tickets: Prisma.TicketCreateManyInput[] = [];
  const deliveries: Prisma.EmailDeliveryCreateManyInput[] = [];
  const scanLogs: Prisma.ScanLogCreateManyInput[] = [];

  // Friday Night Party: 34 guests
  const fridaySubject = 'Pozivnica za Friday Night Party – 21. novembar';
  for (const [i, guest] of centralGuests.slice(0, 34).entries()) {
    const vip = i % 6 === 0;
    const quantity = i === 1 ? 4 : i % 7 === 3 ? 2 : 1;
    const eg = await prisma.eventGuest.create({
      data: {
        eventId: friday.id,
        guestId: guest.id,
        ticketTypeId: vip ? fridayVip.id : fridayRegular.id,
        ticketQuantity: quantity,
        notes: i === 0 ? 'Vlasnikov prijatelj — separe 3.' : i === 9 ? 'Dolazi posle ponoći.' : null,
      },
    });
    // 0–21 invited, 22–25 queued/failed states, 26–33 not yet invited (6 of them without tickets)
    let status: EmailStatus | null = null;
    if (i < 16) status = 'DELIVERED';
    else if (i < 20) status = 'SENT';
    else if (i === 20) status = 'BOUNCED';
    else if (i === 21) status = 'FAILED';
    else if (i < 24) status = 'QUEUED';
    const hasTickets = i < 28;
    if (hasTickets) {
      for (let n = 0; n < quantity; n++) {
        const revoked = i === 12 || (i === 1 && n === 3);
        tickets.push(ticketRow(friday.id, guest.id, eg.id, eg.ticketTypeId, revoked ? { status: 'REVOKED', revokedAt: hoursAgo(20) } : {}));
      }
    }
    if (status) deliveries.push(delivery(friday.id, eg.id, guest.email, fridaySubject, status, quantity, marko.id, hoursAgo(26 - i * 0.2)));
  }

  // Warm Up: 30 guests, most already inside
  const warmSubject = 'Pozivnica za Warm Up četvrtak';
  let checkedIn = 0;
  for (const [i, guest] of centralGuests.slice(4, 34).entries()) {
    const typeId = i % 9 === 0 ? warmBackstage.id : i % 4 === 0 ? warmVip.id : warmRegular.id;
    const quantity = i % 8 === 2 ? 2 : 1;
    const eg = await prisma.eventGuest.create({ data: { eventId: warmup.id, guestId: guest.id, ticketTypeId: typeId, ticketQuantity: quantity } });
    deliveries.push(delivery(warmup.id, eg.id, guest.email, warmSubject, i === 27 ? 'BOUNCED' : 'DELIVERED', quantity, marko.id, hoursAgo(50 - i * 0.3)));
    for (let n = 0; n < quantity; n++) {
      if (i === 5) {
        tickets.push(ticketRow(warmup.id, guest.id, eg.id, typeId, { status: 'REVOKED', revokedAt: hoursAgo(30) }));
        continue;
      }
      const arrived = i < 21 && !(quantity === 2 && n === 1 && i > 10);
      if (!arrived) {
        tickets.push(ticketRow(warmup.id, guest.id, eg.id, typeId));
        continue;
      }
      // Arrivals spread over the last ~2.7 hours, denser around the first hour.
      const usedAt = new Date(now.getTime() - (2.7 - (checkedIn / 24) * 2.6) * 3_600_000 + ((i * 37) % 9) * 60_000);
      const scanner = checkedIn % 3 === 0 ? ana.id : nikola.id;
      const row = ticketRow(warmup.id, guest.id, eg.id, typeId, { status: 'USED', usedAt, scannedById: scanner });
      tickets.push(row);
      scanLogs.push({ eventId: warmup.id, ticketId: row.id as string, scannerId: scanner, result: 'ADMITTED', method: i === 14 ? 'MANUAL' : 'QR', createdAt: usedAt });
      // A few guests tried to reuse a ticket.
      if (checkedIn % 7 === 3) {
        scanLogs.push({ eventId: warmup.id, ticketId: row.id as string, scannerId: nikola.id, result: 'ALREADY_USED', method: 'QR', createdAt: new Date(usedAt.getTime() + 95_000) });
      }
      checkedIn++;
    }
  }
  const rejected: [ScanResult, string, number][] = [
    ['INVALID', 'malformed-code', 2.1],
    ['INVALID', 'malformed-code', 1.4],
    ['WRONG_EVENT', '', 0.9],
  ];
  for (const [result, reason, h] of rejected) {
    scanLogs.push({ eventId: warmup.id, scannerId: nikola.id, result, method: 'QR', reason: reason || null, createdAt: hoursAgo(h) });
  }

  await prisma.ticket.createMany({ data: tickets });
  await prisma.emailDelivery.createMany({ data: deliveries });
  await prisma.scanLog.createMany({ data: scanLogs });
  // Keep the denormalized counter consistent with the seeded check-ins.
  await prisma.event.update({ where: { id: warmup.id }, data: { checkedInCount: checkedIn } });

  // One real, openable ticket link for trying the guest page and the scanner.
  const sample = await prisma.ticket.findFirstOrThrow({ where: { eventId: warmup.id, status: 'VALID' }, orderBy: { createdAt: 'asc' } });
  const sampleUrl = crypto.ticketUrl(crypto.decrypt(sample.tokenCipher, sample.id));

  console.log('\nSeed complete.\n');
  console.log(`  Guests: ${centralGuests.length + horizontGuests.length} · tickets: ${tickets.length} · check-ins: ${checkedIn}\n`);
  console.log('  Demo accounts (password for all: ' + PASSWORD + ')');
  console.log('    admin@ulaznice.example        Administrator platforme');
  console.log('    marko@clubcentral.example     Organizator  – Club Central');
  console.log('    jelena@horizont.example       Organizator  – Splav Horizont');
  console.log('    nikola@clubcentral.example    Osoblje na ulazu (oba Club Central događaja)');
  console.log('    ana@clubcentral.example       Osoblje na ulazu (samo Friday Night Party)');
  console.log(`\n  Sample valid ticket for "Warm Up četvrtak":\n    ${sampleUrl}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
