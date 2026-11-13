import { Injectable, Logger } from '@nestjs/common';
import { RealtimeService } from '../common/realtime.service';
import { EmailService } from '../email/email.service';
import { EmailSendError } from '../email/email.types';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationRenderer } from './invitation-renderer.service';

/**
 * Sends ONE queued delivery. Called by the BullMQ worker (or inline in tests).
 *
 * Contract
 *  • returns normally when the delivery reached SENT or a permanent FAILED
 *  • throws EmailSendError(retryable) when the queue should try again later
 *
 * Safe to run more than once for the same delivery:
 *  • a delivery that already left QUEUED/SENDING is skipped,
 *  • the delivery id is the provider idempotency key, so a retry after a
 *    crash between "provider accepted" and "database updated" cannot
 *    produce a second e-mail.
 */
@Injectable()
export class DeliveryProcessor {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: InvitationRenderer,
    private readonly email: EmailService,
    private readonly realtime: RealtimeService,
  ) {}

  async process(deliveryId: string, opts: { isLastAttempt: boolean }): Promise<void> {
    const claimed = await this.prisma.emailDelivery.updateMany({
      where: { id: deliveryId, status: { in: ['QUEUED', 'SENDING'] } },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return; // already sent, failed, or deleted

    const delivery = await this.prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    this.realtime.publish(delivery.eventId, 'email');

    const rendered = await this.renderer.render(delivery.eventGuestId, 'send');
    if (!rendered) {
      // Tickets were revoked between queueing and sending.
      await this.fail(deliveryId, delivery.eventId, 'Gost više nema važećih karata — pozivnica nije poslata.');
      return;
    }

    try {
      const { id: providerMessageId } = await this.email.send({
        to: rendered.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments: rendered.attachments,
        idempotencyKey: delivery.id,
      });
      // SENT = accepted by the provider. DELIVERED only ever comes from a provider event.
      await this.prisma.emailDelivery.updateMany({
        where: { id: deliveryId, status: 'SENDING' },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId,
          toEmail: rendered.to,
          subject: rendered.subject,
          ticketCount: rendered.ticketCount,
          lastError: null,
        },
      });
      this.realtime.publish(delivery.eventId, 'email');
    } catch (err) {
      const sendError = err instanceof EmailSendError ? err : new EmailSendError('Neočekivana greška pri slanju.', true);
      if (!(err instanceof EmailSendError)) this.logger.error(`Delivery ${deliveryId} failed unexpectedly: ${(err as Error).message}`);

      if (sendError.retryable && !opts.isLastAttempt) {
        await this.prisma.emailDelivery.updateMany({
          where: { id: deliveryId, status: 'SENDING' },
          data: { status: 'QUEUED', lastError: sendError.message },
        });
        this.realtime.publish(delivery.eventId, 'email');
        throw sendError;
      }
      await this.fail(deliveryId, delivery.eventId, sendError.message);
    }
  }

  /** Marks a delivery as permanently failed (also used when the queue itself is unavailable). */
  async fail(deliveryId: string, eventId: string, reason: string): Promise<void> {
    await this.prisma.emailDelivery.updateMany({
      where: { id: deliveryId, status: { in: ['QUEUED', 'SENDING'] } },
      data: { status: 'FAILED', failedAt: new Date(), lastError: reason.slice(0, 500) },
    });
    this.realtime.publish(eventId, 'email');
  }
}
