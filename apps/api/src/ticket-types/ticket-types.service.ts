import { Injectable } from '@nestjs/common';
import type { TicketTypeDto, TicketTypeInput } from '@event-platform/shared';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { conflict, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TicketTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(user: RequestUser, eventId: string): Promise<TicketTypeDto[]> {
    const event = await this.access.eventForManage(user, eventId);
    return this.listForEvent(event.id);
  }

  async create(user: RequestUser, eventId: string, input: TicketTypeInput): Promise<TicketTypeDto> {
    const event = await this.access.eventForManage(user, eventId);
    await this.assertNameFree(event.id, input.name);
    const last = await this.prisma.ticketType.aggregate({ where: { eventId: event.id }, _max: { sortOrder: true } });
    const created = await this.prisma.ticketType.create({
      data: { eventId: event.id, ...input, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    return this.one(event.id, created.id);
  }

  async update(user: RequestUser, eventId: string, ticketTypeId: string, input: TicketTypeInput): Promise<TicketTypeDto> {
    const event = await this.access.eventForManage(user, eventId);
    // The event id in the WHERE clause guarantees the type belongs to this event.
    const existing = await this.prisma.ticketType.findFirst({ where: { id: ticketTypeId, eventId: event.id } });
    if (!existing) throw notFound('Tip karte nije pronađen.');
    if (input.name.toLowerCase() !== existing.name.toLowerCase()) await this.assertNameFree(event.id, input.name);
    await this.prisma.ticketType.update({ where: { id: existing.id }, data: input });
    return this.one(event.id, existing.id);
  }

  async remove(user: RequestUser, eventId: string, ticketTypeId: string): Promise<void> {
    const event = await this.access.eventForManage(user, eventId);
    const existing = await this.prisma.ticketType.findFirst({
      where: { id: ticketTypeId, eventId: event.id },
      include: { _count: { select: { eventGuests: true, tickets: true } } },
    });
    if (!existing) throw notFound('Tip karte nije pronađen.');
    if (existing._count.eventGuests > 0 || existing._count.tickets > 0) {
      throw conflict('TICKET_TYPE_IN_USE', 'Tip karte je dodeljen gostima i ne može biti obrisan. Prvo gostima dodeli drugi tip.');
    }
    await this.prisma.ticketType.delete({ where: { id: existing.id } });
  }

  async listForEvent(eventId: string): Promise<TicketTypeDto[]> {
    const [types, ticketCounts, allocations] = await Promise.all([
      this.prisma.ticketType.findMany({ where: { eventId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ticket.groupBy({ by: ['ticketTypeId'], where: { eventId, status: { not: 'REVOKED' } }, _count: { _all: true } }),
      this.prisma.eventGuest.groupBy({ by: ['ticketTypeId'], where: { eventId }, _sum: { ticketQuantity: true } }),
    ]);
    const issued = new Map(ticketCounts.map((c) => [c.ticketTypeId, c._count._all]));
    const allocated = new Map(allocations.map((a) => [a.ticketTypeId, a._sum.ticketQuantity ?? 0]));
    return types.map((t) => ({
      id: t.id,
      eventId: t.eventId,
      name: t.name,
      description: t.description,
      capacity: t.capacity,
      color: t.color,
      instructions: t.instructions,
      ticketCount: issued.get(t.id) ?? 0,
      allocatedCount: allocated.get(t.id) ?? 0,
    }));
  }

  private async one(eventId: string, id: string): Promise<TicketTypeDto> {
    const all = await this.listForEvent(eventId);
    return all.find((t) => t.id === id) as TicketTypeDto;
  }

  private async assertNameFree(eventId: string, name: string): Promise<void> {
    const clash = await this.prisma.ticketType.findFirst({ where: { eventId, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw conflict('TICKET_TYPE_EXISTS', 'Tip karte sa ovim nazivom već postoji.');
  }
}
