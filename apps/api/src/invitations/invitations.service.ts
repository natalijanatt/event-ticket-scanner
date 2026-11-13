import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DeliveryRowDto,
  EmailStatus,
  InvitationPreviewDto,
  InvitationSummaryDto,
  InvitationSummaryInput,
  Paginated,
  SendInvitationsInput,
  SendInvitationsResult,
} from '@event-platform/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { conflict, notFound } from '../common/errors';
import { RealtimeService } from '../common/realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { DeliveryProcessor } from './delivery-processor.service';
import { ALREADY_SENT, IN_FLIGHT } from './delivery-status';
import { INVITATION_QUEUE, type InvitationQueue } from './invitation-queue';
import { InvitationRenderer } from './invitation-renderer.service';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly tickets: TicketsService,
    private readonly renderer: InvitationRenderer,
    private readonly processor: DeliveryProcessor,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Inject(INVITATION_QUEUE) private readonly queue: InvitationQueue,
  ) {}

  /**
   * Queues personalized invitations for the selected guests.
   *
   * Duplicate-send protection, in layers:
   *  1. a guest whose latest e-mail is still in flight is always skipped;
   *  2. mode SEND also skips guests whose invitation was already sent –
   *     only an explicit RESEND sends again;
   *  3. `<requestId>:<eventGuestId>` is unique in the database, so the same
   *     HTTP request delivered twice (double click, network retry) cannot
   *     create a second delivery;
   *  4. the delivery id is the queue job id and the provider idempotency key.
   *
   * Tickets: missing tickets are generated up to each guest's allocation.
   * Guests who already have their tickets get the SAME tickets again.
   */
  async send(user: RequestUser, eventId: string, input: SendInvitationsInput): Promise<SendInvitationsResult> {
    const event = await this.access.eventForManage(user, eventId);
    if (event.status === 'DRAFT') {
      throw conflict('EVENT_DRAFT', 'Događaj je još u nacrtu. Aktiviraj ga pre slanja pozivnica.');
    }
    if (event.status !== 'ACTIVE') {
      throw conflict('EVENT_CLOSED', 'Događaj je završen ili otkazan — pozivnice se više ne mogu slati.');
    }
    const subject = this.renderer.subjectFor(event);
    const ids = [...new Set(input.eventGuestIds)];

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const generated = await this.tickets.generateMissing(tx, event, ids);
        const guests = await tx.eventGuest.findMany({
          where: { id: { in: ids }, eventId: event.id },
          include: {
            guest: { select: { email: true, anonymizedAt: true } },
            tickets: { where: { status: 'VALID' }, select: { id: true } },
            emailDeliveries: { orderBy: { queuedAt: 'desc' }, take: 1, select: { status: true } },
          },
        });

        const rows: Prisma.EmailDeliveryCreateManyInput[] = [];
        let skippedAlreadySent = 0;
        let skippedNoTickets = 0;
        for (const eg of guests) {
          if (eg.guest.anonymizedAt || eg.tickets.length === 0) {
            skippedNoTickets++;
            continue;
          }
          const latest = eg.emailDeliveries[0]?.status;
          if (latest && (IN_FLIGHT.includes(latest) || (input.mode === 'SEND' && ALREADY_SENT.includes(latest)))) {
            skippedAlreadySent++;
            continue;
          }
          rows.push({
            id: randomUUID(),
            eventId: event.id,
            eventGuestId: eg.id,
            kind: latest ? 'RESEND' : 'INVITATION',
            toEmail: eg.guest.email,
            subject,
            idempotencyKey: `${input.requestId}:${eg.id}`,
            ticketCount: eg.tickets.length,
            createdById: user.id,
          });
        }

        let createdIds: string[] = [];
        if (rows.length > 0) {
          await tx.emailDelivery.createMany({ data: rows, skipDuplicates: true });
          // skipDuplicates drops rows whose idempotency key already exists (replayed request).
          const created = await tx.emailDelivery.findMany({ where: { id: { in: rows.map((r) => r.id as string) } }, select: { id: true } });
          createdIds = created.map((c) => c.id);
          skippedAlreadySent += rows.length - createdIds.length;
        }
        return { createdIds, skippedAlreadySent, skippedNoTickets, ticketsGenerated: generated.generated };
      },
      { timeout: 30_000 },
    );

    if (outcome.createdIds.length > 0) {
      try {
        await this.queue.enqueue(outcome.createdIds);
      } catch (err) {
        // The queue is down: never leave deliveries silently stuck in "U redu za slanje".
        this.logger.error(`Could not enqueue ${outcome.createdIds.length} deliveries: ${(err as Error).message}`);
        for (const id of outcome.createdIds) {
          await this.processor.fail(id, event.id, 'Red za slanje trenutno nije dostupan. Pokušaj ponovo.');
        }
      }
      await this.audit.log({
        actorId: user.id,
        organizerId: event.organizerId,
        action: input.mode === 'RESEND' ? 'invitations.resend' : 'invitations.send',
        entityType: 'event',
        entityId: event.id,
        metadata: { queued: outcome.createdIds.length, ticketsGenerated: outcome.ticketsGenerated },
      });
    }
    this.realtime.publish(event.id, 'email');

    return {
      queued: outcome.createdIds.length,
      skippedAlreadySent: outcome.skippedAlreadySent,
      skippedNoTickets: outcome.skippedNoTickets,
      ticketsGenerated: outcome.ticketsGenerated,
    };
  }

  /**
   * Dry run of `send`: the same classification, without writing anything.
   * Feeds the confirmation dialog (recipients, tickets, event name).
   */
  async summary(user: RequestUser, eventId: string, input: InvitationSummaryInput): Promise<InvitationSummaryDto> {
    const event = await this.access.eventForManage(user, eventId);
    const guests = await this.prisma.eventGuest.findMany({
      where: { id: { in: [...new Set(input.eventGuestIds)] }, eventId: event.id },
      select: {
        ticketQuantity: true,
        guest: { select: { anonymizedAt: true } },
        tickets: { where: { status: { not: 'REVOKED' } }, select: { status: true } },
        emailDeliveries: { orderBy: { queuedAt: 'desc' }, take: 1, select: { status: true } },
      },
    });
    const result: InvitationSummaryDto = {
      eventName: event.name,
      recipients: 0,
      tickets: 0,
      ticketsToGenerate: 0,
      skippedAlreadySent: 0,
      skippedNoTickets: 0,
    };
    for (const eg of guests) {
      const valid = eg.tickets.filter((t) => t.status === 'VALID').length;
      const missing = Math.max(0, eg.ticketQuantity - eg.tickets.length);
      if (eg.guest.anonymizedAt || valid + missing === 0) {
        result.skippedNoTickets++;
        continue;
      }
      const latest = eg.emailDeliveries[0]?.status;
      if (latest && (IN_FLIGHT.includes(latest) || (input.mode === 'SEND' && ALREADY_SENT.includes(latest)))) {
        result.skippedAlreadySent++;
        continue;
      }
      result.recipients++;
      result.tickets += valid + missing;
      result.ticketsToGenerate += missing;
    }
    return result;
  }

  /** Renders exactly what a guest would receive, without sending or creating anything. */
  async preview(user: RequestUser, eventId: string, eventGuestId?: string): Promise<InvitationPreviewDto> {
    const event = await this.access.eventForManage(user, eventId);
    const eg = await this.prisma.eventGuest.findFirst({
      where: eventGuestId ? { id: eventGuestId, eventId: event.id } : { eventId: event.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!eg) {
      throw notFound(eventGuestId ? 'Gost nije pronađen.' : 'Dodaj bar jednog gosta da bi video/la pregled pozivnice.');
    }
    const rendered = await this.renderer.render(eg.id, 'preview');
    if (!rendered) throw notFound('Gost nije pronađen.');
    return { subject: rendered.subject, html: rendered.html, to: rendered.to };
  }

  async list(
    user: RequestUser,
    eventId: string,
    query: { status?: EmailStatus; search?: string; page: number; pageSize: number },
  ): Promise<Paginated<DeliveryRowDto>> {
    const event = await this.access.eventForManage(user, eventId);
    const search = query.search?.trim();
    const where: Prisma.EmailDeliveryWhereInput = {
      eventId: event.id,
      // Statuses that share one label in the UI are filtered together.
      ...(query.status
        ? { status: { in: query.status === 'FAILED' ? ['FAILED', 'BOUNCED'] : query.status === 'QUEUED' ? ['QUEUED', 'SENDING'] : [query.status] } }
        : {}),
      ...(search
        ? {
            OR: [
              { toEmail: { contains: search, mode: 'insensitive' } },
              { eventGuest: { guest: { firstName: { contains: search, mode: 'insensitive' } } } },
              { eventGuest: { guest: { lastName: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.emailDelivery.count({ where }),
      this.prisma.emailDelivery.findMany({
        where,
        include: { eventGuest: { select: { guest: { select: { firstName: true, lastName: true } } } } },
        orderBy: [{ queuedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((d) => ({
        id: d.id,
        eventGuestId: d.eventGuestId,
        guestName: `${d.eventGuest.guest.firstName} ${d.eventGuest.guest.lastName}`.trim(),
        toEmail: d.toEmail,
        kind: d.kind,
        status: d.status,
        subject: d.subject,
        attempts: d.attempts,
        lastError: d.lastError,
        ticketCount: d.ticketCount,
        queuedAt: d.queuedAt.toISOString(),
        sentAt: d.sentAt?.toISOString() ?? null,
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
        bouncedAt: d.bouncedAt?.toISOString() ?? null,
        failedAt: d.failedAt?.toISOString() ?? null,
      })),
    };
  }
}
