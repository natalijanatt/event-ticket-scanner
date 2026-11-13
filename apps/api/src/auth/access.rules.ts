import type { RequestUser } from './auth.types';

// Pure authorization rules – no I/O, so they are trivially unit-testable.
// AccessService applies them after loading the data they need.

type Principal = Pick<RequestUser, 'role' | 'memberships'>;

/** Organizers a user may administer (create events, manage guests, …). `null` = all. */
export function manageableOrganizerIds(user: Principal): string[] | null {
  if (user.role === 'SUPER_ADMIN') return null;
  if (user.role !== 'ORGANIZER') return [];
  return user.memberships.filter((m) => m.role !== 'SCANNER').map((m) => m.organizerId);
}

export function canManageOrganizer(user: Principal, organizerId: string): boolean {
  const ids = manageableOrganizerIds(user);
  return ids === null || ids.includes(organizerId);
}

/** Full administrative access to an event = administrative access to its organizer. */
export function canManageEvent(user: Principal, event: { organizerId: string }): boolean {
  return canManageOrganizer(user, event.organizerId);
}

/**
 * Scanning access: administrators of the event's organizer, or a SCANNER
 * explicitly assigned to that event (and still a member of the organizer).
 */
export function canScanEvent(user: Principal, event: { organizerId: string }, isAssignedStaff: boolean): boolean {
  if (canManageEvent(user, event)) return true;
  if (user.role !== 'SCANNER') return false;
  return isAssignedStaff && user.memberships.some((m) => m.organizerId === event.organizerId);
}
