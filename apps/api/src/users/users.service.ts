import { Injectable } from '@nestjs/common';
import type { StaffCreateInput, StaffDto, StaffUpdateInput, UserCreateInput, UserDto, UserUpdateInput } from '@event-platform/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { manageableOrganizerIds } from '../auth/access.rules';
import { AccessService } from '../auth/access.service';
import { AuthService } from '../auth/auth.service';
import type { RequestUser } from '../auth/auth.types';
import { badRequest, conflict, notFound } from '../common/errors';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';

const staffInclude = {
  memberships: { where: { role: 'SCANNER' }, include: { organizer: { select: { id: true, name: true } } } },
  eventStaff: { include: { event: { select: { id: true, name: true, organizerId: true, archivedAt: true } } } },
} satisfies Prisma.UserInclude;

type StaffRow = Prisma.UserGetPayload<{ include: typeof staffInclude }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  // ── Platform users (SUPER_ADMIN) ──────────────────────────────────────────

  async listUsers(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      include: { memberships: { include: { organizer: { select: { id: true, name: true } } } } },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      take: 1000,
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      organizers: u.memberships.map((m) => m.organizer),
    }));
  }

  async createUser(actor: RequestUser, input: UserCreateInput): Promise<UserDto> {
    if (input.role !== 'SUPER_ADMIN' && !input.organizerId) {
      throw badRequest('VALIDATION_ERROR', 'Proveri unete podatke.', { organizerId: 'Izaberi organizatora.' });
    }
    await this.assertEmailFree(input.email);
    if (input.organizerId) {
      const organizer = await this.prisma.organizer.findUnique({ where: { id: input.organizerId }, select: { id: true } });
      if (!organizer) throw badRequest('VALIDATION_ERROR', 'Proveri unete podatke.', { organizerId: 'Organizator ne postoji.' });
    }
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        passwordHash: await this.passwords.hash(input.password),
        memberships:
          input.role !== 'SUPER_ADMIN' && input.organizerId
            ? { create: { organizerId: input.organizerId, role: input.role === 'SCANNER' ? 'SCANNER' : 'OWNER' } }
            : undefined,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      organizerId: input.organizerId ?? null,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      metadata: { role: input.role },
    });
    return (await this.listUsers()).find((u) => u.id === user.id) as UserDto;
  }

  async updateUser(actor: RequestUser, userId: string, input: UserUpdateInput): Promise<UserDto> {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw notFound('Korisnik nije pronađen.');
    if (target.id === actor.id && input.isActive === false) {
      throw conflict('CANNOT_DEACTIVATE_SELF', 'Ne možeš deaktivirati sopstveni nalog.');
    }
    await this.applyUserUpdate(target.id, input);
    await this.audit.log({ actorId: actor.id, organizerId: null, action: 'user.update', entityType: 'user', entityId: target.id });
    return (await this.listUsers()).find((u) => u.id === target.id) as UserDto;
  }

  // ── Entrance staff (ORGANIZER manages their own scanners) ─────────────────

  async listStaff(actor: RequestUser): Promise<StaffDto[]> {
    const ids = manageableOrganizerIds(actor);
    const staff = await this.prisma.user.findMany({
      where: { role: 'SCANNER', memberships: { some: { role: 'SCANNER', ...(ids === null ? {} : { organizerId: { in: ids } }) } } },
      include: staffInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return staff.map((s) => this.toStaffDto(s));
  }

  async createStaff(actor: RequestUser, input: StaffCreateInput): Promise<StaffDto> {
    const organizerId = this.access.resolveOrganizerId(actor, input.organizerId);
    await this.assertEmailFree(input.email);
    const eventIds = await this.ownEventIds(organizerId, input.eventIds);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'SCANNER',
        passwordHash: await this.passwords.hash(input.password),
        memberships: { create: { organizerId, role: 'SCANNER' } },
        eventStaff: { create: eventIds.map((eventId) => ({ eventId })) },
      },
    });
    await this.audit.log({ actorId: actor.id, organizerId, action: 'staff.create', entityType: 'user', entityId: user.id });
    return this.staffById(user.id);
  }

  async updateStaff(actor: RequestUser, staffId: string, input: StaffUpdateInput): Promise<StaffDto> {
    const { organizerId } = await this.manageableStaff(actor, staffId);
    await this.applyUserUpdate(staffId, input);
    if (input.eventIds) {
      const eventIds = await this.ownEventIds(organizerId, input.eventIds);
      await this.prisma.$transaction([
        // Only this organizer's assignments are replaced.
        this.prisma.eventStaff.deleteMany({ where: { userId: staffId, event: { organizerId } } }),
        this.prisma.eventStaff.createMany({ data: eventIds.map((eventId) => ({ eventId, userId: staffId })), skipDuplicates: true }),
      ]);
    }
    await this.audit.log({ actorId: actor.id, organizerId, action: 'staff.update', entityType: 'user', entityId: staffId });
    return this.staffById(staffId);
  }

  async eventStaff(actor: RequestUser, eventId: string): Promise<{ assignedIds: string[]; staff: StaffDto[] }> {
    const event = await this.access.eventForManage(actor, eventId);
    const [assigned, staff] = await Promise.all([
      this.prisma.eventStaff.findMany({ where: { eventId: event.id }, select: { userId: true } }),
      this.prisma.user.findMany({
        where: { role: 'SCANNER', memberships: { some: { role: 'SCANNER', organizerId: event.organizerId } } },
        include: staffInclude,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
    ]);
    return { assignedIds: assigned.map((a) => a.userId), staff: staff.map((s) => this.toStaffDto(s)) };
  }

  async setEventStaff(actor: RequestUser, eventId: string, userIds: string[]): Promise<{ assignedIds: string[] }> {
    const event = await this.access.eventForManage(actor, eventId);
    // Only scanners that belong to the event's organizer can be assigned.
    const eligible = await this.prisma.user.findMany({
      where: { id: { in: userIds }, role: 'SCANNER', memberships: { some: { role: 'SCANNER', organizerId: event.organizerId } } },
      select: { id: true },
    });
    const ids = eligible.map((e) => e.id);
    await this.prisma.$transaction([
      this.prisma.eventStaff.deleteMany({ where: { eventId: event.id, userId: { notIn: ids } } }),
      this.prisma.eventStaff.createMany({ data: ids.map((userId) => ({ eventId: event.id, userId })), skipDuplicates: true }),
    ]);
    await this.audit.log({
      actorId: actor.id,
      organizerId: event.organizerId,
      action: 'event.staff',
      entityType: 'event',
      entityId: event.id,
      metadata: { assigned: ids.length },
    });
    return { assignedIds: ids };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async applyUserUpdate(userId: string, input: UserUpdateInput): Promise<void> {
    const data: Prisma.UserUpdateInput = { firstName: input.firstName, lastName: input.lastName, isActive: input.isActive };
    if (input.password) data.passwordHash = await this.passwords.hash(input.password);
    await this.prisma.user.update({ where: { id: userId }, data });
    // Deactivation or an admin-set password ends the user's sessions at once.
    if (input.isActive === false || input.password) await this.auth.revokeAllSessions(userId);
  }

  /** Confirms the target is a scanner of an organizer the actor administers. */
  private async manageableStaff(actor: RequestUser, staffId: string): Promise<{ organizerId: string }> {
    const ids = manageableOrganizerIds(actor);
    const membership = await this.prisma.organizerMembership.findFirst({
      where: { userId: staffId, role: 'SCANNER', user: { role: 'SCANNER' }, ...(ids === null ? {} : { organizerId: { in: ids } }) },
      select: { organizerId: true },
    });
    if (!membership) throw notFound('Član osoblja nije pronađen.');
    return membership;
  }

  private async ownEventIds(organizerId: string, eventIds: string[]): Promise<string[]> {
    if (eventIds.length === 0) return [];
    const events = await this.prisma.event.findMany({ where: { id: { in: eventIds }, organizerId }, select: { id: true } });
    return events.map((e) => e.id);
  }

  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw badRequest('EMAIL_IN_USE', 'Proveri unete podatke.', { email: 'Korisnik sa ovom email adresom već postoji.' });
  }

  private async staffById(id: string): Promise<StaffDto> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id }, include: staffInclude });
    return this.toStaffDto(row);
  }

  private toStaffDto(s: StaffRow): StaffDto {
    const membership = s.memberships[0];
    return {
      id: s.id,
      email: s.email,
      firstName: s.firstName,
      lastName: s.lastName,
      isActive: s.isActive,
      lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
      organizerId: membership?.organizer.id ?? '',
      organizerName: membership?.organizer.name ?? '',
      events: s.eventStaff
        .filter((es) => es.event.organizerId === membership?.organizer.id && !es.event.archivedAt)
        .map((es) => ({ id: es.event.id, name: es.event.name })),
    };
  }
}
