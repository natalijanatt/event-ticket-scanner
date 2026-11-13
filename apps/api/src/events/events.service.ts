import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { EventDto, EventInput, EventUpdateInput } from '@event-platform/shared';
import type { Event, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { badRequest, conflict } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

type EventWithOrganizer = Event & { organizer: { name: string } };

const DEFAULT_TICKET_TYPES = [
  { name: 'Regular', color: '#5B6577', sortOrder: 0 },
  { name: 'VIP', color: '#B8862B', sortOrder: 1 },
];

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async list(user: RequestUser, filter: { archived?: boolean; search?: string }): Promise<EventDto[]> {
    const where: Prisma.EventWhereInput = {
      ...this.access.manageableEventsWhere(user),
      archivedAt: filter.archived ? { not: null } : null,
      ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
    };
    const events = await this.prisma.event.findMany({
      where,
      include: { organizer: { select: { name: true } } },
      orderBy: { startsAt: 'desc' },
      take: 500,
    });
    return this.toDtos(events);
  }

  async get(user: RequestUser, eventId: string): Promise<EventDto> {
    const event = await this.access.eventForManage(user, eventId);
    return this.dtoById(event.id);
  }

  async create(user: RequestUser, input: EventInput): Promise<EventDto> {
    const organizerId = this.access.resolveOrganizerId(user, input.organizerId);
    const event = await this.prisma.event.create({
      data: {
        organizerId,
        name: input.name,
        description: input.description,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        capacity: input.capacity,
        enforceCapacity: input.enforceCapacity && input.capacity !== null,
        status: input.status,
        // Every event starts with the two most common ticket types.
        ticketTypes: { create: DEFAULT_TICKET_TYPES },
      },
    });
    await this.audit.log({ actorId: user.id, organizerId, action: 'event.create', entityType: 'event', entityId: event.id });
    return this.dtoById(event.id);
  }

  async update(user: RequestUser, eventId: string, input: EventUpdateInput): Promise<EventDto> {
    const event = await this.access.eventForManage(user, eventId);
    const startsAt = input.startsAt ? new Date(input.startsAt) : event.startsAt;
    const endsAt = input.endsAt === undefined ? event.endsAt : input.endsAt ? new Date(input.endsAt) : null;
    if (endsAt && endsAt <= startsAt) {
      throw badRequest('VALIDATION_ERROR', 'Proveri unete podatke.', { endsAt: 'Kraj događaja mora biti posle početka.' });
    }
    const capacity = input.capacity === undefined ? event.capacity : input.capacity;
    const enforceCapacity = (input.enforceCapacity ?? event.enforceCapacity) && capacity !== null;

    await this.prisma.event.update({
      where: { id: event.id },
      data: {
        name: input.name,
        description: input.description,
        startsAt,
        endsAt,
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        capacity,
        enforceCapacity,
        status: input.status,
      },
    });
    if (input.status && input.status !== event.status) {
      await this.audit.log({
        actorId: user.id,
        organizerId: event.organizerId,
        action: 'event.status',
        entityType: 'event',
        entityId: event.id,
        metadata: { from: event.status, to: input.status },
      });
    }
    return this.dtoById(event.id);
  }

  /** Copies the event's settings and ticket types – never guests or tickets. */
  async duplicate(user: RequestUser, eventId: string): Promise<EventDto> {
    const source = await this.access.eventForManage(user, eventId);
    const types = await this.prisma.ticketType.findMany({ where: { eventId: source.id }, orderBy: { sortOrder: 'asc' } });
    const copy = await this.prisma.event.create({
      data: {
        organizerId: source.organizerId,
        name: `${source.name} (kopija)`.slice(0, 120),
        description: source.description,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        venueName: source.venueName,
        venueAddress: source.venueAddress,
        coverImageUrl: null,
        capacity: source.capacity,
        enforceCapacity: source.enforceCapacity,
        status: 'DRAFT',
        ticketTypes: {
          create: types.map((t) => ({
            name: t.name,
            description: t.description,
            capacity: t.capacity,
            color: t.color,
            instructions: t.instructions,
            sortOrder: t.sortOrder,
          })),
        },
      },
    });
    return this.dtoById(copy.id);
  }

  async setArchived(user: RequestUser, eventId: string, archived: boolean): Promise<EventDto> {
    const event = await this.access.eventForManage(user, eventId);
    await this.prisma.event.update({ where: { id: event.id }, data: { archivedAt: archived ? new Date() : null } });
    return this.dtoById(event.id);
  }

  /** Hard delete is allowed only while no ticket has been issued; afterwards events are archived. */
  async remove(user: RequestUser, eventId: string): Promise<void> {
    const event = await this.access.eventForManage(user, eventId);
    const tickets = await this.prisma.ticket.count({ where: { eventId: event.id } });
    if (tickets > 0) {
      throw conflict('EVENT_HAS_TICKETS', 'Događaj sa izdatim kartama ne može biti obrisan. Arhiviraj ga umesto toga.');
    }
    await this.prisma.event.delete({ where: { id: event.id } });
    this.deleteCoverFile(event.coverImageUrl);
    await this.audit.log({ actorId: user.id, organizerId: event.organizerId, action: 'event.delete', entityType: 'event', entityId: event.id });
  }

  async setCover(user: RequestUser, eventId: string, file: Express.Multer.File | undefined): Promise<EventDto> {
    const event = await this.access.eventForManage(user, eventId);
    if (!file) throw badRequest('FILE_REQUIRED', 'Izaberi sliku.');
    // Trust the bytes, not the client-supplied MIME type or file name.
    const ext = detectImageExtension(file.buffer);
    if (!ext) throw badRequest('UNSUPPORTED_IMAGE', 'Podržani formati slike su JPG, PNG i WebP.');

    const dir = resolve(process.cwd(), this.config.uploadDir, 'covers');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    writeFileSync(join(dir, name), file.buffer);

    await this.prisma.event.update({ where: { id: event.id }, data: { coverImageUrl: `/uploads/covers/${name}` } });
    this.deleteCoverFile(event.coverImageUrl);
    return this.dtoById(event.id);
  }

  async removeCover(user: RequestUser, eventId: string): Promise<EventDto> {
    const event = await this.access.eventForManage(user, eventId);
    await this.prisma.event.update({ where: { id: event.id }, data: { coverImageUrl: null } });
    this.deleteCoverFile(event.coverImageUrl);
    return this.dtoById(event.id);
  }

  async toDtos(events: EventWithOrganizer[]): Promise<EventDto[]> {
    if (events.length === 0) return [];
    const ids = events.map((e) => e.id);
    const [guestCounts, ticketCounts] = await Promise.all([
      this.prisma.eventGuest.groupBy({ by: ['eventId'], where: { eventId: { in: ids } }, _count: { _all: true } }),
      this.prisma.ticket.groupBy({
        by: ['eventId', 'status'],
        where: { eventId: { in: ids }, status: { not: 'REVOKED' } },
        _count: { _all: true },
      }),
    ]);
    const guests = new Map(guestCounts.map((g) => [g.eventId, g._count._all]));
    const tickets = new Map<string, { total: number; used: number }>();
    for (const row of ticketCounts) {
      const entry = tickets.get(row.eventId) ?? { total: 0, used: 0 };
      entry.total += row._count._all;
      if (row.status === 'USED') entry.used += row._count._all;
      tickets.set(row.eventId, entry);
    }
    return events.map((e) => ({
      id: e.id,
      organizerId: e.organizerId,
      organizerName: e.organizer.name,
      name: e.name,
      description: e.description,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null,
      venueName: e.venueName,
      venueAddress: e.venueAddress,
      coverImageUrl: e.coverImageUrl,
      status: e.status,
      capacity: e.capacity,
      enforceCapacity: e.enforceCapacity,
      archivedAt: e.archivedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      counts: {
        guests: guests.get(e.id) ?? 0,
        tickets: tickets.get(e.id)?.total ?? 0,
        checkedIn: tickets.get(e.id)?.used ?? 0,
      },
    }));
  }

  private async dtoById(id: string): Promise<EventDto> {
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id }, include: { organizer: { select: { name: true } } } });
    return (await this.toDtos([event]))[0];
  }

  private deleteCoverFile(url: string | null): void {
    if (!url || !/^\/uploads\/covers\/[0-9a-f-]+\.(jpg|png|webp)$/.test(url)) return;
    const path = resolve(process.cwd(), this.config.uploadDir, 'covers', url.split('/').pop() as string);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* a stale file is harmless */
    }
  }
}

/** Identifies JPEG / PNG / WebP from magic bytes. */
export function detectImageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}
