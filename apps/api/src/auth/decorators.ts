import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@event-platform/shared';
import type { RequestUser } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without authentication. Everything else requires a session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restricts a route (or controller) to the given platform roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Admin-panel roles: everything except entrance staff. */
export const AdminOnly = () => Roles('SUPER_ADMIN', 'ORGANIZER');

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  return ctx.switchToHttp().getRequest().user as RequestUser;
});
