import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { PasswordService } from '../src/auth/password.service';
import { EMAIL_PROVIDER } from '../src/email/email.types';
import { MockEmailProvider } from '../src/email/mock.provider';
import { signWebhook } from '../src/invitations/webhook-signature';
import { PrismaService } from '../src/prisma/prisma.service';

// Integration tests: real NestJS app + real PostgreSQL (TEST_DATABASE_URL),
// mocked e-mail provider, inline queue. They cover the product's critical
// workflows end to end through the HTTP API.

const PASSWORD = 'Test-lozinka-2026';
const CSRF = { 'x-csrf-protection': '1' };

let app: NestExpressApplication;
let prisma: PrismaService;
let mail: MockEmailProvider;

let organizerA: TestAgent;
let organizerB: TestAgent;
let scanner: TestAgent;
let scanner2: TestAgent;
let unassignedScanner: TestAgent;

let orgAId: string;
let orgBId: string;
let scannerId: string;
let scanner2Id: string;

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

async function login(email: string): Promise<TestAgent> {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/login').set(CSRF).send({ email, password: PASSWORD }).expect(200);
  return agent;
}

const post = (agent: TestAgent, url: string, body: object = {}) => agent.post(url).set(CSRF).send(body);

/** Creates an ACTIVE event that started an hour ago, with the default Regular/VIP types. */
async function createEvent(agent: TestAgent, overrides: Record<string, unknown> = {}) {
  const res = await post(agent, '/api/events', {
    name: `Test žurka ${randomUUID().slice(0, 6)}`,
    startsAt: new Date(Date.now() - 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    venueName: 'Club Central',
    status: 'ACTIVE',
    ...overrides,
  }).expect(201);
  const types = (await agent.get(`/api/events/${res.body.id}/ticket-types`).expect(200)).body as { id: string; name: string }[];
  return { id: res.body.id as string, regular: types.find((t) => t.name === 'Regular')!.id, vip: types.find((t) => t.name === 'VIP')!.id };
}

async function addGuest(agent: TestAgent, eventId: string, ticketTypeId: string, overrides: Record<string, unknown> = {}) {
  const email = `gost-${randomUUID().slice(0, 8)}@example.com`;
  const res = await post(agent, `/api/events/${eventId}/guests`, { firstName: 'Marko', lastName: 'Petrović', email, ticketTypeId, ticketQuantity: 1, ...overrides }).expect(201);
  return { id: res.body.guest.id as string, email: (overrides.email as string) ?? email, body: res.body };
}

/** Adds a guest with generated tickets and returns the plaintext ticket URLs (as the guest would get them). */
async function guestWithTickets(agent: TestAgent, eventId: string, ticketTypeId: string, quantity = 1) {
  const guest = await addGuest(agent, eventId, ticketTypeId, { ticketQuantity: quantity, generateTickets: true });
  const tickets = (await agent.get(`/api/events/${eventId}/tickets?search=${encodeURIComponent(guest.email)}`).expect(200)).body.items as { id: string; reference: string }[];
  const urls: string[] = [];
  for (const t of tickets) urls.push((await agent.get(`/api/events/${eventId}/tickets/${t.id}/link`).expect(200)).body.url);
  return { guest, tickets, urls };
}

const scan = (agent: TestAgent, eventId: string, token: string) => post(agent, `/api/scanner/events/${eventId}/check-in`, { token });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  setupApp(app);
  await app.init();

  prisma = app.get(PrismaService);
  mail = app.get(EMAIL_PROVIDER);
  await wipe();

  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  const orgA = await prisma.organizer.create({ data: { name: 'Organizator A' } });
  const orgB = await prisma.organizer.create({ data: { name: 'Organizator B' } });
  orgAId = orgA.id;
  orgBId = orgB.id;

  const user = (email: string, role: 'ORGANIZER' | 'SCANNER', organizerId: string) =>
    prisma.user.create({
      data: {
        email,
        role,
        firstName: 'Test',
        lastName: email.split('@')[0],
        passwordHash,
        memberships: { create: { organizerId, role: role === 'SCANNER' ? 'SCANNER' : 'OWNER' } },
      },
    });
  await user('a@test.example', 'ORGANIZER', orgA.id);
  await user('b@test.example', 'ORGANIZER', orgB.id);
  scannerId = (await user('scanner@test.example', 'SCANNER', orgA.id)).id;
  scanner2Id = (await user('scanner2@test.example', 'SCANNER', orgA.id)).id;
  await user('unassigned@test.example', 'SCANNER', orgA.id);

  organizerA = await login('a@test.example');
  organizerB = await login('b@test.example');
  scanner = await login('scanner@test.example');
  scanner2 = await login('scanner2@test.example');
  unassignedScanner = await login('unassigned@test.example');
}, 60_000);

