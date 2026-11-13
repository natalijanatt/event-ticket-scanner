import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  addGuestSchema,
  bulkGuestsSchema,
  eventGuestIdsSchema,
  exportGuestsSchema,
  GUEST_EMAIL_STATUSES,
  GUEST_TICKET_STATES,
  updateGuestSchema,
  type AddGuestInput,
  type BulkGuestsInput,
  type BulkGuestsResult,
  type EventGuestIdsInput,
  type GuestEmailStatus,
  type GuestMutationResult,
  type GuestRowDto,
  type GuestTicketState,
  type ImportResultDto,
  type Paginated,
  type UpdateGuestInput,
} from '@event-platform/shared';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser } from '../auth/decorators';
import { pagination } from '../common/pagination';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { IMPORT_MAX_BYTES } from './guest-import';
import { GuestsService, type GuestListQuery } from './guests.service';

function parseFilters(query: Record<string, string>): Omit<GuestListQuery, 'page' | 'pageSize'> {
  return {
    search: query.search?.slice(0, 100),
    ticketTypeId: /^[0-9a-f-]{36}$/i.test(query.ticketTypeId ?? '') ? query.ticketTypeId : undefined,
    emailStatus: GUEST_EMAIL_STATUSES.includes(query.emailStatus as GuestEmailStatus) ? (query.emailStatus as GuestEmailStatus) : undefined,
    ticketState: GUEST_TICKET_STATES.includes(query.ticketState as GuestTicketState) ? (query.ticketState as GuestTicketState) : undefined,
    checkedIn: query.checkedIn === 'yes' || query.checkedIn === 'no' ? query.checkedIn : undefined,
  };
}

// Entire controller is admin-only: scanners can never list or export guests.
@AdminOnly()
@Controller('events/:eventId/guests')
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Query() query: Record<string, string>,
  ): Promise<Paginated<GuestRowDto>> {
    return this.guests.list(user, eventId, { ...parseFilters(query), ...pagination(query) });
  }

  @Get('ids')
  listIds(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Query() query: Record<string, string>,
  ): Promise<{ ids: string[] }> {
    return this.guests.listIds(user, eventId, { ...parseFilters(query), page: 1, pageSize: 1 });
  }

  @Post()
  add(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(addGuestSchema)) body: AddGuestInput,
  ): Promise<GuestMutationResult> {
    return this.guests.add(user, eventId, body);
  }

  @Post('bulk')
  addBulk(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(bulkGuestsSchema)) body: BulkGuestsInput,
  ): Promise<BulkGuestsResult> {
    return this.guests.addBulk(user, eventId, body.guests);
  }

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  import(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun?: string,
    @Query('defaultTicketTypeId') defaultTicketTypeId?: string,
  ): Promise<ImportResultDto> {
    return this.guests.import(user, eventId, file, { dryRun: dryRun !== 'false', defaultTicketTypeId });
  }

  @Post('export')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async export(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(exportGuestsSchema)) body: { eventGuestIds?: string[] },
    @Res() res: Response,
  ): Promise<void> {
    const { filename, csv } = await this.guests.exportCsv(user, eventId, body.eventGuestIds);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Post('remove')
  @HttpCode(200)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(eventGuestIdsSchema)) body: EventGuestIdsInput,
  ): Promise<{ removed: number; skippedCheckedIn: number }> {
    return this.guests.remove(user, eventId, body.eventGuestIds);
  }

  @Patch(':eventGuestId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Param('eventGuestId', Uuid) eventGuestId: string,
    @Body(zod(updateGuestSchema)) body: UpdateGuestInput,
  ): Promise<GuestRowDto> {
    return this.guests.update(user, eventId, eventGuestId, body);
  }
}
