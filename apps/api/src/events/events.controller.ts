import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Sse, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { eventInputSchema, eventUpdateSchema, type EventDto, type EventInput, type EventUpdateInput } from '@event-platform/shared';
import { memoryStorage } from 'multer';
import type { Observable } from 'rxjs';
import { AccessService } from '../auth/access.service';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser } from '../auth/decorators';
import { RealtimeService } from '../common/realtime.service';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { EventsService } from './events.service';

@AdminOnly()
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query('archived') archived?: string, @Query('search') search?: string): Promise<EventDto[]> {
    return this.events.list(user, { archived: archived === 'true', search: search?.trim().slice(0, 100) || undefined });
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body(zod(eventInputSchema)) body: EventInput): Promise<EventDto> {
    return this.events.create(user, body);
  }

  @Get(':eventId')
  get(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<EventDto> {
    return this.events.get(user, eventId);
  }

  @Patch(':eventId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(eventUpdateSchema)) body: EventUpdateInput,
  ): Promise<EventDto> {
    return this.events.update(user, eventId, body);
  }

  @Post(':eventId/duplicate')
  duplicate(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<EventDto> {
    return this.events.duplicate(user, eventId);
  }

  @Post(':eventId/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<EventDto> {
    return this.events.setArchived(user, eventId, true);
  }

  @Post(':eventId/unarchive')
  @HttpCode(200)
  unarchive(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<EventDto> {
    return this.events.setArchived(user, eventId, false);
  }

  @Delete(':eventId')
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<void> {
    return this.events.remove(user, eventId);
  }

  @Post(':eventId/cover')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  setCover(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<EventDto> {
    return this.events.setCover(user, eventId, file);
  }

  @Delete(':eventId/cover')
  removeCover(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<EventDto> {
    return this.events.removeCover(user, eventId);
  }

  /** Server-Sent Events: "something changed" hints for live dashboards. */
  @SkipThrottle()
  @Sse(':eventId/stream')
  async stream(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<Observable<{ data: { type: string } }>> {
    await this.access.eventForManage(user, eventId);
    return this.realtime.stream(eventId);
  }
}
