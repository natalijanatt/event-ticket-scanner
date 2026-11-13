import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { TicketsModule } from '../tickets/tickets.module';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [TicketsModule, InvitationsModule],
  controllers: [GuestsController],
  providers: [GuestsService, RetentionService],
  exports: [GuestsService, RetentionService],
})
export class GuestsModule {}
