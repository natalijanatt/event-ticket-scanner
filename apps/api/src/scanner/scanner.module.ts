import { Module } from '@nestjs/common';
import { CheckInService } from '../check-in/check-in.service';
import { TicketsModule } from '../tickets/tickets.module';
import { EventCheckInsController, ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

@Module({
  imports: [TicketsModule],
  controllers: [ScannerController, EventCheckInsController],
  providers: [ScannerService, CheckInService],
  exports: [CheckInService],
})
export class ScannerModule {}
