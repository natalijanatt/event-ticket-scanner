import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  checkInSchema,
  SCAN_RESULTS,
  type CheckInInput,
  type CheckInResponse,
  type Paginated,
  type ScanLogDto,
  type ScannerEventDto,
  type ScannerSearchResultDto,
  type ScanResult,
} from '@event-platform/shared';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser } from '../auth/decorators';
import { CheckInService } from '../check-in/check-in.service';
import { pagination } from '../common/pagination';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { ScannerService } from './scanner.service';

/**
 * Entrance-staff API. Available to every authenticated role, but each route
 * resolves the event through AccessService.eventForScan – a SCANNER only
 * ever reaches events they are assigned to.
 */
@Controller('scanner')
export class ScannerController {
  constructor(
    private readonly scanner: ScannerService,
    private readonly checkIn: CheckInService,
  ) {}

  @Get('events')
  events(@CurrentUser() user: RequestUser): Promise<ScannerEventDto[]> {
    return this.scanner.events(user);
  }

  // Several scanners behind one venue Wi-Fi share an IP → generous limit.
  @Post('events/:eventId/check-in')
  @HttpCode(200)
  @Throttle({ default: { limit: 900, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  scan(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(checkInSchema)) body: CheckInInput,
  ): Promise<CheckInResponse> {
    return this.checkIn.checkIn(user, eventId, body);
  }

  @Get('events/:eventId/search')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  search(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Query('q') q?: string,
  ): Promise<ScannerSearchResultDto[]> {
    return this.scanner.search(user, eventId, (q ?? '').slice(0, 80));
  }

  @Get('events/:eventId/summary')
  summary(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<{ checkedIn: number; capacity: number | null }> {
    return this.scanner.summary(user, eventId);
  }

  @Get('history')
  history(@CurrentUser() user: RequestUser, @Query('eventId') eventId?: string): Promise<ScanLogDto[]> {
    return this.scanner.history(user, /^[0-9a-f-]{36}$/i.test(eventId ?? '') ? eventId : undefined);
  }
}

@AdminOnly()
@Controller('events/:eventId/check-ins')
export class EventCheckInsController {
  constructor(private readonly scanner: ScannerService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Query() query: Record<string, string>,
  ): Promise<Paginated<ScanLogDto>> {
    const result = SCAN_RESULTS.includes(query.result as ScanResult) ? (query.result as ScanResult) : undefined;
    return this.scanner.eventLog(user, eventId, { result, ...pagination(query) });
  }
}
