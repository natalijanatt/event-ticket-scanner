import type { MembershipRole, UserRole } from '@event-platform/shared';

/** The authenticated principal attached to every request by AuthGuard. */
export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
  sessionId: string;
  familyId: string;
  memberships: { organizerId: string; role: MembershipRole }[];
}

export const ACCESS_COOKIE = 'ep_at';
export const REFRESH_COOKIE = 'ep_rt';
export const REFRESH_COOKIE_PATH = '/api/auth';
