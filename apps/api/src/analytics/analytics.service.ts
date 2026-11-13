import { Injectable } from '@nestjs/common';
import type { DashboardDto, EventStatsDto, GuestEmailStatus, ScanResult } from '@event-platform/shared';
import { Prisma } from '@prisma/client';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventsService,
  ) {}

  async eventStats(user: RequestUser, eventId: string): Promise<EventStatsDto> {
    const event = await this.access.eventForManage(user, eventId);
    const id = event.id;
    const deliveries = this.prisma.ident('email_deliveries');
    const tickets = this.prisma.ident('tickets');

    const [guestTotal, guestsCheckedIn, allocation, byStatus, byType, types, latestDeliveries, buckets, recent, scans] = await Promise.all([
      this.prisma.eventGuest.count({ where: { eventId: id } }),
      this.prisma.eventGuest.count({ where: { eventId: id, tickets: { some: { status: 'USED' } } } }),
      this.prisma.eventGuest.aggregate({ where: { eventId: id }, _sum: { ticketQuantity: true } }),
      this.prisma.ticket.groupBy({ by: ['status'], where: { eventId: id }, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['ticketTypeId', 'status'], where: { eventId: id }, _count: { _all: true } }),
      this.prisma.ticketType.findMany({ where: { eventId: id }, orderBy: { sortOrder: 'asc' } }),
      // Invitation status per GUEST = status of their most recent delivery.
      this.prisma.$queryRaw<{ status: string; count: bigint }[]>(Prisma.sql`
        SELECT status::text AS status, COUNT(*) AS count FROM (
          SELECT DISTINCT ON (event_guest_id) status
            FROM ${deliveries}
           WHERE event_id = ${id}::uuid
           ORDER BY event_guest_id, queued_at DESC
        ) latest GROUP BY status`),
      this.prisma.$queryRaw<{ bucket: Date; count: bigint }[]>(Prisma.sql`
        SELECT to_timestamp(floor(extract(epoch FROM used_at) / 900) * 900) AS bucket, COUNT(*) AS count
          FROM ${tickets}
         WHERE event_id = ${id}::uuid AND used_at IS NOT NULL
         GROUP BY 1 ORDER BY 1`),
      this.prisma.ticket.findMany({
        where: { eventId: id, status: 'USED' },
        orderBy: { usedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          reference: true,
          usedAt: true,
          guest: { select: { firstName: true, lastName: true } },
          ticketType: { select: { id: true, name: true, color: true } },
          scannedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.scanLog.groupBy({ by: ['result'], where: { eventId: id }, _count: { _all: true } }),
    ]);

    const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;
    const valid = count('VALID');
    const used = count('USED');
    const revoked = count('REVOKED');

    const invitations: Record<GuestEmailStatus, number> = { NOT_SENT: 0, QUEUED: 0, SENDING: 0, SENT: 0, DELIVERED: 0, BOUNCED: 0, FAILED: 0 };
    let withDelivery = 0;
    for (const row of latestDeliveries) {
      invitations[row.status as GuestEmailStatus] = Number(row.count);
      withDelivery += Number(row.count);
    }
    invitations.NOT_SENT = Math.max(0, guestTotal - withDelivery);

    let cumulative = 0;
    const checkInsOverTime = buckets.map((b) => {
      cumulative += Number(b.count);
      return { time: new Date(b.bucket).toISOString(), count: Number(b.count), cumulative };
    });

    const scanResults: Partial<Record<ScanResult, number>> = {};
    for (const s of scans) scanResults[s.result] = s._count._all;

    return {
      eventId: id,
      generatedAt: new Date().toISOString(),
      capacity: event.capacity,
      guests: { total: guestTotal, checkedIn: guestsCheckedIn },
      tickets: { allocated: allocation._sum.ticketQuantity ?? 0, generated: valid + used + revoked, valid, used, revoked },
      invitations,
      checkInRate: valid + used > 0 ? Math.round((used / (valid + used)) * 1000) / 10 : 0,
      ticketTypes: types.map((t) => {
        const of = (status: string) => byType.find((b) => b.ticketTypeId === t.id && b.status === status)?._count._all ?? 0;
        return { id: t.id, name: t.name, color: t.color, valid: of('VALID'), used: of('USED'), revoked: of('REVOKED') };
      }),
      checkInsOverTime,
      recentCheckIns: recent.map((t) => ({
        id: t.id,
        guestName: `${t.guest.firstName} ${t.guest.lastName}`.trim(),
        reference: t.reference,
        ticketType: t.ticketType,
        usedAt: (t.usedAt as Date).toISOString(),
        scannerName: t.scannedBy ? `${t.scannedBy.firstName} ${t.scannedBy.lastName}`.trim() : null,
      })),
      scanResults,
    };
  }

  async dashboard(user: RequestUser): Promise<DashboardDto> {
    const scope = { ...this.access.manageableEventsWhere(user), archivedAt: null };
    const now = new Date();
    const soon = new Date(now.getTime() - 12 * 3_600_000);

    const [events, activeEvents, guests, ticketsTotal, checkedIn, invitationsSent, upcoming, recent, recentCheckIns] = await Promise.all([
      this.prisma.event.count({ where: scope }),
      this.prisma.event.count({ where: { ...scope, status: 'ACTIVE' } }),
      this.prisma.eventGuest.count({ where: { event: scope } }),
      this.prisma.ticket.count({ where: { event: scope, status: { not: 'REVOKED' } } }),
      this.prisma.ticket.count({ where: { event: scope, status: 'USED' } }),
      this.prisma.emailDelivery.count({ where: { event: scope, status: { in: ['SENT', 'DELIVERED'] } } }),
      this.prisma.event.findMany({
        where: { ...scope, startsAt: { gte: soon }, status: { in: ['ACTIVE', 'DRAFT'] } },
        include: { organizer: { select: { name: true } } },
        orderBy: { startsAt: 'asc' },
        take: 6,
      }),
      this.prisma.event.findMany({
        where: { ...scope, OR: [{ startsAt: { lt: soon } }, { status: { in: ['COMPLETED', 'CANCELLED'] } }] },
        include: { organizer: { select: { name: true } } },
        orderBy: { startsAt: 'desc' },
        take: 4,
      }),
      this.prisma.ticket.findMany({
        where: { event: scope, status: 'USED' },
        orderBy: { usedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          usedAt: true,
          eventId: true,
          event: { select: { name: true } },
          guest: { select: { firstName: true, lastName: true } },
          ticketType: { select: { id: true, name: true, color: true } },
        },
      }),
    ]);

    const totals: DashboardDto['totals'] = { events, activeEvents, guests, tickets: ticketsTotal, checkedIn, invitationsSent };
    if (user.role === 'SUPER_ADMIN') {
      totals.organizers = await this.prisma.organizer.count();
      totals.users = await this.prisma.user.count({ where: { isActive: true } });
    }

    return {
      totals,
      upcoming: await this.events.toDtos(upcoming),
      recent: await this.events.toDtos(recent),
      recentCheckIns: recentCheckIns.map((t) => ({
        id: t.id,
        eventId: t.eventId,
        eventName: t.event.name,
        guestName: `${t.guest.firstName} ${t.guest.lastName}`.trim(),
        ticketType: t.ticketType,
        usedAt: (t.usedAt as Date).toISOString(),
      })),
    };
  }
}
