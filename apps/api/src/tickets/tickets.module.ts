import { Module } from '@nestjs/common';
import { PublicTicketsController } from './public-tickets.controller';
import { TicketCryptoService } from './ticket-crypto.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [TicketsController, PublicTicketsController],
  providers: [TicketsService, TicketCryptoService],
  exports: [TicketsService, TicketCryptoService],
})
export class TicketsModule {}
