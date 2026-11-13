import { canManageEvent, canManageOrganizer, canScanEvent, manageableOrganizerIds } from './access.rules';
import type { RequestUser } from './auth.types';

type Principal = Pick<RequestUser, 'role' | 'memberships'>;

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const eventA = { organizerId: ORG_A };
const eventB = { organizerId: ORG_B };

const superAdmin: Principal = { role: 'SUPER_ADMIN', memberships: [] };
const organizerA: Principal = { role: 'ORGANIZER', memberships: [{ organizerId: ORG_A, role: 'OWNER' }] };
const memberA: Principal = { role: 'ORGANIZER', memberships: [{ organizerId: ORG_A, role: 'MEMBER' }] };
const scannerA: Principal = { role: 'SCANNER', memberships: [{ organizerId: ORG_A, role: 'SCANNER' }] };
const orphanOrganizer: Principal = { role: 'ORGANIZER', memberships: [] };

describe('event ownership rules', () => {
  it('lets a super admin manage every organizer', () => {
    expect(manageableOrganizerIds(superAdmin)).toBeNull();
    expect(canManageEvent(superAdmin, eventA)).toBe(true);
    expect(canManageEvent(superAdmin, eventB)).toBe(true);
  });

  it('lets an organizer manage only their own organizer', () => {
    expect(canManageEvent(organizerA, eventA)).toBe(true);
    expect(canManageEvent(memberA, eventA)).toBe(true);
    expect(canManageEvent(organizerA, eventB)).toBe(false);
    expect(canManageOrganizer(organizerA, ORG_B)).toBe(false);
  });

  it('gives an organizer without a membership nothing', () => {
    expect(manageableOrganizerIds(orphanOrganizer)).toEqual([]);
    expect(canManageEvent(orphanOrganizer, eventA)).toBe(false);
  });

  it('never lets a scanner manage an event, even in their own organizer', () => {
    expect(canManageEvent(scannerA, eventA)).toBe(false);
    expect(manageableOrganizerIds(scannerA)).toEqual([]);
  });

  it('does not treat a SCANNER membership as admin rights for an ORGANIZER-role user', () => {
    const mixed: Principal = { role: 'ORGANIZER', memberships: [{ organizerId: ORG_A, role: 'SCANNER' }] };
    expect(canManageEvent(mixed, eventA)).toBe(false);
  });
});

describe('scanning rules', () => {
  it('allows event administrators to scan without an assignment', () => {
    expect(canScanEvent(organizerA, eventA, false)).toBe(true);
    expect(canScanEvent(superAdmin, eventB, false)).toBe(true);
  });

  it('allows a scanner only on events they are assigned to', () => {
    expect(canScanEvent(scannerA, eventA, true)).toBe(true);
    expect(canScanEvent(scannerA, eventA, false)).toBe(false);
  });

  it('rejects an assignment that crosses organizers', () => {
    // A stale event_staff row must not outlive the organizer membership.
    expect(canScanEvent(scannerA, eventB, true)).toBe(false);
  });

  it("rejects another organizer's administrator", () => {
    expect(canScanEvent(organizerA, eventB, false)).toBe(false);
  });
});
