import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, ChangePasswordInput, UpdateProfileInput } from '@event-platform/shared';
import { randomToken, sha256Hex } from '../common/crypto';
import { badRequest, conflict, unauthorized } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from './auth.types';
import { PasswordService } from './password.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

/** Tolerance for two tabs refreshing at the same moment (see `refresh`). */
const ROTATION_GRACE_MS = 20_000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly config: AppConfig,
    private readonly email: EmailService,
  ) {}

  async login(email: string, password: string, userAgent?: string): Promise<{ tokens: IssuedTokens; user: AuthUser }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await this.passwords.verifyDummy(password);
      throw unauthorized('Pogrešna email adresa ili lozinka.', 'INVALID_CREDENTIALS');
    }
    const ok = await this.passwords.verify(user.passwordHash, password);
    // Same message for a wrong password and a deactivated account.
    if (!ok || !user.isActive) throw unauthorized('Pogrešna email adresa ili lozinka.', 'INVALID_CREDENTIALS');

    const tokens = await this.createSession(user.id, user.role, randomUUID(), userAgent);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { tokens, user: await this.profile(user.id) };
  }

  /**
   * Refresh-token rotation with reuse detection.
   *  • valid token      → rotate: old session is marked, a new one is issued
   *  • token reused long after rotation → theft assumed → whole family revoked
   *  • token reused within a few seconds → a parallel tab already rotated;
   *    answer 409 so the client simply retries with the fresh cookies
   */
  async refresh(refreshToken: string | undefined, userAgent?: string): Promise<IssuedTokens> {
    if (!refreshToken) throw unauthorized('Sesija je istekla. Prijavi se ponovo.', 'SESSION_EXPIRED');
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256Hex(refreshToken) },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) {
      throw unauthorized('Sesija je istekla. Prijavi se ponovo.', 'SESSION_EXPIRED');
    }
    if (session.rotatedAt) {
      if (now.getTime() - session.rotatedAt.getTime() <= ROTATION_GRACE_MS) {
        throw conflict('ALREADY_ROTATED', 'Sesija je već obnovljena.');
      }
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: now } });
      this.logger.warn(`Refresh token reuse detected – session family revoked (user ${session.userId})`);
      throw unauthorized('Sesija je istekla. Prijavi se ponovo.', 'SESSION_EXPIRED');
    }

    // Atomic claim: only one concurrent request can rotate this token.
    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: now },
    });
    if (claimed.count === 0) throw conflict('ALREADY_ROTATED', 'Sesija je već obnovljena.');

    return this.createSession(session.userId, session.user.role, session.familyId, userAgent);
  }

  /** Revokes every session of the login the given refresh token belongs to. */
  async logout(user: RequestUser | undefined, refreshToken: string | undefined): Promise<void> {
    const now = new Date();
    if (user) {
      await this.prisma.session.updateMany({ where: { familyId: user.familyId, revokedAt: null }, data: { revokedAt: now } });
      return;
    }
    if (!refreshToken) return;
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256Hex(refreshToken) } });
    if (session) {
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: now } });
    }
  }

  async profile(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { organizer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } } },
    });
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizers: user.memberships.map((m) => ({ id: m.organizer.id, name: m.organizer.name, role: m.role })),
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<AuthUser> {
    await this.prisma.user.update({ where: { id: userId }, data: input });
    return this.profile(userId);
  }

  /** Always resolves the same way, whether or not the account exists. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 150));
      return;
    }
    const token = randomToken(32);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      }),
    ]);
    const url = `${this.config.publicAppUrl}/reset-password?token=${token}`;
    try {
      await this.email.sendPasswordReset({ to: user.email, firstName: user.firstName, resetUrl: url });
    } catch (err) {
      this.logger.error(`Password reset e-mail failed for user ${user.id}: ${(err as Error).message}`);
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw badRequest('RESET_TOKEN_INVALID', 'Link za promenu lozinke je nevažeći ili je istekao. Zatraži novi.');
    }
    // Single-use: the claim is atomic so a token cannot be replayed concurrently.
    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw badRequest('RESET_TOKEN_INVALID', 'Link za promenu lozinke je nevažeći ili je istekao. Zatraži novi.');
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      // A password change ends every existing session.
      this.prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async changePassword(user: RequestUser, input: ChangePasswordInput): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(record.passwordHash, input.currentPassword))) {
      throw badRequest('WRONG_PASSWORD', 'Trenutna lozinka nije tačna.', { currentPassword: 'Trenutna lozinka nije tačna.' });
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Other devices are signed out; the current login stays active.
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null, familyId: { not: user.familyId } },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Revokes all sessions of a user (deactivation, admin password reset). */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async createSession(userId: string, role: string, familyId: string, userAgent?: string): Promise<IssuedTokens> {
    const refreshToken = randomToken(48);
    const refreshMaxAgeMs = this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    const accessMaxAgeMs = this.config.accessTokenTtlMinutes * 60 * 1000;
    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: sha256Hex(refreshToken),
        userAgent: userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + refreshMaxAgeMs),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role, sid: session.id },
      { expiresIn: `${this.config.accessTokenTtlMinutes}m` },
    );
    return { accessToken, refreshToken, accessMaxAgeMs, refreshMaxAgeMs };
  }
}