afterAll(async () => {
  await wipe();
  await app.close();
});

/** Assigns both test scanners to an event. */
async function staff(eventId: string): Promise<void> {
  await organizerA.put(`/api/events/${eventId}/staff`).set(CSRF).send({ userIds: [scannerId, scanner2Id] }).expect(200);
}

describe('authentication & request hardening', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/api/events').expect(401);
  });

  it('answers a wrong password and an unknown account identically', async () => {
    const wrong = await request(app.getHttpServer()).post('/api/auth/login').set(CSRF).send({ email: 'a@test.example', password: 'pogresna-lozinka-1' });
    const unknown = await request(app.getHttpServer()).post('/api/auth/login').set(CSRF).send({ email: 'nema@test.example', password: 'pogresna-lozinka-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('sets HTTP-only cookies and never returns a token in the body', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').set(CSRF).send({ email: 'a@test.example', password: PASSWORD }).expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  it('rejects state-changing requests without the CSRF header or from a foreign origin', async () => {
    await organizerA.post('/api/events').send({}).expect(403);
    await organizerA.post('/api/events').set(CSRF).set('Origin', 'https://evil.example').send({}).expect(403);
  });

  it('rotates the refresh token and revokes the session family when an old one is replayed', async () => {
    const agent = request.agent(app.getHttpServer());
    const loginRes = await agent.post('/api/auth/login').set(CSRF).send({ email: 'b@test.example', password: PASSWORD }).expect(200);
    const oldRefresh = (loginRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('ep_rt='))!.split(';')[0];

    await agent.post('/api/auth/refresh').set(CSRF).expect(200);
    await agent.get('/api/auth/me').expect(200);

    // Make the earlier rotation look old, then replay the stolen token.
    await prisma.session.updateMany({ where: { rotatedAt: { not: null } }, data: { rotatedAt: new Date(Date.now() - 120_000) } });
    await request(app.getHttpServer()).post('/api/auth/refresh').set(CSRF).set('Cookie', oldRefresh).expect(401);
    await agent.get('/api/auth/me').expect(401);
  });

  it('invalidates the session on logout', async () => {
    const agent = await login('b@test.example');
    await agent.get('/api/auth/me').expect(200);
    await post(agent, '/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('resets a password with a single-use token and ends existing sessions', async () => {
    await prisma.user.create({ data: { email: 'reset@test.example', role: 'ORGANIZER', firstName: 'Reset', lastName: 'Test', passwordHash: await app.get(PasswordService).hash(PASSWORD) } });
    const session = await login('reset@test.example');
    mail.clear();

    // Unknown address: same response, no e-mail.
    await request(app.getHttpServer()).post('/api/auth/forgot-password').set(CSRF).send({ email: 'nepostojeci@test.example' }).expect(200);
    expect(mail.list()).toHaveLength(0);

    await request(app.getHttpServer()).post('/api/auth/forgot-password').set(CSRF).send({ email: 'reset@test.example' }).expect(200);
    const message = mail.get(mail.list()[0].id)!;
    const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(message.html)![1];

    await request(app.getHttpServer()).post('/api/auth/reset-password').set(CSRF).send({ token, password: 'Nova-lozinka-2027' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/reset-password').set(CSRF).send({ token, password: 'Druga-lozinka-2028' }).expect(400);
    await session.get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').set(CSRF).send({ email: 'reset@test.example', password: 'Nova-lozinka-2027' }).expect(200);
  });
});

describe('event creation & tenant isolation', () => {
  it('creates an event with default ticket types', async () => {
    const res = await post(organizerA, '/api/events', {
      name: 'Friday Night Party',
      startsAt: '2026-11-21T22:00:00.000Z',
      venueName: 'Club Central',
      capacity: 300,
    }).expect(201);
    expect(res.body).toMatchObject({ name: 'Friday Night Party', status: 'DRAFT', organizerId: orgAId, capacity: 300 });
    const types = await organizerA.get(`/api/events/${res.body.id}/ticket-types`).expect(200);
    expect(types.body.map((t: { name: string }) => t.name)).toEqual(['Regular', 'VIP']);
  });

  it('validates input with Serbian field messages', async () => {
    const res = await post(organizerA, '/api/events', { name: '', startsAt: 'juče', venueName: 'X' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.fieldErrors.name).toMatch(/obavezno/);
  });

  it("hides another organizer's event, guests, tickets and stats behind 404", async () => {
    const event = await createEvent(organizerA);
    const { tickets } = await guestWithTickets(organizerA, event.id, event.regular);

    await organizerB.get(`/api/events/${event.id}`).expect(404);
    await organizerB.get(`/api/events/${event.id}/guests`).expect(404);
    await organizerB.get(`/api/events/${event.id}/tickets`).expect(404);
    await organizerB.get(`/api/events/${event.id}/stats`).expect(404);
    await organizerB.get(`/api/events/${event.id}/tickets/${tickets[0].id}/link`).expect(404);
    await post(organizerB, `/api/events/${event.id}/tickets/revoke`, { ticketIds: [tickets[0].id] }).expect(404);
    await organizerB.patch(`/api/events/${event.id}`).set(CSRF).send({ name: 'Preoteto' }).expect(404);

    const listB = await organizerB.get('/api/events').expect(200);
    expect(listB.body.find((e: { id: string }) => e.id === event.id)).toBeUndefined();
  });

  it("cannot reach another organizer's ticket through its own event", async () => {
    const eventA = await createEvent(organizerA);
    const { tickets } = await guestWithTickets(organizerA, eventA.id, eventA.regular);
    const eventB = await createEvent(organizerB);
    // Valid event of B + ticket id of A → ticket is not found / not touched.
    await organizerB.get(`/api/events/${eventB.id}/tickets/${tickets[0].id}/link`).expect(404);
    const revoked = await post(organizerB, `/api/events/${eventB.id}/tickets/revoke`, { ticketIds: [tickets[0].id] }).expect(200);
    expect(revoked.body.revoked).toBe(0);
  });

  it('keeps scanners out of administration entirely', async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    await scanner.get(`/api/events/${event.id}/guests`).expect(403);
    await post(scanner, `/api/events/${event.id}/guests/export`).expect(403);
    await post(scanner, `/api/events/${event.id}/invitations/send`, {}).expect(403);
    await scanner.get('/api/events').expect(403);
    await scanner.get('/api/staff').expect(403);
  });
});

describe('guest management', () => {
  it('adds, edits and lists guests; counts guests and tickets separately', async () => {
    const event = await createEvent(organizerA);
    const guest = await addGuest(organizerA, event.id, event.vip, { ticketQuantity: 3, generateTickets: true });
    expect(guest.body.ticketsGenerated).toBe(3);

    const list = await organizerA.get(`/api/events/${event.id}/guests`).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ ticketQuantity: 3, tickets: { valid: 3, used: 0, revoked: 0 }, emailStatus: 'NOT_SENT', ticketState: 'VALID' });

    const stats = await organizerA.get(`/api/events/${event.id}/stats`).expect(200);
    expect(stats.body.guests.total).toBe(1);
    expect(stats.body.tickets.generated).toBe(3);

    // Quantity cannot drop below already issued tickets.
    const tooLow = await organizerA.patch(`/api/events/${event.id}/guests/${guest.id}`).set(CSRF).send({ ticketQuantity: 2 }).expect(400);
    expect(tooLow.body.fieldErrors.ticketQuantity).toBeDefined();
    await organizerA.patch(`/api/events/${event.id}/guests/${guest.id}`).set(CSRF).send({ firstName: 'Jelena', ticketQuantity: 4 }).expect(200);
  });

  it('refuses the same e-mail twice on one event but allows it on another event', async () => {
    const event1 = await createEvent(organizerA);
    const event2 = await createEvent(organizerA);
    const email = `dupli-${randomUUID().slice(0, 6)}@example.com`;
    await addGuest(organizerA, event1.id, event1.regular, { email });
    const dup = await post(organizerA, `/api/events/${event1.id}/guests`, { firstName: 'Marko', email, ticketTypeId: event1.regular }).expect(409);
    expect(dup.body.code).toBe('GUEST_EXISTS');
    await addGuest(organizerA, event2.id, event2.regular, { email });
    // One contact record for the organizer, two event invitations.
    expect(await prisma.guest.count({ where: { organizerId: orgAId, email } })).toBe(1);
  });

  it('keeps guests of two organizers with the same e-mail fully separate', async () => {
    const eventA = await createEvent(organizerA);
    const eventB = await createEvent(organizerB);
    const email = `zajednicki-${randomUUID().slice(0, 6)}@example.com`;
    await addGuest(organizerA, eventA.id, eventA.regular, { email, firstName: 'Kod A' });
    await addGuest(organizerB, eventB.id, eventB.regular, { email, firstName: 'Kod B' });
    const rows = await prisma.guest.findMany({ where: { email }, orderBy: { firstName: 'asc' } });
    expect(rows.map((g) => [g.organizerId, g.firstName])).toEqual([
      [orgAId, 'Kod A'],
      [orgBId, 'Kod B'],
    ]);
  });

  it('imports a CSV, reporting duplicates and invalid rows without importing them', async () => {
    const event = await createEvent(organizerA);
    const existing = await addGuest(organizerA, event.id, event.regular);
    const csv = [
      'Ime;Prezime;Email;Tip karte;Broj karata',
      'Ana;Marković;ana.import@example.com;VIP;2',
      'Luka;Ilić;luka.import@example.com;;',
      'Ana;Duplikat;ANA.IMPORT@example.com;;1',
      `Stari;Gost;${existing.email};;1`,
      'Bez;Mejla;;;1',
      'Loš;Tip;los.tip@example.com;Platinum;1',
      '=HYPERLINK("http://x");Formula;formula@example.com;;1',
    ].join('\n');

    const dry = await organizerA.post(`/api/events/${event.id}/guests/import?dryRun=true`).set(CSRF).attach('file', Buffer.from(csv, 'utf8'), 'gosti.csv').expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, totalRows: 7, validRows: 3, created: 0 });
    expect(dry.body.rows.map((r: { status: string }) => r.status)).toEqual(['OK', 'OK', 'DUPLICATE_IN_FILE', 'ALREADY_ON_EVENT', 'INVALID', 'INVALID', 'OK']);
    expect((await organizerA.get(`/api/events/${event.id}/guests`)).body.total).toBe(1);

    const real = await organizerA.post(`/api/events/${event.id}/guests/import?dryRun=false`).set(CSRF).attach('file', Buffer.from(csv, 'utf8'), 'gosti.csv').expect(200);
    expect(real.body.created).toBe(3);
    const list = await organizerA.get(`/api/events/${event.id}/guests?search=ana.import`).expect(200);
    expect(list.body.items[0]).toMatchObject({ ticketQuantity: 2, ticketType: { name: 'VIP' } });

    // The formula-looking name is stored as text and neutralized on export.
    const exported = await post(organizerA, `/api/events/${event.id}/guests/export`).expect(200);
    expect(exported.headers['content-type']).toMatch(/text\/csv/);
    expect(exported.text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe('invitation sending', () => {
  beforeEach(() => mail.clear());

  it('creates tickets, sends one personalized e-mail and tracks the real delivery lifecycle', async () => {
    const event = await createEvent(organizerA);
    const guest = await addGuest(organizerA, event.id, event.regular, { ticketQuantity: 2 });

    const sent = await post(organizerA, `/api/events/${event.id}/invitations/send`, { eventGuestIds: [guest.id], requestId: randomUUID(), mode: 'SEND' }).expect(200);
    expect(sent.body).toMatchObject({ queued: 1, ticketsGenerated: 2 });

    const inbox = mail.list();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].to).toBe(guest.email);
    expect(inbox[0].subject).toMatch(/^Pozivnica za Test žurka/);
    const links = mail.get(inbox[0].id)!.html.match(/https:\/\/tickets\.example\.com\/t\/[A-Za-z0-9_-]{43}/g)!;
    expect(new Set(links).size).toBe(2); // one link per ticket

    // Accepted by the provider ≠ delivered.
    let row = (await organizerA.get(`/api/events/${event.id}/guests`)).body.items[0];
    expect(row.emailStatus).toBe('SENT');

    mail.flushSimulatedEvents();
    await new Promise((r) => setTimeout(r, 150));
    row = (await organizerA.get(`/api/events/${event.id}/guests`)).body.items[0];
    expect(row.emailStatus).toBe('DELIVERED');
  });

  it('is idempotent: replaying the same request or re-clicking "send" never duplicates', async () => {
    const event = await createEvent(organizerA);
    const guest = await addGuest(organizerA, event.id, event.regular);
    const requestId = randomUUID();
    const body = { eventGuestIds: [guest.id], requestId, mode: 'SEND' };

    // Two identical requests racing each other (double click / network retry).
    const [first, second] = await Promise.all([
      post(organizerA, `/api/events/${event.id}/invitations/send`, body),
      post(organizerA, `/api/events/${event.id}/invitations/send`, body),
    ]);
    expect(first.body.queued + second.body.queued).toBe(1);

    // A later plain "send" with a new request id skips the already invited guest.
    const again = await post(organizerA, `/api/events/${event.id}/invitations/send`, { ...body, requestId: randomUUID() }).expect(200);
    expect(again.body).toMatchObject({ queued: 0, skippedAlreadySent: 1 });

    expect(mail.list()).toHaveLength(1);
    expect(await prisma.emailDelivery.count({ where: { eventGuestId: guest.id } })).toBe(1);
    expect(await prisma.ticket.count({ where: { eventGuestId: guest.id } })).toBe(1);
  });

  it('re-sends the SAME tickets – a resend never creates new ones', async () => {
    const event = await createEvent(organizerA);
    const guest = await addGuest(organizerA, event.id, event.regular, { ticketQuantity: 2 });
    await post(organizerA, `/api/events/${event.id}/invitations/send`, { eventGuestIds: [guest.id], requestId: randomUUID(), mode: 'SEND' }).expect(200);
    const firstLinks = mail.get(mail.list()[0].id)!.html.match(/\/t\/[A-Za-z0-9_-]{43}/g)!.sort();
    mail.clear();

    const resend = await post(organizerA, `/api/events/${event.id}/invitations/send`, { eventGuestIds: [guest.id], requestId: randomUUID(), mode: 'RESEND' }).expect(200);
    expect(resend.body).toMatchObject({ queued: 1, ticketsGenerated: 0 });
    const secondLinks = mail.get(mail.list()[0].id)!.html.match(/\/t\/[A-Za-z0-9_-]{43}/g)!.sort();

    expect(secondLinks).toEqual(firstLinks);
    expect(await prisma.ticket.count({ where: { eventGuestId: guest.id } })).toBe(2);
    expect(await prisma.emailDelivery.count({ where: { eventGuestId: guest.id } })).toBe(2);
  });

  it('records a failed send with a reason, and retries transient provider errors', async () => {
    const event = await createEvent(organizerA);
    const failing = await addGuest(organizerA, event.id, event.regular, { email: `x-${randomUUID().slice(0, 6)}@fail.test` });
    const flaky = await addGuest(organizerA, event.id, event.regular, { email: `x-${randomUUID().slice(0, 6)}@flaky.test` });
    await post(organizerA, `/api/events/${event.id}/invitations/send`, { eventGuestIds: [failing.id, flaky.id], requestId: randomUUID(), mode: 'SEND' }).expect(200);

    const rows = (await organizerA.get(`/api/events/${event.id}/guests`)).body.items as { id: string; emailStatus: string; emailError: string | null }[];
    const failed = rows.find((r) => r.id === failing.id)!;
    expect(failed.emailStatus).toBe('FAILED');
    expect(failed.emailError).toMatch(/odbio/);
    expect(rows.find((r) => r.id === flaky.id)!.emailStatus).toBe('SENT'); // succeeded on the retry
    const flakyDelivery = await prisma.emailDelivery.findFirstOrThrow({ where: { eventGuestId: flaky.id } });
    expect(flakyDelivery.attempts).toBe(2);
  });

  it('refuses to send for a draft event', async () => {
    const event = await createEvent(organizerA, { status: 'DRAFT' });
    const guest = await addGuest(organizerA, event.id, event.regular);
    const res = await post(organizerA, `/api/events/${event.id}/invitations/send`, { eventGuestIds: [guest.id], requestId: randomUUID(), mode: 'SEND' }).expect(409);
    expect(res.body.code).toBe('EVENT_DRAFT');
    expect(mail.list()).toHaveLength(0);
  });

  it('previews the exact e-mail without sending or creating tickets', async () => {
    const event = await createEvent(organizerA);
    const guest = await addGuest(organizerA, event.id, event.regular, { firstName: 'Teodora', ticketQuantity: 2 });
    const preview = await post(organizerA, `/api/events/${event.id}/invitations/preview`, { eventGuestId: guest.id }).expect(200);
    expect(preview.body.to).toBe(guest.email);
    expect(preview.body.html).toContain('Zdravo, Teodora!');
    expect(preview.body.html).toContain('2 ulaznice');
    expect(mail.list()).toHaveLength(0);
    expect(await prisma.ticket.count({ where: { eventGuestId: guest.id } })).toBe(0);
  });
});

describe('provider webhooks', () => {
  const secret = process.env.RESEND_WEBHOOK_SECRET as string;

  function webhook(payload: object, id = `msg_${randomUUID()}`, opts: { badSignature?: boolean } = {}) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = opts.badSignature ? 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' : signWebhook(secret, id, timestamp, body);
    return request(app.getHttpServer())
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .set('svix-id', id)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', signature)
      .send(body);
  }

  async function sentDelivery() {
    const event = await createEvent(organizerA);
    const guest = await addGuest(organizerA, event.id, event.regular);
    await post(organizerA, `/api/events/${event.id}/invitations/send`, { eventGuestIds: [guest.id], requestId: randomUUID(), mode: 'SEND' }).expect(200);
    mail.flushSimulatedEvents().length; // discard the mock's own "delivered"
    const delivery = await prisma.emailDelivery.findFirstOrThrow({ where: { eventGuestId: guest.id } });
    await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', deliveredAt: null } });
    return delivery;
  }

  it('rejects an invalid signature', async () => {
    await webhook({ type: 'email.delivered', data: { email_id: 'x' } }, undefined, { badSignature: true }).expect(401);
  });

  it('applies events once, ignores duplicates and out-of-order arrivals', async () => {
    const delivery = await sentDelivery();
    const messageId = delivery.providerMessageId as string;
    const at = new Date().toISOString();

    const deliveredId = `msg_${randomUUID()}`;
    await webhook({ type: 'email.delivered', created_at: at, data: { email_id: messageId } }, deliveredId).expect(200);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('DELIVERED');

    // The same webhook delivered again.
    await webhook({ type: 'email.delivered', created_at: at, data: { email_id: messageId } }, deliveredId).expect(200);
    // "sent" arriving after "delivered".
    await webhook({ type: 'email.sent', created_at: at, data: { email_id: messageId } }).expect(200);
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.status).toBe('DELIVERED');
    expect(await prisma.webhookEvent.count({ where: { id: deliveredId } })).toBe(1);
  });

  it('marks a bounce as a failed delivery, and a late "delivered" does not undo it', async () => {
    const delivery = await sentDelivery();
    const messageId = delivery.providerMessageId as string;
    await webhook({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: messageId } }).expect(200);
    await webhook({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: messageId } }).expect(200);
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.status).toBe('BOUNCED');
    expect(after.lastError).toMatch(/odbio/);
  });
});

