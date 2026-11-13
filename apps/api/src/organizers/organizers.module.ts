import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import { organizerInputSchema, type OrganizerDto, type OrganizerInput } from '@event-platform/shared';
import { AuditService } from '../audit/audit.service';
import { manageableOrganizerIds } from '../auth/access.rules';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser, Roles } from '../auth/decorators';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { GuestsModule } from '../guests/guests.module';
import { RetentionService } from '../guests/retention.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly retention: RetentionService,
    private readonly audit: AuditService,
  ) {}

  /** SUPER_ADMIN sees every organizer; an organizer sees only their own. */
  async list(user: RequestUser): Promise<OrganizerDto[]> {
    const ids = manageableOrganizerIds(user);
    const organizers = await this.prisma.organizer.findMany({
      where: ids === null ? {} : { id: { in: ids } },
      include: { _count: { select: { memberships: true, events: true } } },
      orderBy: { name: 'asc' },
    });
    return organizers.map((o) => ({
      id: o.id,
      name: o.name,
      contactEmail: o.contactEmail,
      retentionDays: o.retentionDays,
      createdAt: o.createdAt.toISOString(),
      memberCount: o._count.memberships,
      eventCount: o._count.events,
    }));
  }

  async create(user: RequestUser, input: OrganizerInput): Promise<OrganizerDto> {
    const created = await this.prisma.organizer.create({ data: input });
    await this.audit.log({ actorId: user.id, organizerId: created.id, action: 'organizer.create', entityType: 'organizer', entityId: created.id });
    return this.one(user, created.id);
  }

  async update(user: RequestUser, organizerId: string, input: OrganizerInput): Promise<OrganizerDto> {
    this.access.assertOrganizer(user, organizerId);
    await this.prisma.organizer.update({ where: { id: organizerId }, data: input });
    return this.one(user, organizerId);
  }

  async runRetention(user: RequestUser, organizerId: string): Promise<{ anonymized: number }> {
    this.access.assertOrganizer(user, organizerId);
    const anonymized = await this.retention.run(organizerId);
    await this.audit.log({
      actorId: user.id,
      organizerId,
      action: 'retention.run',
      entityType: 'organizer',
      entityId: organizerId,
      metadata: { anonymized },
    });
    return { anonymized };
  }

  private async one(user: RequestUser, id: string): Promise<OrganizerDto> {
    const all = await this.list(user);
    return all.find((o) => o.id === id) as OrganizerDto;
  }
}

@AdminOnly()
@Controller('organizers')
export class OrganizersController {
  constructor(private readonly organizers: OrganizersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<OrganizerDto[]> {
    return this.organizers.list(user);
  }

  @Roles('SUPER_ADMIN')
  @Post()
  create(@CurrentUser() user: RequestUser, @Body(zod(organizerInputSchema)) body: OrganizerInput): Promise<OrganizerDto> {
    return this.organizers.create(user, body);
  }

  @Patch(':organizerId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('organizerId', Uuid) organizerId: string,
    @Body(zod(organizerInputSchema)) body: OrganizerInput,
  ): Promise<OrganizerDto> {
    return this.organizers.update(user, organizerId, body);
  }

  @Post(':organizerId/retention/run')
  @HttpCode(200)
  runRetention(@CurrentUser() user: RequestUser, @Param('organizerId', Uuid) organizerId: string): Promise<{ anonymized: number }> {
    return this.organizers.runRetention(user, organizerId);
  }
}

@Module({ imports: [GuestsModule], controllers: [OrganizersController], providers: [OrganizersService] })
export class OrganizersModule {}
