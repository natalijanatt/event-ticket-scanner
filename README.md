# Propusnica — event invitations & QR tickets

Web application for private parties and club events: organizers build a guest
list, send personalized e-mail invitations with unique QR tickets, and entrance
staff validate the tickets with a phone camera. Every ticket admits exactly once.

- **UI language:** Serbian (Latin). Code, schema and docs: English.
- **Not** a ticket shop — there is no payment flow. Organizers invite guests by hand.

```text
apps/
  api/      NestJS + Prisma REST API (auth, events, guests, tickets, e-mail, check-in)
  web/      React + Vite admin panel, PWA scanner (/scanner), guest ticket page (/t/:token)
packages/
  shared/   enums, Zod schemas, API types, Serbian labels — used by BOTH apps
```

## Quick start

Requirements: Node.js ≥ 20, Docker Desktop.

```bash
cp .env.example .env          # then fill in the values (see below)
npm install
npm run infra:up              # Redis (+ a local Postgres on port 5433 for tests)
npm run setup                 # build shared, generate Prisma client, migrate, seed
npm run dev                   # API on :3000, web on :5173
```

Open <http://localhost:5173>. Demo accounts (password for all: `Demo-lozinka-2026`):

| E-mail | Role |
|---|---|
| `admin@ulaznice.example` | Platform administrator |
| `marko@clubcentral.example` | Organizer — Club Central (2 events, 38 guests) |
| `jelena@horizont.example` | Organizer — Splav Horizont (separate tenant) |
| `nikola@clubcentral.example` | Entrance staff (both Club Central events) |
| `ana@clubcentral.example` | Entrance staff (Friday Night Party only) |

The seed prints one real, valid ticket link you can open and scan.
`npm run db:seed -- --reset` wipes and re-seeds (never runs in production).

### `.env`

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # TICKET_TOKEN_ENC_KEY
```

### Database: Supabase

The app uses Supabase purely as hosted PostgreSQL (its own auth and role checks
live in the API — Supabase Auth is not used).

1. Create a Supabase project → **Project Settings → Database → Connection string**.
2. Put both URLs into `.env`:

   ```ini
   # Transaction pooler (port 6543) – used by the running app
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10&schema=app"
   # Session pooler / direct (port 5432) – used by Prisma migrations
   DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=app"
   ```

3. `npm run db:deploy` (creates the `app` schema and tables), then `npm run db:seed` for demo data.

**Why `schema=app`:** Supabase exposes everything in the `public` schema through
its auto-generated Data API (PostgREST + anon key). Keeping the tables in a
separate schema that the Data API does not expose means guest data is reachable
only through this application's API. Do not add `app` to *API → Exposed schemas*.

All raw SQL in the API uses schema-qualified table names, so it does not depend
on `search_path` (which is not reliable behind a transaction-mode pooler).

No Supabase project yet? The local alternative from `.env.example`
(`localhost:5433`, started by `npm run infra:up`) works identically.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + web + shared in watch mode |
| `npm run dev:https` | same, web served over HTTPS (self-signed) — needed to test the camera on a phone over LAN |
| `npm run build` | production build of everything |
| `npm start` | run the built API (`apps/api/dist/main.js`) |
| `npm test` | API unit + API integration + web tests |
| `npm run db:migrate` | create/apply a migration in development |
| `npm run db:deploy` | apply migrations (production / Supabase) |
| `npm run typecheck` | TypeScript check of all packages |

### Testing the scanner on a phone

Browsers grant camera access only in a secure context. On the same Wi-Fi:

```bash
npm run dev:https            # then open https://<your-computer-ip>:5173/scanner on the phone
```

Accept the self-signed certificate warning once. Add that origin to `WEB_ORIGINS`
and set `PUBLIC_APP_URL` to it so QR codes point at an address the phone can reach.
On Android/iOS use the browser's "Add to Home Screen" to install the scanner as a PWA.

## E-mail

`EMAIL_MODE` is the single configuration boundary (`apps/api/src/email/email.module.ts`):

- **`mock`** (default) — nothing leaves the machine. Messages land in a local
  outbox, visible in the admin panel under **Podešavanja → Test sanduče**, and
  the provider lifecycle is simulated so the UI shows real status changes:
  `…@bounce.test` bounces, `…@fail.test` is rejected, `…@flaky.test` fails once then succeeds.
- **`resend`** — real delivery through the Resend API.

Going live with Resend:

1. Verify your sending domain in Resend and add the DNS records it shows:
   **SPF** (`TXT` on the return-path subdomain), **DKIM** (`TXT resend._domainkey`).
   Add a **DMARC** record yourself, e.g. `_dmarc.example.com TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"`
   (start with `p=none` while monitoring).
