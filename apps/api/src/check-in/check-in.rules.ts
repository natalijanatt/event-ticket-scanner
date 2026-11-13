import type { ScanResult } from '@event-platform/shared';

// Pure decision rules of the check-in flow (unit-tested without a database).

/** An event without an explicit end is assumed to last this long. */
export const DEFAULT_EVENT_DURATION_HOURS = 12;
/** Tickets are still accepted this long after the event's end (late arrivals, long queues). */
export const SCAN_GRACE_HOURS_AFTER_END = 3;

export function scanningClosesAt(event: { startsAt: Date; endsAt: Date | null }): Date {
  const end = event.endsAt ?? new Date(event.startsAt.getTime() + DEFAULT_EVENT_DURATION_HOURS * 3_600_000);
  return new Date(end.getTime() + SCAN_GRACE_HOURS_AFTER_END * 3_600_000);
}

/** Event-level gate, evaluated before any ticket is touched. Null = scanning allowed. */
export function eventGate(event: { status: string; startsAt: Date; endsAt: Date | null }, now: Date): Exclude<ScanResult, 'ADMITTED'> | null {
  if (event.status === 'COMPLETED') return 'EVENT_ENDED';
  if (event.status !== 'ACTIVE') return 'EVENT_NOT_ACTIVE';
  if (now > scanningClosesAt(event)) return 'EVENT_ENDED';
  return null;
}

export interface TicketSnapshot {
  eventId: string;
  eventOrganizerId: string;
  status: 'VALID' | 'USED' | 'REVOKED';
  expiresAt: Date | null;
}

/**
 * Explains WHY the atomic update matched no row. Runs after the fact and is
 * read-only, so it cannot cause a double entry – it only chooses the message.
 *
 * `null` means the ticket looks perfectly valid right now: the update lost a
 * race with a concurrent state change and may simply be retried.
 */
export function diagnoseRejection(
  ticket: TicketSnapshot | null,
  scanningEvent: { id: string; organizerId: string },
  now: Date,
): Exclude<ScanResult, 'ADMITTED'> | null {
  if (!ticket) return 'INVALID';
  if (ticket.eventId !== scanningEvent.id) {
    // "Wrong event" is only revealed inside the same organizer. A ticket of a
    // different organizer is indistinguishable from a made-up code.
    return ticket.eventOrganizerId === scanningEvent.organizerId ? 'WRONG_EVENT' : 'INVALID';
  }
  if (ticket.status === 'REVOKED') return 'REVOKED';
  if (ticket.status === 'USED') return 'ALREADY_USED';
  if (ticket.expiresAt && ticket.expiresAt <= now) return 'EXPIRED';
  return null;
}
