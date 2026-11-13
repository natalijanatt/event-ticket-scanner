import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { AppError, notFound } from '../common/errors';
import { AppConfig } from '../config/app-config';
import type { ProviderEmailEvent } from '../email/email.types';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryStatusService } from './delivery-status.service';
import { verifyWebhookSignature } from './webhook-signature';

const EVENT_TYPES: Record<string, ProviderEmailEvent['type']> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

/** How long an event for a not-yet-known message is bounced back for redelivery. */
const UNKNOWN_MESSAGE_RETRY_WINDOW_MS = 10 * 60 * 1000;

@Public()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly status: DeliveryStatusService,
  ) {}

  /**
   * Resend delivery events.
   *  • authenticated by signature over the RAW body (never the parsed JSON)
   *  • idempotent: each webhook id is processed once
   *  • order-independent: see delivery-status.ts
   */
  @Post('resend')
  @HttpCode(200)
  async resend(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') id?: string,
    @Headers('svix-timestamp') timestamp?: string,
    @Headers('svix-signature') signature?: string,
  ): Promise<{ ok: true }> {
    if (!this.config.resendWebhookSecret) throw notFound();
    const rawBody = req.rawBody;
    if (
      !rawBody ||
      !verifyWebhookSignature({ secret: this.config.resendWebhookSecret, id, timestamp, signatureHeader: signature, rawBody })
    ) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    }

    let payload: { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { message?: string } } };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: true };
    }
    const type = EVENT_TYPES[payload.type ?? ''];
    const messageId = payload.data?.email_id;
    if (!type || !messageId) return { ok: true }; // event we do not track (opened, clicked, …)

    const webhookId = id as string;
    if (await this.prisma.webhookEvent.findUnique({ where: { id: webhookId } })) return { ok: true };

    const at = payload.created_at ? new Date(payload.created_at) : new Date();
    const eventAt = Number.isNaN(at.getTime()) ? new Date() : at;
    const outcome = await this.status.apply({ messageId, type, at: eventAt });

    if (outcome === 'unknown-message' && Date.now() - eventAt.getTime() < UNKNOWN_MESSAGE_RETRY_WINDOW_MS) {
      // The event overtook our own "accepted" bookkeeping. Ask for redelivery
      // instead of dropping it; after the window, unknown ids are acknowledged.
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'MESSAGE_NOT_READY', 'Message not known yet, retry later.');
    }

    try {
      await this.prisma.webhookEvent.create({ data: { id: webhookId, provider: 'resend', type: payload.type as string } });
    } catch (err) {
      // A concurrent duplicate of the same webhook won the insert – fine.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    this.logger.log(`Resend webhook ${payload.type} → ${outcome}`);
    return { ok: true };
  }
}
