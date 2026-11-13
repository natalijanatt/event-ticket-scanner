import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { organizerInputSchema, type OrganizerDto, type OrganizerInput } from '@event-platform/shared';
import { memoryStorage } from 'multer';
import { AuditService } from '../audit/audit.service';
import { manageableOrganizerIds } from '../auth/access.rules';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser, Roles } from '../auth/decorators';
import { badRequest } from '../common/errors';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { AppConfig } from '../config/app-config';
import { detectImageExtension } from '../events/events.service';
import { GuestsModule } from '../guests/guests.module';
import { RetentionService } from '../guests/retention.service';
import { PrismaService } from '../prisma/prisma.service';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class OrganizersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly retention: RetentionService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
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
      logoUrl: o.logoUrl,
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

  async setLogo(user: RequestUser, organizerId: string, file: Express.Multer.File | undefined): Promise<OrganizerDto> {
    this.access.assertOrganizer(user, organizerId);
    if (!file) throw badRequest('FILE_REQUIRED', 'Izaberi sliku.');
    // Trust the bytes, not the client-supplied MIME type or file name.
    const ext = detectImageExtension(file.buffer);
    if (!ext) throw badRequest('UNSUPPORTED_IMAGE', 'Podržani formati slike su JPG, PNG i WebP.');

    const dir = resolve(process.cwd(), this.config.uploadDir, 'logos');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    writeFileSync(join(dir, name), file.buffer);

    const previous = await this.prisma.organizer.findUniqueOrThrow({ where: { id: organizerId }, select: { logoUrl: true } });
    await this.prisma.organizer.update({ where: { id: organizerId }, data: { logoUrl: `/uploads/logos/${name}` } });
    this.deleteLogoFile(previous.logoUrl);
    return this.one(user, organizerId);
  }

  async removeLogo(user: RequestUser, organizerId: string): Promise<OrganizerDto> {
    this.access.assertOrganizer(user, organizerId);
    const previous = await this.prisma.organizer.findUniqueOrThrow({ where: { id: organizerId }, select: { logoUrl: true } });
    await this.prisma.organizer.update({ where: { id: organizerId }, data: { logoUrl: null } });
    this.deleteLogoFile(previous.logoUrl);
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

  private deleteLogoFile(url: string | null): void {
    if (!url || !/^\/uploads\/logos\/[0-9a-f-]+\.(jpg|png|webp)$/.test(url)) return;
    const path = resolve(process.cwd(), this.config.uploadDir, 'logos', url.split('/').pop() as string);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* a stale file is harmless */
    }
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

  @Post(':organizerId/logo')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  setLogo(
    @CurrentUser() user: RequestUser,
    @Param('organizerId', Uuid) organizerId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<OrganizerDto> {
    return this.organizers.setLogo(user, organizerId, file);
  }

  @Delete(':organizerId/logo')
  removeLogo(@CurrentUser() user: RequestUser, @Param('organizerId', Uuid) organizerId: string): Promise<OrganizerDto> {
    return this.organizers.removeLogo(user, organizerId);
  }

  @Post(':organizerId/retention/run')
  @HttpCode(200)
  runRetention(@CurrentUser() user: RequestUser, @Param('organizerId', Uuid) organizerId: string): Promise<{ anonymized: number }> {
    return this.organizers.runRetention(user, organizerId);
  }
}

@Module({ imports: [GuestsModule], controllers: [OrganizersController], providers: [OrganizersService] })
export class OrganizersModule {}