2. Set `EMAIL_MODE=resend`, `RESEND_API_KEY`, `EMAIL_FROM="Name <pozivnice@your-domain>"`.
3. In Resend → Webhooks add `https://<your-host>/api/webhooks/resend` with the events
   `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
   `email.complained`, `email.failed`; copy the signing secret into `RESEND_WEBHOOK_SECRET`.

**Statuses are honest.** `Poslato` means the provider *accepted* the message;
`Isporuka potvrđena` appears only after the provider's signed `email.delivered` webhook.

How sending works: `POST …/invitations/send` creates one `email_deliveries` row
per guest and enqueues a BullMQ job. The worker renders the e-mail from the
guest's *existing* valid tickets, sends it, and records the result.

- **Retries:** 6 attempts, exponential backoff from 5 s. A 429 pauses the queue for the provider's `Retry-After`.
- **Duplicate prevention (4 layers):** in-flight deliveries are skipped · "send" skips already-invited guests
  (only explicit "resend" sends again) · `<requestId>:<guestId>` is unique in the database, so a replayed HTTP
  request creates nothing · the delivery id is both the queue job id and the provider `Idempotency-Key`.
- **Resend never creates tickets.** Ticket generation only tops a guest up to their allocated quantity,
  under a row lock, so it is idempotent even for simultaneous requests.
- **Webhooks:** verified against the raw body (Svix scheme, 5-minute replay window), processed once per webhook id,
  and applied through a rank-based state machine so late or reordered events cannot move a status backwards.

## Security design

**Ticket secrets** (`apps/api/src/tickets/ticket-crypto.service.ts`)

- Token = 32 bytes from the OS CSPRNG (256 bits), base64url. The QR code contains only `https://<host>/t/<token>` — no ids, names or e-mails.
- The database stores **SHA-256(token)** for lookup. A fast hash is correct here because the input is a random 256-bit value, not a password.
- To re-send an invitation the link must be rebuilt, so the token is also stored **AES-256-GCM encrypted** under `TICKET_TOKEN_ENC_KEY`, which lives in the environment, not the database. The ticket id is bound as AAD. A database dump alone yields no usable ticket. Keep the key in a secret manager; if it is lost, existing tickets still scan but can no longer be re-sent (use "Napravi novi QR kod").
- "Napravi novi QR kod" replaces the token; the old QR code stops working immediately. Use it when a ticket was forwarded to the wrong person.

**Atomic check-in** (`apps/api/src/check-in/check-in.service.ts`)

One conditional `UPDATE … WHERE token_hash = $1 AND event_id = $2 AND status = 'VALID' … RETURNING id`.
PostgreSQL row-locks the ticket, so of any number of simultaneous scans exactly one finds `VALID`; the rest
re-evaluate against the committed row and are reported as already used. No read-then-write window exists.
The same transaction conditionally increments `events.checked_in_count` (capacity limit) and inserts the
`scan_logs` audit row — all three commit or roll back together. Only *after* a miss does a read-only query
choose the message (already used / revoked / wrong event / expired / invalid). A ticket belonging to another
organizer is indistinguishable from a made-up code.

**Authentication**

