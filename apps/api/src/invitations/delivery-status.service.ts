import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RealtimeService } from '../common/realtime.service';
import { EMAIL_PROVIDER, type EmailProvider, type ProviderEmailEvent } from '../email/email.types';
import { MockEmailProvider } from '../email/mock.provider';
import { PrismaService } from '../prisma/prisma.service';
import { allowedPredecessors, targetStatus } from './delivery-status';

export type ApplyOutcome = 'applied' | 'ignored' | 'unknown-message';

/** Applies provider lifecycle events (webhooks or the mock simulator) to deliveries. */
@Injectable()
export class DeliveryStatusService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  onModuleInit(): void {
    if (this.provider instanceof MockEmailProvider) {
      this.provider.events.on('event', (event: ProviderEmailEvent) => {
        void this.apply(event).catch(() => undefined);
      });
    }
  }

  async apply(event: ProviderEmailEvent): Promise<ApplyOutcome> {
    const delivery = await this.prisma.emailDelivery.findUnique({ where: { providerMessageId: event.messageId } });
    if (!delivery) return 'unknown-message';

    const lastEventAt = delivery.lastEventAt && delivery.lastEventAt > event.at ? delivery.lastEventAt : event.at;
    const target = targetStatus(event.type);

    if (!target) {
      const data: Prisma.EmailDeliveryUpdateInput = { lastEventAt };
      if (event.type === 'complained') data.complainedAt = event.at;
      if (event.type === 'delivery_delayed' && delivery.status === 'SENT') data.lastError = 'Isporuka kasni — server primaoca privremeno ne prihvata poruku.';
      await this.prisma.emailDelivery.update({ where: { id: delivery.id }, data });
      return 'applied';
    }

    const data: Prisma.EmailDeliveryUpdateManyMutationInput = { status: target, lastEventAt };
    if (target === 'SENT') data.sentAt = delivery.sentAt ?? event.at;
    if (target === 'DELIVERED') {
      data.deliveredAt = event.at;
      data.lastError = null;
    }
    if (target === 'BOUNCED') {
      data.bouncedAt = event.at;
      data.lastError = 'Server primaoca je odbio poruku. Proveri email adresu.';
    }
    if (target === 'FAILED') {
      data.failedAt = event.at;
      data.lastError = 'Servis za slanje nije uspeo da isporuči poruku.';
    }

    // The status guard makes the transition atomic and monotonic.
    const result = await this.prisma.emailDelivery.updateMany({
      where: { id: delivery.id, status: { in: allowedPredecessors(target) } },
      data,
    });
    if (result.count === 0) return 'ignored';
    this.realtime.publish(delivery.eventId, 'email');
    return 'applied';
  }
}
