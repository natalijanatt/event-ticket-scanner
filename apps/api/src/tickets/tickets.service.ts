import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  GenerateTicketsResult,
  Paginated,
  RevokeTicketsInput,
  RevokeTicketsResult,
  TicketLinkDto,
  TicketRowDto,
  TicketStatus,
} from '@event-platform/shared';
import { Prisma, type Event } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { conflict, notFound } from '../common/errors';
import { RealtimeService } from '../common/realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketCryptoService } from './ticket-crypto.service';

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly crypto: TicketCryptoService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    user: RequestUser,
    eventId: string,
    query: { search?: string; status?: TicketStatus; ticketTypeId?: string; page: number; pageSize: number },
  ): Promise<Paginated<TicketRowDto>> {
    const event = await this.access.eventForManage(user, eventId);
    const search = query.search?.trim();
    const where: Prisma.TicketWhereInput = {
      eventId: event.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.ticketTypeId ? { ticketTypeId: query.ticketTypeId } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search.toUpperCase() } },
              { guest: { firstName: { contains: search, mode: 'insensitive' } } },
              { guest: { lastName: { contains: search, mode: 'insensitive' } } },
              { guest: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, tickets] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        include: {
          guest: { select: { firstName: true, lastName: true, email: true } },
          ticketType: { select: { id: true, name: true, color: true } },
          scannedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: tickets.map((t) => ({
        id: t.id,
        reference: t.reference,
        status: t.status,
        ticketType: t.ticketType,
        eventGuestId: t.eventGuestId,
        guestName: `${t.guest.firstName} ${t.guest.lastName}`.trim(),
        guestEmail: t.guest.email,
        createdAt: t.createdAt.toISOString(),
        expiresAt: t.expiresAt?.toISOString() ?? null,
        usedAt: t.usedAt?.toISOString() ?? null,
        scannedByName: t.scannedBy ? `${t.scannedBy.firstName} ${t.scannedBy.lastName}`.trim() : null,
        revokedAt: t.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  async generate(user: RequestUser, eventId: string, eventGuestIds: string[]): Promise<GenerateTicketsResult> {
    const event = await this.access.eventForManage(user, eventId);
    const result = await this.prisma.$transaction((tx) => this.generateMissing(tx, event, eventGuestIds), { timeout: 30_000 });
    if (result.generated > 0) {
      this.realtime.publish(event.id, 'tickets');
      await this.audit.log({
        actorId: user.id,
        organizerId: event.organizerId,
        action: 'tickets.generate',
        entityType: 'event',
        entityId: event.id,
        metadata: { generated: result.generated, guests: result.guestsAffected },
      });
    }
    return result;
  }

  /**
   * Brings each guest up to their allocated number of tickets. Idempotent:
   * running it twice creates nothing the second time, which is exactly why
   * re-sending an invitation can never mint extra tickets.
   */
  async generateMissing(db: Db, event: Event, eventGuestIds: string[]): Promise<GenerateTicketsResult> {
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw conflict('EVENT_CLOSED', 'Događaj je završen ili otkazan — nove karte se ne mogu izdavati.');
    }
    if (eventGuestIds.length === 0) return { generated: 0, guestsAffected: 0, skippedForCapacity: 0 };

    // Row locks make "count existing tickets, then create the missing ones"
    // safe under concurrency: two simultaneous requests for the same guest
    // (double click, parallel bulk sends) run one after the other, and the
    // second one sees the first one's tickets. Ticket types are locked too,
    // so type capacity cannot be oversold. Fixed lock order → no deadlocks.
    // Must be called inside a transaction.
    await db.$queryRaw(Prisma.sql`
      SELECT id FROM ${this.prisma.ident('ticket_types')}
       WHERE event_id = ${event.id}::uuid ORDER BY id FOR UPDATE`);
    await db.$queryRaw(Prisma.sql`
      SELECT id FROM ${this.prisma.ident('event_guests')}
       WHERE event_id = ${event.id}::uuid
         AND id IN (${Prisma.join(eventGuestIds.map((id) => Prisma.sql`${id}::uuid`))})
       ORDER BY id FOR UPDATE`);

    const guests = await db.eventGuest.findMany({
      // eventId in the filter: ids from another event are silently ignored.
      where: { id: { in: eventGuestIds }, eventId: event.id },
      include: { tickets: { where: { status: { not: 'REVOKED' } }, select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const types = await db.ticketType.findMany({ where: { eventId: event.id }, select: { id: true, capacity: true } });
    const issuedByType = await db.ticket.groupBy({
      by: ['ticketTypeId'],
      where: { eventId: event.id, status: { not: 'REVOKED' } },
      _count: { _all: true },
    });
    const remaining = new Map<string, number>();
    for (const type of types) {
      const issued = issuedByType.find((i) => i.ticketTypeId === type.id)?._count._all ?? 0;
      remaining.set(type.id, type.capacity === null ? Number.POSITIVE_INFINITY : Math.max(0, type.capacity - issued));
    }

    const rows: Prisma.TicketCreateManyInput[] = [];
    let guestsAffected = 0;
    let skippedForCapacity = 0;
    for (const guest of guests) {
      const missing = guest.ticketQuantity - guest.tickets.length;
      if (missing <= 0) continue;
      const left = remaining.get(guest.ticketTypeId) ?? 0;
      const create = Math.min(missing, left);
      skippedForCapacity += missing - create;
      if (create === 0) continue;
      remaining.set(guest.ticketTypeId, left - create);
      guestsAffected++;
      for (let i = 0; i < create; i++) {
        const id = randomUUID();
        const credentials = this.crypto.createCredentials(id);
        rows.push({
          id,
          eventId: event.id,
          guestId: guest.guestId,
          eventGuestId: guest.id,
          ticketTypeId: guest.ticketTypeId,
          reference: this.crypto.createReference(),
          tokenHash: credentials.tokenHash,
          tokenCipher: credentials.tokenCipher,
        });
      }
    }
    if (rows.length > 0) await db.ticket.createMany({ data: rows });
    return { generated: rows.length, guestsAffected, skippedForCapacity };
  }

  async revoke(user: RequestUser, eventId: string, input: RevokeTicketsInput): Promise<RevokeTicketsResult> {
    const event = await this.access.eventForManage(user, eventId);
    const selectors: Prisma.TicketWhereInput[] = [];
    if (input.ticketIds?.length) selectors.push({ id: { in: input.ticketIds } });
    if (input.eventGuestIds?.length) selectors.push({ eventGuestId: { in: input.eventGuestIds } });
    // Only VALID tickets can be revoked – a used ticket stays in the attendance record.
    const result = await this.prisma.ticket.updateMany({
      where: { eventId: event.id, status: 'VALID', OR: selectors },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (result.count > 0) {
      this.realtime.publish(event.id, 'tickets');
      await this.audit.log({
        actorId: user.id,
        organizerId: event.organizerId,
        action: 'tickets.revoke',
        entityType: 'event',
        entityId: event.id,
        metadata: { revoked: result.count },
      });
    }
    return { revoked: result.count };
  }

  /** Issues a new secret for a valid ticket. The previous QR code / link stops working immediately. */
  async regenerate(user: RequestUser, eventId: string, ticketId: string): Promise<TicketLinkDto> {
    const event = await this.access.eventForManage(user, eventId);
    const credentials = this.crypto.createCredentials(ticketId);
    const result = await this.prisma.ticket.updateMany({
      where: { id: ticketId, eventId: event.id, status: 'VALID' },
      data: { tokenHash: credentials.tokenHash, tokenCipher: credentials.tokenCipher },
    });
    if (result.count === 0) {
      const exists = await this.prisma.ticket.findFirst({ where: { id: ticketId, eventId: event.id }, select: { id: true } });
      if (!exists) throw notFound('Karta nije pronađena.');
      throw conflict('TICKET_NOT_VALID', 'Samo važeća karta može dobiti novi QR kod.');
    }
    await this.audit.log({
      actorId: user.id,
      organizerId: event.organizerId,
      action: 'ticket.regenerate',
      entityType: 'ticket',
      entityId: ticketId,
    });
    return { url: this.crypto.ticketUrl(credentials.token) };
  }

  /** Reveals the ticket link to an authorized organizer (audited). */
  async link(user: RequestUser, eventId: string, ticketId: string): Promise<TicketLinkDto> {
    const event = await this.access.eventForManage(user, eventId);
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, eventId: event.id } });
    if (!ticket) throw notFound('Karta nije pronađena.');
    await this.audit.log({
      actorId: user.id,
      organizerId: event.organizerId,
      action: 'ticket.link_reveal',
      entityType: 'ticket',
      entityId: ticket.id,
    });
    return { url: this.crypto.ticketUrl(this.crypto.decrypt(ticket.tokenCipher, ticket.id)) };
  }

  async setExpiry(user: RequestUser, eventId: string, ticketId: string, expiresAt: string | null): Promise<void> {
    const event = await this.access.eventForManage(user, eventId);
    const result = await this.prisma.ticket.updateMany({
      where: { id: ticketId, eventId: event.id },
      data: { expiresAt: expiresAt ? new Date(expiresAt) : null },
    });
    if (result.count === 0) throw notFound('Karta nije pronađena.');
  }
}
