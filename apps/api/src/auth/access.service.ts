import { Injectable } from '@nestjs/common';
import type { Event, Prisma } from '@prisma/client';
import { forbidden, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { canManageEvent, canManageOrganizer, canScanEvent, manageableOrganizerIds } from './access.rules';
import type { RequestUser } from './auth.types';

/**
 * Server-side enforcement of tenant boundaries. Every service that touches
 * event data obtains the event through this class – there is no other path.
 * Foreign data answers with 404 (never 403) so its existence is not revealed.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads an event the user may fully administer, or throws 404. */
  async eventForManage(user: RequestUser, eventId: string): Promise<Event> {
    const event = await this.findEvent(eventId);
    if (!event || !canManageEvent(user, event)) throw notFound('Događaj nije pronađen.');
    return event;
  }

  /** Loads an event the user may scan tickets for, or throws 404. */
  async eventForScan(user: RequestUser, eventId: string): Promise<Event> {
    const event = await this.findEvent(eventId);
    if (!event) throw notFound('Događaj nije pronađen.');
    let assigned = false;
    if (user.role === 'SCANNER') {
      assigned = Boolean(
        await this.prisma.eventStaff.findUnique({ where: { eventId_userId: { eventId, userId: user.id } }, select: { id: true } }),
      );
    }
    if (!canScanEvent(user, event, assigned)) throw notFound('Događaj nije pronađen.');
    return event;
  }

  assertOrganizer(user: RequestUser, organizerId: string): void {
    if (!canManageOrganizer(user, organizerId)) throw notFound('Organizator nije pronađen.');
  }

  /** Prisma filter limiting events to those the user may administer. */
  manageableEventsWhere(user: RequestUser): Prisma.EventWhereInput {
    const ids = manageableOrganizerIds(user);
    return ids === null ? {} : { organizerId: { in: ids } };
  }

  /** Prisma filter limiting events to those the user may scan. */
  scannableEventsWhere(user: RequestUser): Prisma.EventWhereInput {
    if (user.role === 'SCANNER') {
      return {
        staff: { some: { userId: user.id } },
        organizerId: { in: user.memberships.map((m) => m.organizerId) },
      };
    }
    return this.manageableEventsWhere(user);
  }

  /** Resolves which organizer a new resource belongs to. */
  resolveOrganizerId(user: RequestUser, requested?: string | null): string {
    if (requested) {
      this.assertOrganizer(user, requested);
      return requested;
    }
    const ids = manageableOrganizerIds(user);
    if (ids && ids.length === 1) return ids[0];
    if (ids && ids.length === 0) throw forbidden('Nalog nije povezan ni sa jednim organizatorom.');
    throw forbidden('Izaberi organizatora.');
  }

  private findEvent(eventId: string): Promise<Event | null> {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return Promise.resolve(null);
    return this.prisma.event.findUnique({ where: { id: eventId } });
  }
}
