import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@event-platform/shared';
import type { Request } from 'express';
import { forbidden, unauthorized } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, type RequestUser } from './auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/**
 * Global guard: authenticates every non-@Public route from the HTTP-only
 * access cookie and enforces @Roles.
 *
 * The JWT alone is not trusted for the whole of its lifetime – the session
 * row is checked on each request, so logout, deactivation and password
 * changes take effect immediately, and the role/memberships used for
 * authorization are always the current ones from the database.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();

    const user = await this.authenticate(req);
    if (user) req.user = user;
    if (isPublic) return true;
    if (!user) throw unauthorized();

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles && roles.length > 0 && !roles.includes(user.role)) throw forbidden();
    return true;
  }

  private async authenticate(req: Request): Promise<RequestUser | null> {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || !token) return null;
    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        familyId: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            memberships: { select: { organizerId: true, role: true } },
          },
        },
      },
    });
    if (!session || session.revokedAt || !session.user.isActive || session.user.id !== payload.sub) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      sessionId: session.id,
      familyId: session.familyId,
      memberships: session.user.memberships,
    };
  }
}
