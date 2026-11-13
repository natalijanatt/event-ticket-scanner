import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  EMAIL_STATUS_LABELS,
  GUEST_TICKET_STATE_LABELS,
  type AddGuestInput,
  type BulkGuestsResult,
  type GuestEmailStatus,
  type GuestInput,
  type GuestMutationResult,
  type GuestRowDto,
  type GuestTicketState,
  type ImportResultDto,
  type ImportRowDto,
  type Paginated,
  type UpdateGuestInput,
} from '@event-platform/shared';
import type { Event, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { toCsv } from '../common/csv';
import { formatDateTimeCompact } from '../common/dates';
import { badRequest, conflict, notFound } from '../common/errors';
import { RealtimeService } from '../common/realtime.service';
import { AppConfig } from '../config/app-config';
import { InvitationsService } from '../invitations/invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { parseGuestFile } from './guest-import';

const rowInclude = {
  guest: true,
  ticketType: { select: { id: true, name: true, color: true } },
  tickets: { select: { status: true, usedAt: true } },
  emailDeliveries: {
    orderBy: { queuedAt: 'desc' },
    take: 1,
    select: { status: true, lastError: true, queuedAt: true, sentAt: true },
  },
} satisfies Prisma.EventGuestInclude;

type EventGuestRow = Prisma.EventGuestGetPayload<{ include: typeof rowInclude }>;

export interface GuestListQuery {
  search?: string;
  ticketTypeId?: string;
  emailStatus?: GuestEmailStatus;
  ticketState?: GuestTicketState;
  checkedIn?: 'yes' | 'no';
  page: number;
  pageSize: number;
}

export function toGuestRow(eg: EventGuestRow): GuestRowDto {
  const counts = { valid: 0, used: 0, revoked: 0 };
  let firstCheckIn: Date | null = null;
  for (const t of eg.tickets) {
    if (t.status === 'VALID') counts.valid++;
    else if (t.status === 'USED') counts.used++;
    else counts.revoked++;
    if (t.status === 'USED' && t.usedAt && (!firstCheckIn || t.usedAt < firstCheckIn)) firstCheckIn = t.usedAt;
  }
  let ticketState: GuestTicketState = 'NONE';
  if (counts.used > 0) ticketState = counts.valid > 0 ? 'PARTIALLY_USED' : 'USED';
  else if (counts.valid > 0) ticketState = 'VALID';
  else if (counts.revoked > 0) ticketState = 'REVOKED';

  const delivery = eg.emailDeliveries[0];
  return {
    id: eg.id,
    guestId: eg.guestId,
    firstName: eg.guest.firstName,
    lastName: eg.guest.lastName,
    email: eg.guest.email,
    phone: eg.guest.phone,
    notes: eg.notes,
    ticketType: eg.ticketType,
    ticketQuantity: eg.ticketQuantity,
    tickets: counts,
    ticketState,
    emailStatus: delivery?.status ?? 'NOT_SENT',
    emailError: delivery?.lastError ?? null,
    lastEmailAt: (delivery?.sentAt ?? delivery?.queuedAt)?.toISOString() ?? null,
    firstCheckInAt: firstCheckIn?.toISOString() ?? null,
    createdAt: eg.createdAt.toISOString(),
  };
}

/** FAILED/BOUNCED and QUEUED/SENDING share one label in the UI, so they filter together. */
function sameEmailGroup(actual: GuestEmailStatus, wanted: GuestEmailStatus): boolean {
  const group = (s: GuestEmailStatus) => (s === 'BOUNCED' ? 'FAILED' : s === 'SENDING' ? 'QUEUED' : s);
  return group(actual) === group(wanted);
}

@Injectable()
export class GuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly tickets: TicketsService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  async list(user: RequestUser, eventId: string, query: GuestListQuery): Promise<Paginated<GuestRowDto>> {
    const event = await this.access.eventForManage(user, eventId);
    const rows = await this.filteredRows(event.id, query);
    const start = (query.page - 1) * query.pageSize;
    return { total: rows.length, page: query.page, pageSize: query.pageSize, items: rows.slice(start, start + query.pageSize) };
  }

  /** Ids of every guest matching the filter – backs "select all N results" in the table. */
  async listIds(user: RequestUser, eventId: string, query: GuestListQuery): Promise<{ ids: string[] }> {
    const event = await this.access.eventForManage(user, eventId);
    return { ids: (await this.filteredRows(event.id, query)).map((r) => r.id) };
  }

  /**
   * E-mail status and ticket state are derived values (latest delivery,
   * aggregate of several tickets), so they are filtered in memory after one
   * indexed query per event. Guest lists of private events are small enough
   * (thousands, not millions) for this to stay fast and simple.
   */
  private async filteredRows(eventId: string, query: Omit<GuestListQuery, 'page' | 'pageSize'>): Promise<GuestRowDto[]> {
    const search = query.search?.trim();
    const where: Prisma.EventGuestWhereInput = {
      eventId,
      ...(query.ticketTypeId ? { ticketTypeId: query.ticketTypeId } : {}),
    };
    if (search) {
      const terms = search.split(/\s+/).slice(0, 4);
      where.AND = terms.map((term) => ({
        guest: {
          OR: [
            { firstName: { contains: term, mode: 'insensitive' as const } },
            { lastName: { contains: term, mode: 'insensitive' as const } },
            { email: { contains: term, mode: 'insensitive' as const } },
          ],
        },
      }));
    }
    const records = await this.prisma.eventGuest.findMany({
      where,
      include: rowInclude,
      orderBy: [{ guest: { firstName: 'asc' } }, { guest: { lastName: 'asc' } }, { id: 'asc' }],
    });
    return records.map(toGuestRow).filter((row) => {
      if (query.emailStatus && !sameEmailGroup(row.emailStatus, query.emailStatus)) return false;
      if (query.ticketState && row.ticketState !== query.ticketState) return false;
      if (query.checkedIn === 'yes' && row.tickets.used === 0) return false;
      if (query.checkedIn === 'no' && row.tickets.used > 0) return false;
      return true;
    });
  }

  async add(user: RequestUser, eventId: string, input: AddGuestInput): Promise<GuestMutationResult> {
    const event = await this.access.eventForManage(user, eventId);
    if (input.sendInvitation && event.status !== 'ACTIVE') {
      throw conflict(
        event.status === 'DRAFT' ? 'EVENT_DRAFT' : 'EVENT_CLOSED',
        event.status === 'DRAFT'
          ? 'Događaj je još u nacrtu. Aktiviraj ga pre slanja pozivnica.'
          : 'Događaj je završen ili otkazan — pozivnice se više ne mogu slati.',
      );
    }
    const { created, skippedExisting } = await this.createGuests(event, [input]);
    if (skippedExisting.length > 0 || created.length === 0) {
      throw conflict(
        'GUEST_EXISTS',
        'Gost sa ovom email adresom je već na listi ovog događaja. Izmeni postojećeg gosta ako želiš da promeniš broj karata.',
      );
    }
    const eventGuestId = created[0];

    let ticketsGenerated = 0;
    let invitationQueued = false;
    if (input.sendInvitation) {
      const sent = await this.invitations.send(user, event.id, {
        eventGuestIds: [eventGuestId],
        requestId: input.requestId ?? randomUUID(),
        mode: 'SEND',
      });
      ticketsGenerated = sent.ticketsGenerated;
      invitationQueued = sent.queued > 0;
    } else if (input.generateTickets) {
      ticketsGenerated = (await this.tickets.generate(user, event.id, [eventGuestId])).generated;
    }
    this.realtime.publish(event.id, 'tickets');
    return { guest: await this.row(event.id, eventGuestId), alreadyOnEvent: false, ticketsGenerated, invitationQueued };
  }

  async addBulk(user: RequestUser, eventId: string, guests: GuestInput[]): Promise<BulkGuestsResult> {
    const event = await this.access.eventForManage(user, eventId);
    const result = await this.createGuests(event, guests);
    this.realtime.publish(event.id, 'tickets');
    return { created: result.created.length, skippedExisting: result.skippedExisting, duplicatesInBatch: result.duplicatesInBatch };
  }

  async update(user: RequestUser, eventId: string, eventGuestId: string, input: UpdateGuestInput): Promise<GuestRowDto> {
    const event = await this.access.eventForManage(user, eventId);
    const eg = await this.prisma.eventGuest.findFirst({
      where: { id: eventGuestId, eventId: event.id },
      include: { guest: true, tickets: { where: { status: { not: 'REVOKED' } }, select: { id: true } } },
    });
    if (!eg) throw notFound('Gost nije pronađen.');

    if (input.ticketTypeId && input.ticketTypeId !== eg.ticketTypeId) await this.assertTicketType(event.id, input.ticketTypeId);
    if (input.ticketQuantity !== undefined && input.ticketQuantity < eg.tickets.length) {
      throw badRequest('QUANTITY_BELOW_ISSUED', 'Proveri unete podatke.', {
        ticketQuantity: `Gost već ima ${eg.tickets.length} izdatih karata. Prvo poništi višak karata.`,
      });
    }
    if (input.email && input.email !== eg.guest.email) {
      const clash = await this.prisma.guest.findUnique({
        where: { organizerId_email: { organizerId: event.organizerId, email: input.email } },
        select: { id: true },
      });
      if (clash) throw badRequest('EMAIL_IN_USE', 'Proveri unete podatke.', { email: 'Drugi gost već koristi ovu email adresu.' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.guest.update({
        where: { id: eg.guestId },
        data: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone },
      });
      await tx.eventGuest.update({
        where: { id: eg.id },
        data: { notes: input.notes, ticketTypeId: input.ticketTypeId, ticketQuantity: input.ticketQuantity },
      });
      if (input.ticketTypeId && input.ticketTypeId !== eg.ticketTypeId) {
        // Unused tickets follow the guest's new type; used ones keep their history.
        await tx.ticket.updateMany({ where: { eventGuestId: eg.id, status: 'VALID' }, data: { ticketTypeId: input.ticketTypeId } });
      }
    });
    this.realtime.publish(event.id, 'tickets');
    return this.row(event.id, eg.id);
  }

  /** Removes guests from the event together with their unused tickets. Checked-in guests are kept. */
  async remove(user: RequestUser, eventId: string, eventGuestIds: string[]): Promise<{ removed: number; skippedCheckedIn: number }> {
    const event = await this.access.eventForManage(user, eventId);
    const candidates = await this.prisma.eventGuest.findMany({
      where: { id: { in: eventGuestIds }, eventId: event.id },
      select: { id: true, tickets: { where: { status: 'USED' }, select: { id: true }, take: 1 } },
    });
    const removable = candidates.filter((c) => c.tickets.length === 0).map((c) => c.id);
    if (removable.length > 0) {
      await this.prisma.eventGuest.deleteMany({ where: { id: { in: removable }, eventId: event.id } });
      await this.audit.log({
        actorId: user.id,
        organizerId: event.organizerId,
        action: 'guests.remove',
        entityType: 'event',
        entityId: event.id,
        metadata: { removed: removable.length },
      });
      this.realtime.publish(event.id, 'tickets');
    }
    return { removed: removable.length, skippedCheckedIn: candidates.length - removable.length };
  }

  async exportCsv(user: RequestUser, eventId: string, eventGuestIds?: string[]): Promise<{ filename: string; csv: string }> {
    const event = await this.access.eventForManage(user, eventId);
    let rows = await this.filteredRows(event.id, {});
    if (eventGuestIds?.length) {
      const wanted = new Set(eventGuestIds);
      rows = rows.filter((r) => wanted.has(r.id));
    }
    const tz = this.config.timezone;
    const csv = toCsv(
      ['Ime', 'Prezime', 'Email', 'Telefon', 'Tip karte', 'Broj karata', 'Status pozivnice', 'Status karte', 'Iskorišćeno karata', 'Vreme ulaska', 'Napomena'],
      rows.map((r) => [
        r.firstName,
        r.lastName,
        r.email,
        r.phone ?? '',
        r.ticketType.name,
        r.ticketQuantity,
        EMAIL_STATUS_LABELS[r.emailStatus],
        GUEST_TICKET_STATE_LABELS[r.ticketState],
        r.tickets.used,
        r.firstCheckInAt ? formatDateTimeCompact(new Date(r.firstCheckInAt), tz) : '',
        r.notes ?? '',
      ]),
    );
    await this.audit.log({
      actorId: user.id,
      organizerId: event.organizerId,
      action: 'guests.export',
      entityType: 'event',
      entityId: event.id,
      metadata: { rows: rows.length },
    });
    const slug = event.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { filename: `gosti-${slug || 'dogadjaj'}.csv`, csv };
  }

  async import(
    user: RequestUser,
    eventId: string,
    file: Express.Multer.File | undefined,
    opts: { dryRun: boolean; defaultTicketTypeId?: string },
  ): Promise<ImportResultDto> {
    const event = await this.access.eventForManage(user, eventId);
    if (!file) throw badRequest('FILE_REQUIRED', 'Izaberi CSV ili Excel fajl.');
    const parsed = await parseGuestFile(file.buffer);

    const types = await this.prisma.ticketType.findMany({ where: { eventId: event.id }, orderBy: { sortOrder: 'asc' } });
    if (types.length === 0) throw conflict('NO_TICKET_TYPES', 'Događaj nema nijedan tip karte. Dodaj tip karte pre uvoza gostiju.');
    const defaultType = types.find((t) => t.id === opts.defaultTicketTypeId) ?? types[0];
    const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));

    const existing = await this.prisma.eventGuest.findMany({
      where: { eventId: event.id, guest: { email: { in: parsed.map((p) => p.email) } } },
      select: { guest: { select: { email: true } } },
    });
    const onEvent = new Set(existing.map((e) => e.guest.email));
    const seen = new Set<string>();

    const toCreate: GuestInput[] = [];
    const rows: ImportRowDto[] = parsed.map((p) => {
      let status: ImportRowDto['status'] = 'OK';
      let error = p.error;
      const type = p.ticketTypeName ? typeByName.get(p.ticketTypeName.toLowerCase()) : defaultType;
      if (error) status = 'INVALID';
      else if (!type) {
        status = 'INVALID';
        error = `Tip karte „${p.ticketTypeName}" ne postoji na ovom događaju.`;
      } else if (seen.has(p.email)) {
        status = 'DUPLICATE_IN_FILE';
        error = 'Email adresa se ponavlja u fajlu — koristi se samo prvi red.';
      } else if (onEvent.has(p.email)) {
        status = 'ALREADY_ON_EVENT';
        error = 'Gost je već na listi ovog događaja.';
      }
      if (!p.error) seen.add(p.email);
      if (status === 'OK' && type) {
        toCreate.push({
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          phone: p.phone,
          notes: p.notes,
          ticketTypeId: type.id,
          ticketQuantity: p.ticketQuantity,
        });
      }
      return {
        row: p.row,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        phone: p.phone,
        notes: p.notes,
        ticketTypeName: type?.name ?? p.ticketTypeName,
        ticketQuantity: p.ticketQuantity,
        status,
        error,
      };
    });

    let created = 0;
    if (!opts.dryRun && toCreate.length > 0) {
      created = (await this.createGuests(event, toCreate)).created.length;
      await this.audit.log({
        actorId: user.id,
        organizerId: event.organizerId,
        action: 'guests.import',
        entityType: 'event',
        entityId: event.id,
        metadata: { rows: parsed.length, created },
      });
      this.realtime.publish(event.id, 'tickets');
    }
    return { dryRun: opts.dryRun, totalRows: parsed.length, validRows: toCreate.length, created, rows };
  }

  /**
   * Adds guests to an event in one transaction.
   *  • a guest is unique per (organizer, e-mail) – an existing contact is reused
   *  • an e-mail already on this event is skipped, never duplicated
   *  • repeats inside the batch collapse to the first occurrence
   */
  private async createGuests(
    event: Event,
    inputs: GuestInput[],
  ): Promise<{ created: string[]; skippedExisting: string[]; duplicatesInBatch: string[] }> {
    const typeIds = new Set(
      (await this.prisma.ticketType.findMany({ where: { eventId: event.id }, select: { id: true } })).map((t) => t.id),
    );
    const unique = new Map<string, GuestInput>();
    const duplicatesInBatch: string[] = [];
    for (const input of inputs) {
      if (!typeIds.has(input.ticketTypeId)) {
        throw badRequest('VALIDATION_ERROR', 'Proveri unete podatke.', { ticketTypeId: 'Izaberi tip karte ovog događaja.' });
      }
      if (unique.has(input.email)) duplicatesInBatch.push(input.email);
      else unique.set(input.email, input);
    }
    const emails = [...unique.keys()];

    return this.prisma.$transaction(
      async (tx) => {
        const known = await tx.guest.findMany({ where: { organizerId: event.organizerId, email: { in: emails } } });
        const guestIdByEmail = new Map(known.map((g) => [g.email, g.id]));

        const newGuests: Prisma.GuestCreateManyInput[] = [];
        for (const [email, input] of unique) {
          if (guestIdByEmail.has(email)) continue;
          const id = randomUUID();
          guestIdByEmail.set(email, id);
          newGuests.push({ id, organizerId: event.organizerId, firstName: input.firstName, lastName: input.lastName, email, phone: input.phone });
        }
        if (newGuests.length > 0) await tx.guest.createMany({ data: newGuests });

        const already = await tx.eventGuest.findMany({
          where: { eventId: event.id, guestId: { in: [...guestIdByEmail.values()] } },
          select: { guestId: true },
        });
        const alreadyIds = new Set(already.map((a) => a.guestId));

        const skippedExisting: string[] = [];
        const rows: Prisma.EventGuestCreateManyInput[] = [];
        for (const [email, input] of unique) {
          const guestId = guestIdByEmail.get(email) as string;
          if (alreadyIds.has(guestId)) {
            skippedExisting.push(email);
            continue;
          }
          rows.push({
            id: randomUUID(),
            eventId: event.id,
            guestId,
            ticketTypeId: input.ticketTypeId,
            ticketQuantity: input.ticketQuantity,
            notes: input.notes,
          });
        }
        if (rows.length > 0) await tx.eventGuest.createMany({ data: rows });
        return { created: rows.map((r) => r.id as string), skippedExisting, duplicatesInBatch };
      },
      { timeout: 60_000 },
    );
  }

  private async assertTicketType(eventId: string, ticketTypeId: string): Promise<void> {
    const type = await this.prisma.ticketType.findFirst({ where: { id: ticketTypeId, eventId }, select: { id: true } });
    if (!type) throw badRequest('VALIDATION_ERROR', 'Proveri unete podatke.', { ticketTypeId: 'Izaberi tip karte ovog događaja.' });
  }

  private async row(eventId: string, eventGuestId: string): Promise<GuestRowDto> {
    const eg = await this.prisma.eventGuest.findFirst({ where: { id: eventGuestId, eventId }, include: rowInclude });
    if (!eg) throw notFound('Gost nije pronađen.');
    return toGuestRow(eg);
  }
}
