import { diagnoseRejection, eventGate, scanningClosesAt, type TicketSnapshot } from './check-in.rules';

const event = { id: 'event-1', organizerId: 'org-1' };
const now = new Date('2026-11-21T23:30:00Z');

const ticket = (over: Partial<TicketSnapshot> = {}): TicketSnapshot => ({
  eventId: 'event-1',
  eventOrganizerId: 'org-1',
  status: 'VALID',
  expiresAt: null,
  ...over,
});

describe('diagnoseRejection', () => {
  it('reports an unknown token as INVALID', () => {
    expect(diagnoseRejection(null, event, now)).toBe('INVALID');
  });

  it('reports a ticket of another event of the SAME organizer as WRONG_EVENT', () => {
    expect(diagnoseRejection(ticket({ eventId: 'event-2' }), event, now)).toBe('WRONG_EVENT');
  });

  it("hides another organizer's ticket behind INVALID (no cross-tenant leak)", () => {
    expect(diagnoseRejection(ticket({ eventId: 'event-9', eventOrganizerId: 'org-2' }), event, now)).toBe('INVALID');
  });

  it('reports revoked and used tickets', () => {
    expect(diagnoseRejection(ticket({ status: 'REVOKED' }), event, now)).toBe('REVOKED');
    expect(diagnoseRejection(ticket({ status: 'USED' }), event, now)).toBe('ALREADY_USED');
  });

  it('prefers REVOKED/USED over EXPIRED', () => {
    const past = new Date(now.getTime() - 1000);
    expect(diagnoseRejection(ticket({ status: 'REVOKED', expiresAt: past }), event, now)).toBe('REVOKED');
    expect(diagnoseRejection(ticket({ status: 'USED', expiresAt: past }), event, now)).toBe('ALREADY_USED');
  });

  describe('ticket expiration', () => {
    it('rejects a ticket whose expiry has passed', () => {
      expect(diagnoseRejection(ticket({ expiresAt: new Date(now.getTime() - 1) }), event, now)).toBe('EXPIRED');
    });

    it('treats the exact expiry instant as expired', () => {
      expect(diagnoseRejection(ticket({ expiresAt: new Date(now) }), event, now)).toBe('EXPIRED');
    });

    it('accepts a ticket that expires in the future or never', () => {
      expect(diagnoseRejection(ticket({ expiresAt: new Date(now.getTime() + 1000) }), event, now)).toBeNull();
      expect(diagnoseRejection(ticket(), event, now)).toBeNull();
    });
  });
});

describe('eventGate', () => {
  const startsAt = new Date('2026-11-21T22:00:00Z');
  const endsAt = new Date('2026-11-22T04:00:00Z');

  it('allows scanning for an active event, including before doors open', () => {
    expect(eventGate({ status: 'ACTIVE', startsAt, endsAt }, new Date('2026-11-21T18:00:00Z'))).toBeNull();
    expect(eventGate({ status: 'ACTIVE', startsAt, endsAt }, now)).toBeNull();
  });

  it('blocks draft and cancelled events', () => {
    expect(eventGate({ status: 'DRAFT', startsAt, endsAt }, now)).toBe('EVENT_NOT_ACTIVE');
    expect(eventGate({ status: 'CANCELLED', startsAt, endsAt }, now)).toBe('EVENT_NOT_ACTIVE');
  });

  it('blocks completed events and scans after the grace period', () => {
    expect(eventGate({ status: 'COMPLETED', startsAt, endsAt }, now)).toBe('EVENT_ENDED');
    expect(eventGate({ status: 'ACTIVE', startsAt, endsAt }, new Date('2026-11-22T06:59:00Z'))).toBeNull();
    expect(eventGate({ status: 'ACTIVE', startsAt, endsAt }, new Date('2026-11-22T07:01:00Z'))).toBe('EVENT_ENDED');
  });

  it('assumes a 12-hour event when no end time is set', () => {
    expect(scanningClosesAt({ startsAt, endsAt: null }).toISOString()).toBe('2026-11-22T13:00:00.000Z');
  });
});
