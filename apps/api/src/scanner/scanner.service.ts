import { Injectable } from '@nestjs/common';
import type { Paginated, ScanLogDto, ScannerEventDto, ScannerSearchResultDto, ScanResult } from '@event-platform/shared';
import type { Prisma } from '@prisma/client';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const logInclude = {
  event: { select: { name: true } },
  scanner: { select: { firstName: true, lastName: true } },
  ticket: {
    select: {
      reference: true,
      guest: { select: { firstName: true, lastName: true } },
      ticketType: { select: { id: true, name: true, color: true } },
    },
  },
} satisfies Prisma.ScanLogInclude;

type LogRow = Prisma.ScanLogGetPayload<{ include: typeof logInclude }>;

function toLogDto(log: LogRow): ScanLogDto {
  return {
    id: log.id,
    result: log.result,
    method: log.method,
    createdAt: log.createdAt.toISOString(),
    eventId: log.eventId,
    eventName: log.event.name,
    reference: log.ticket?.reference ?? null,
    guestName: log.ticket ? `${log.ticket.guest.firstName} ${log.ticket.guest.lastName}`.trim() : null,
    ticketType: log.ticket?.ticketType ?? null,
    scannerName: `${log.scanner.firstName} ${log.scanner.lastName}`.trim(),
  };
}

@Injectable()
export class ScannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** Events the user may scan right now: assigned, not archived, not long over. */
  async events(user: RequestUser): Promise<ScannerEventDto[]> {
    const events = await this.prisma.event.findMany({
      where: {
        ...this.access.scannableEventsWhere(user),
        archivedAt: null,
        status: { in: ['ACTIVE', 'DRAFT'] },
        startsAt: { gt: new Date(Date.now() - 3 * 24 * 3_600_000) },
      },
      include: { organizer: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 50,
    });
    return events.map((e) => ({
      id: e.id,
      name: e.name,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null,
      venueName: e.venueName,
      status: e.status,
      organizerName: e.organizer.name,
    }));
  }

  /**
   * Manual lookup for guests whose QR code cannot be scanned. Deliberately
   * narrow: name or ticket reference only, a handful of results, and no
   * contact details – this must not become a way to browse the guest list.
   */
  async search(user: RequestUser, eventId: string, q: string): Promise<ScannerSearchResultDto[]> {
    const event = await this.access.eventForScan(user, eventId);
    const terms = q.trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (terms.join('').length < 2) return [];
    const tickets = await this.prisma.ticket.findMany({
      where: {
        eventId: event.id,
        AND: terms.map((term) => ({
          OR: [
            { reference: { contains: term.toUpperCase() } },
            { guest: { firstName: { contains: term, mode: 'insensitive' as const } } },
            { guest: { lastName: { contains: term, mode: 'insensitive' as const } } },
          ],
        })),
      },
      select: {
        id: true,
        reference: true,
        status: true,
        usedAt: true,
        guest: { select: { firstName: true, lastName: true } },
        ticketType: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ guest: { firstName: 'asc' } }, { guest: { lastName: 'asc' } }, { createdAt: 'asc' }],
      take: 12,
    });
    return tickets.map((t) => ({
      ticketId: t.id,
      reference: t.reference,
      guestName: `${t.guest.firstName} ${t.guest.lastName}`.trim(),
      ticketType: t.ticketType,
      status: t.status,
      usedAt: t.usedAt?.toISOString() ?? null,
    }));
  }

  /** The signed-in user's own recent scans. */
  async history(user: RequestUser, eventId?: string): Promise<ScanLogDto[]> {
    const logs = await this.prisma.scanLog.findMany({
      where: { scannerId: user.id, ...(eventId ? { eventId } : {}) },
      include: logInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return logs.map(toLogDto);
  }

  async summary(user: RequestUser, eventId: string): Promise<{ checkedIn: number; capacity: number | null }> {
    const event = await this.access.eventForScan(user, eventId);
    const checkedIn = await this.prisma.ticket.count({ where: { eventId: event.id, status: 'USED' } });
    return { checkedIn, capacity: event.capacity };
  }

  /** Full scan log of an event – organizer view. */
  async eventLog(
    user: RequestUser,
    eventId: string,
    query: { result?: ScanResult; page: number; pageSize: number },
  ): Promise<Paginated<ScanLogDto>> {
    const event = await this.access.eventForManage(user, eventId);
    const where: Prisma.ScanLogWhereInput = { eventId: event.id, ...(query.result ? { result: query.result } : {}) };
    const [total, logs] = await Promise.all([
      this.prisma.scanLog.count({ where }),
      this.prisma.scanLog.findMany({
        where,
        include: logInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items: logs.map(toLogDto) };
  }
}