describe('check-in', () => {
  it('admits a valid ticket once and rejects the second scan', async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    const { urls, tickets } = await guestWithTickets(organizerA, event.id, event.vip);

    const first = await scan(scanner, event.id, urls[0]).expect(200);
    expect(first.body).toMatchObject({ result: 'ADMITTED', title: 'ULAZ DOZVOLJEN', ticket: { reference: tickets[0].reference, guestName: 'Marko Petrović', ticketType: { name: 'VIP' } } });
    expect(first.body.ticket.usedAt).toBeTruthy();

    const second = await scan(scanner2, event.id, urls[0]).expect(200);
    expect(second.body).toMatchObject({ result: 'ALREADY_USED', title: 'KARTA JE VEĆ ISKORIŠĆENA' });
    expect(second.body.ticket.usedAt).toBe(first.body.ticket.usedAt); // original check-in time

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(ticket).toMatchObject({ status: 'USED', scannedById: scannerId });
    const logs = await prisma.scanLog.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => l.result)).toEqual(['ADMITTED', 'ALREADY_USED']);

    const stats = await organizerA.get(`/api/events/${event.id}/stats`).expect(200);
    expect(stats.body.tickets).toMatchObject({ used: 1, valid: 0 });
    expect(stats.body.checkInRate).toBe(100);
  });

  it('lets exactly ONE of many simultaneous scans of the same ticket succeed', async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    const { urls, tickets } = await guestWithTickets(organizerA, event.id, event.regular);

    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => scan(i % 2 ? scanner : scanner2, event.id, urls[0])));
    const results = responses.map((r) => r.body.result as string);
    expect(results.filter((r) => r === 'ADMITTED')).toHaveLength(1);
    expect(results.filter((r) => r === 'ALREADY_USED')).toHaveLength(11);

    expect(await prisma.scanLog.count({ where: { ticketId: tickets[0].id, result: 'ADMITTED' } })).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).checkedInCount).toBe(1);
  });

  it('rejects a ticket scanned at a different event of the same organizer', async () => {
    const event1 = await createEvent(organizerA);
    const event2 = await createEvent(organizerA);
    await staff(event1.id);
    await staff(event2.id);
    const { urls, tickets } = await guestWithTickets(organizerA, event1.id, event1.regular);

    const wrong = await scan(scanner, event2.id, urls[0]).expect(200);
    expect(wrong.body).toMatchObject({ result: 'WRONG_EVENT', title: 'KARTA NIJE ZA OVAJ DOGAĐAJ', ticket: null });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } })).status).toBe('VALID');
    // Still perfectly usable at its own event.
    expect((await scan(scanner, event1.id, urls[0])).body.result).toBe('ADMITTED');
  });

  it("answers INVALID for unknown codes, garbage, and another organizer's ticket", async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    const eventB = await createEvent(organizerB);
    const foreign = await guestWithTickets(organizerB, eventB.id, eventB.regular);

    for (const token of ['A'.repeat(43), 'https://example.com/menu', 'WIFI:S:Club;;', foreign.urls[0]]) {
      const res = await scan(scanner, event.id, token).expect(200);
      expect(res.body).toMatchObject({ result: 'INVALID', title: 'NEVAŽEĆA KARTA', ticket: null });
    }
  });

  it('rejects revoked, expired and regenerated (old) tickets', async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    const revoked = await guestWithTickets(organizerA, event.id, event.regular);
    const expired = await guestWithTickets(organizerA, event.id, event.regular);
    const regenerated = await guestWithTickets(organizerA, event.id, event.regular);

    await post(organizerA, `/api/events/${event.id}/tickets/revoke`, { ticketIds: [revoked.tickets[0].id] }).expect(200);
    expect((await scan(scanner, event.id, revoked.urls[0])).body).toMatchObject({ result: 'REVOKED', title: 'KARTA JE PONIŠTENA' });

    await organizerA.patch(`/api/events/${event.id}/tickets/${expired.tickets[0].id}`).set(CSRF).send({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).expect(200);
    expect((await scan(scanner, event.id, expired.urls[0])).body.result).toBe('EXPIRED');

    const fresh = await post(organizerA, `/api/events/${event.id}/tickets/${regenerated.tickets[0].id}/regenerate`).expect(200);
    expect(fresh.body.url).not.toBe(regenerated.urls[0]);
    expect((await scan(scanner, event.id, regenerated.urls[0])).body.result).toBe('INVALID'); // old QR is dead
    expect((await scan(scanner, event.id, fresh.body.url)).body.result).toBe('ADMITTED');
  });

  it('does not scan for cancelled or ended events', async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    const { urls, tickets } = await guestWithTickets(organizerA, event.id, event.regular);

    await organizerA.patch(`/api/events/${event.id}`).set(CSRF).send({ status: 'CANCELLED' }).expect(200);
    expect((await scan(scanner, event.id, urls[0])).body.result).toBe('EVENT_NOT_ACTIVE');

    await prisma.event.update({ where: { id: event.id }, data: { status: 'ACTIVE', startsAt: new Date(Date.now() - 30 * 3_600_000), endsAt: new Date(Date.now() - 20 * 3_600_000) } });
    expect((await scan(scanner, event.id, urls[0])).body.result).toBe('EVENT_ENDED');
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } })).status).toBe('VALID');
  });

  it('enforces capacity atomically under concurrent scans of different tickets', async () => {
    const event = await createEvent(organizerA, { capacity: 3, enforceCapacity: true });
    await staff(event.id);
    const { urls } = await guestWithTickets(organizerA, event.id, event.regular, 8);

    const responses = await Promise.all(urls.map((url, i) => scan(i % 2 ? scanner : scanner2, event.id, url)));
    const results = responses.map((r) => r.body.result as string);
    expect(results.filter((r) => r === 'ADMITTED')).toHaveLength(3);
    expect(results.filter((r) => r === 'CAPACITY_REACHED')).toHaveLength(5);
    // Rejected tickets were rolled back, not burned.
    expect(await prisma.ticket.count({ where: { eventId: event.id, status: 'USED' } })).toBe(3);
    expect(await prisma.ticket.count({ where: { eventId: event.id, status: 'VALID' } })).toBe(5);
  });

  it('only lets staff assigned to the event scan it', async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    const { urls, tickets } = await guestWithTickets(organizerA, event.id, event.regular);

    await scan(unassignedScanner, event.id, urls[0]).expect(404);
    expect((await unassignedScanner.get('/api/scanner/events').expect(200)).body).toEqual([]);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } })).status).toBe('VALID');
    expect((await scanner.get('/api/scanner/events').expect(200)).body.some((e: { id: string }) => e.id === event.id)).toBe(true);
  });

  it('supports manual search with limited data and manual check-in', async () => {
    const event = await createEvent(organizerA);
    await staff(event.id);
    const { tickets, guest } = await guestWithTickets(organizerA, event.id, event.regular);

    const found = await scanner.get(`/api/scanner/events/${event.id}/search?q=Petrovi`).expect(200);
    const hit = found.body.find((t: { ticketId: string }) => t.ticketId === tickets[0].id);
    expect(hit).toMatchObject({ guestName: 'Marko Petrović', status: 'VALID' });
    expect(JSON.stringify(found.body)).not.toContain(guest.email); // no contact details for door staff

    const manual = await post(scanner, `/api/scanner/events/${event.id}/check-in`, { ticketId: tickets[0].id }).expect(200);
    expect(manual.body.result).toBe('ADMITTED');
    const history = await scanner.get('/api/scanner/history').expect(200);
    expect(history.body[0]).toMatchObject({ result: 'ADMITTED', method: 'MANUAL', reference: tickets[0].reference });
  });
});