- Argon2id password hashes. Access JWT (15 min) + rotating refresh token, both in `HttpOnly` cookies
  (`SameSite=Lax` / `Strict`, `Secure` in production). Nothing is stored in `localStorage`.
- Refresh tokens are stored hashed and rotated on every use; replaying an old one revokes the whole session family.
- The session row is checked on every request, so logout, deactivation and password changes apply immediately.
- CSRF: SameSite cookies + a required custom header + `Origin` allow-list (`csrf.middleware.ts`). CORS allows only `WEB_ORIGINS`.
- Rate limits: global per-IP baseline, strict limits on login / reset / public ticket endpoints.
- Password reset: single-use, 60-minute token (stored hashed); the response is identical whether or not the account exists.

**Authorization** — enforced in the API, never only in the UI. Every event-scoped service obtains its event
through `AccessService` (`apps/api/src/auth/access.service.ts`); the rules themselves are pure functions in
`access.rules.ts`. Foreign data answers `404`, not `403`, so its existence is not revealed. Scanners can reach
only `/api/scanner/*`, only for events they are assigned to, and never see e-mail addresses or the guest list.

**Other**

- Guest ticket page: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, no analytics or third-party resources (fonts are self-hosted). Viewing or downloading never changes ticket state.
- Imports: 2 MB / 5,000-row limits, type detected from content, `.xlsx` cells read as text (formulas are never evaluated). CSV exports neutralize formula injection.
- Uploaded cover images are validated by magic bytes and stored under random names.
- Logs contain paths and ids only — no request bodies, e-mail addresses or tokens.
- **Retention:** each organizer sets `retentionDays` (Podešavanja). A nightly job anonymizes guests whose last event ended longer ago than that: name, e-mail, phone, notes and the encrypted ticket link are erased; anonymous ticket and scan-log rows remain as the minimal audit record.

## Edge cases handled

| Case | Behaviour |
|---|---|
| Same QR scanned on two phones at once | exactly one `ULAZ DOZVOLJEN` (atomic update; covered by a concurrency test) |
| Same QR scanned repeatedly / camera sees it in consecutive frames | client-side repeat guard + paused decoding while a result is shown; server answers `KARTA JE VEĆ ISKORIŠĆENA` with the original time |
| Guest forwards the ticket | first scan wins; organizer can issue a new QR code or revoke |
| Invitation fails to send | automatic retries, then `Greška pri slanju` with the reason; "Pošalji ponovo" |
| Organizer resends | same tickets, new delivery row, never new tickets |
| Ticket revoked after sending | scanner shows `KARTA JE PONIŠTENA`; the guest's ticket page says so |
| Several tickets for one e-mail | one e-mail listing every ticket, each with its own link/QR |
| Guest invited to several events | one contact per organizer, one invitation row per event |
| Staff selects the wrong event | `KARTA NIJE ZA OVAJ DOGAĐAJ`; the active event is always shown in the scanner header |
| Scanner loses connectivity / server times out | `PROVERA NIJE USPELA…` — never treated as an entry; retry button |
| Camera permission denied / no camera / not HTTPS | explained on screen; manual search stays available |
| No torch support | the torch button is simply not shown |
| Ticket opened before the event | shown as a normal valid ticket |
| Ticket expired / event cancelled or ended | rejected at the door; stated on the ticket page |
| Duplicate e-mails in an import | first row used, the rest reported per row before anything is imported |
| Two organizers, same guest e-mail | fully separate guest records |
| Access to another organizer's data | `404` on every route (covered by tests) |
| Scan after the event ended | accepted for 3 h after the end (12 h default length when no end is set), then `DOGAĐAJ JE ZAVRŠEN` |
| Scanner page refreshed mid-shift | selected event and session counter are restored |
| Webhooks duplicated or out of order | idempotent by webhook id; status can only move forward |

## Implementation notes

