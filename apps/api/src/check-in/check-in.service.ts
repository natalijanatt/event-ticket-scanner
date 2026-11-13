import { Injectable } from '@nestjs/common';
import {
  extractTicketToken,
  SCAN_RESULT_TITLES,
  type CheckInInput,
  type CheckInResponse,
  type ScanMethod,
  type ScanResult,
} from '@event-platform/shared';
import { Prisma, type Event } from '@prisma/client';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { RealtimeService } from '../common/realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketCryptoService } from '../tickets/ticket-crypto.service';
import { diagnoseRejection, eventGate } from './check-in.rules';

class CapacityReachedError extends Error {}

type Lookup = { kind: 'token'; tokenHash: string } | { kind: 'id'; ticketId: string };

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly crypto: TicketCryptoService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Validates a ticket and registers the entry.
   *
   * The whole decision is ONE conditional UPDATE: PostgreSQL row-locks the
   * ticket, so when several phones scan the same QR code at the same instant
   * exactly one statement finds `status = 'VALID'` and returns a row. Every
   * other one waits for the lock, re-evaluates the WHERE clause against the
   * committed row, matches nothing, and is reported as "already used".
   * There is no read-then-write window anywhere in this path.
   */
  async checkIn(user: RequestUser, eventId: string, input: CheckInInput): Promise<CheckInResponse> {
    const event = await this.access.eventForScan(user, eventId);
    const method: ScanMethod = input.ticketId ? 'MANUAL' : 'QR';
    const now = new Date();

    let lookup: Lookup;
    if (input.ticketId) {
      lookup = { kind: 'id', ticketId: input.ticketId };
    } else {
      const token = extractTicketToken(input.token ?? '');
      if (!token) return this.reject(event, user, method, 'INVALID', null, 'malformed-code');
      lookup = { kind: 'token', tokenHash: this.crypto.hashToken(token) };
    }

    const gate = eventGate(event, now);
    if (gate) return this.reject(event, user, method, gate, null, `event-status:${event.status}`);

    for (let attempt = 0; attempt < 2; attempt++) {
      let admittedId: string | null;
      try {
        admittedId = await this.admit(event, user, lookup, method);
      } catch (err) {
        if (err instanceof CapacityReachedError) return this.reject(event, user, method, 'CAPACITY_REACHED', null, 'capacity');
        throw err;
      }
      if (admittedId) {
        this.realtime.publish(event.id, 'check-in');
        return this.respond('ADMITTED', admittedId);
      }

      // Nothing was updated – find out why (read-only).
      const ticket = await this.prisma.ticket.findUnique({
        where: lookup.kind === 'token' ? { tokenHash: lookup.tokenHash } : { id: lookup.ticketId },
        select: { id: true, eventId: true, status: true, expiresAt: true, event: { select: { organizerId: true } } },
      });
      const reason = diagnoseRejection(
        ticket ? { eventId: ticket.eventId, eventOrganizerId: ticket.event.organizerId, status: ticket.status, expiresAt: ticket.expiresAt } : null,
        event,
        new Date(),
      );
      if (reason) {
        const sameEvent = ticket?.eventId === event.id;
        return this.reject(event, user, method, reason, sameEvent ? (ticket?.id ?? null) : null);
      }
      // reason === null: the ticket is valid again (e.g. state changed mid-flight) → retry once.
    }
    return this.reject(event, user, method, 'INVALID', null, 'unresolved-race');
  }

  /** The atomic part. Returns the ticket id on success, null when no row matched. */
  private admit(event: Event, user: RequestUser, lookup: Lookup, method: ScanMethod): Promise<string | null> {
    const tickets = this.prisma.ident('tickets');
    const events = this.prisma.ident('events');
    const status = this.prisma.ident('TicketStatus');
    const match = lookup.kind === 'token' ? Prisma.sql`token_hash = ${lookup.tokenHash}` : Prisma.sql`id = ${lookup.ticketId}::uuid`;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE ${tickets}
           SET status = 'USED'::${status},
               used_at = NOW(),
               scanned_by_id = ${user.id}::uuid,
               updated_at = NOW()
         WHERE ${match}
           AND event_id = ${event.id}::uuid
           AND status = 'VALID'::${status}
           AND used_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING id`);
      if (updated.length === 0) return null;
      const ticketId = updated[0].id;

      // Capacity is enforced with the same technique: a conditional increment
      // of the event's counter. If the venue is full the whole transaction –
      // including the ticket update above – rolls back.
      const counted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE ${events}
           SET checked_in_count = checked_in_count + 1
         WHERE id = ${event.id}::uuid
           AND (enforce_capacity = FALSE OR capacity IS NULL OR checked_in_count < capacity)
        RETURNING id`);
      if (counted.length === 0) throw new CapacityReachedError();

      // The audit record commits or rolls back together with the entry.
      await tx.scanLog.create({ data: { eventId: event.id, ticketId, scannerId: user.id, result: 'ADMITTED', method } });
      return ticketId;
    });
  }

  private async reject(
    event: Event,
    user: RequestUser,
    method: ScanMethod,
    result: Exclude<ScanResult, 'ADMITTED'>,
    ticketId: string | null,
    reason?: string,
  ): Promise<CheckInResponse> {
    await this.prisma.scanLog.create({ data: { eventId: event.id, ticketId, scannerId: user.id, result, method, reason } });
    return this.respond(result, ticketId);
  }

  /**
   * Builds the scanner response. Ticket details are included only for a
   * ticket of the scanned event; otherwise the door staff learn nothing
   * beyond the verdict.
   */
  private async respond(result: ScanResult, ticketId: string | null): Promise<CheckInResponse> {
    const response: CheckInResponse = { result, title: SCAN_RESULT_TITLES[result], scannedAt: new Date().toISOString(), ticket: null };
    if (!ticketId) return response;
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        reference: true,
        usedAt: true,
        guest: { select: { firstName: true, lastName: true } },
        ticketType: { select: { id: true, name: true, color: true, instructions: true } },
      },
    });
    if (ticket) {
      response.ticket = {
        reference: ticket.reference,
        guestName: `${ticket.guest.firstName} ${ticket.guest.lastName}`.trim(),
        ticketType: ticket.ticketType,
        usedAt: ticket.usedAt?.toISOString() ?? null,
      };
    }
    return response;
  }
}
