import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { TicketsModule } from '../tickets/tickets.module';
import { DeliveryProcessor } from './delivery-processor.service';
import { DeliveryStatusService } from './delivery-status.service';
import { BullInvitationQueue, INVITATION_QUEUE, InlineInvitationQueue } from './invitation-queue';
import { InvitationRenderer } from './invitation-renderer.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [TicketsModule],
  controllers: [InvitationsController, WebhooksController],
  providers: [
    InvitationsService,
    InvitationRenderer,
    DeliveryProcessor,
    DeliveryStatusService,
    {
      provide: INVITATION_QUEUE,
      inject: [AppConfig, DeliveryProcessor],
      useFactory: (config: AppConfig, processor: DeliveryProcessor) => {
        if (config.emailQueueMode === 'inline') return new InlineInvitationQueue(processor);
        const queue = new BullInvitationQueue(config, processor);
        return queue;
      },
    },
  ],
  exports: [InvitationsService, DeliveryStatusService],
})
export class InvitationsModule {}