- **Validation is shared.** The Zod schemas in `packages/shared` drive both the React Hook Form resolvers and the API's `ZodPipe`, so client and server cannot drift apart.
- **Guests vs tickets.** `event_guests` holds the allocation (ticket type + quantity); `tickets` are generated from it. Statistics always report guests and tickets separately.
- **Guest-list filters** on derived values (latest e-mail status, aggregate ticket state) are evaluated in memory after one indexed query per event — simple and fast for guest lists in the thousands.
- **Live updates** use Server-Sent Events carrying only "something changed" hints; clients refetch through normal authorized endpoints (with polling as a fallback). The publisher is in-process; to run several API instances, publish the hints through Redis pub/sub in `RealtimeService`.
- **Check-in window, grace period, default event length** are constants in `check-in.rules.ts`.
- New events get `Regular` and `VIP` ticket types automatically and default to *Aktivan* in the create form; a draft event cannot send invitations or be scanned.

## Tests

```bash
npm run test:api               # unit: token generation/validation, crypto, ownership rules, expiry, delivery state machine, webhook signatures, templates
npm run test:api:integration   # real PostgreSQL: full invite → scan flow, idempotent sending, tenant isolation, concurrent check-in, capacity, webhooks
npm run test:web               # login flow, guest form, e-mail preview, bulk-send confirmation, ticket page, scanner result states
```

Integration tests use **`TEST_DATABASE_URL` only** (default: the local Docker Postgres, schema `test`) and
refuse to run against anything that is not marked as a test schema — they can never touch Supabase data.
E-mail is mocked and the queue runs inline; no Redis or network is needed.

## Deployment

1. Provision PostgreSQL (Supabase), Redis, and set the environment from `.env.example` with
   `NODE_ENV=production`, an `https://` `PUBLIC_APP_URL`, matching `WEB_ORIGINS`, and `TRUST_PROXY=true` behind a reverse proxy.
2. `npm ci && npm run build && npm run db:generate && npm run db:deploy`
3. Run the API: `npm start`.
4. Serve the web app in one of two ways:
   - **Single origin (simplest):** set `WEB_DIST_DIR=../web/dist` and the API serves the built SPA itself.
   - **Separate static host / CDN:** serve `apps/web/dist` with an SPA fallback to `index.html` and proxy `/api` and `/uploads` to the API on the same origin.
5. Health check: `GET /api/health` → `200 {"status":"ok","database":"up"}` (503 when the database is unreachable).

HTTPS is mandatory in production (secure cookies, camera access). Logs are structured JSON when `NODE_ENV=production`.
Persist `UPLOAD_DIR` (event cover images, organizer logos) on a volume.

### Railway (API) + Netlify (web)

The browser must see ONE origin, otherwise the SameSite auth cookies are not sent.
Netlify therefore proxies `/api` and `/uploads` to Railway (`netlify.toml`, `scripts/netlify-redirects.mjs`).

**Railway** — new project from the GitHub repo (root directory = repository root; `railway.json` supplies the
build, migration, start and health-check commands). Add a Redis service, then set the variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL`, `DIRECT_URL` | the two Supabase pooler URLs (with `schema=app`) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_ACCESS_SECRET`, `TICKET_TOKEN_ENC_KEY` | freshly generated (see `.env.example`) — not the development values |
| `PUBLIC_APP_URL`, `WEB_ORIGINS` | the Netlify site URL, e.g. `https://your-site.netlify.app` |
| `TRUST_PROXY` | `2` (Netlify → Railway), so rate limits see real client IPs |
| `EMAIL_MODE`, `EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | see *E-mail* |

Generate a public domain for the service (Settings → Networking). Cover images live on local disk:
attach a volume and point `UPLOAD_DIR` at it, or they disappear on every redeploy.

**Netlify** — new site from the same repo (base directory empty; `netlify.toml` supplies the rest).
Set `API_URL` to the Railway public URL (no trailing slash) and deploy.

**First administrator** — with `.env` pointing at the production database:

```bash
npm run create-admin
```

It asks for e-mail, name and password. Organizers, their users and entrance staff are then created in the admin panel.
Do not run `npm run db:seed` against production: it inserts demo accounts with a publicly known password.