describe('public ticket page', () => {
  it('shows the ticket without authentication and never marks it as used', async () => {
    const event = await createEvent(organizerA);
    const { urls, tickets } = await guestWithTickets(organizerA, event.id, event.vip);
    const token = urls[0].split('/t/')[1];

    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer()).get(`/api/public/tickets/${token}`).expect(200);
      expect(res.body).toMatchObject({ reference: tickets[0].reference, status: 'VALID', guestName: 'Marko Petrović', ticketType: { name: 'VIP' } });
      expect(res.body.qrSvg).toContain('<svg');
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      // No e-mail address or internal ids leak to the public page.
      expect(JSON.stringify(res.body)).not.toMatch(/example\.com"|eventId|guestId/);
    }
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } })).status).toBe('VALID');
  });

  it('returns the same 404 for unknown and malformed tokens', async () => {
    const unknown = await request(app.getHttpServer()).get(`/api/public/tickets/${'B'.repeat(43)}`).expect(404);
    const malformed = await request(app.getHttpServer()).get('/api/public/tickets/abc').expect(404);
    expect(unknown.body).toEqual(malformed.body);
  });

  it('stores no plaintext token in the database', async () => {
    const event = await createEvent(organizerA);
    const { urls, tickets } = await guestWithTickets(organizerA, event.id, event.regular);
    const token = urls[0].split('/t/')[1];
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
