import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  eventGuestIdsSchema,
  revokeTicketsSchema,
  ticketUpdateSchema,
  TICKET_STATUSES,
  type EventGuestIdsInput,
  type GenerateTicketsResult,
  type Paginated,
  type RevokeTicketsInput,
  type RevokeTicketsResult,
  type TicketLinkDto,
  type TicketRowDto,
  type TicketStatus,
  type TicketUpdateInput,
} from '@event-platform/shared';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser } from '../auth/decorators';
import { pagination } from '../common/pagination';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { TicketsService } from './tickets.service';

@AdminOnly()
@Controller('events/:eventId/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Query() query: Record<string, string>,
  ): Promise<Paginated<TicketRowDto>> {
    const status = TICKET_STATUSES.includes(query.status as TicketStatus) ? (query.status as TicketStatus) : undefined;
    const ticketTypeId = /^[0-9a-f-]{36}$/i.test(query.ticketTypeId ?? '') ? query.ticketTypeId : undefined;
    return this.tickets.list(user, eventId, { search: query.search?.slice(0, 100), status, ticketTypeId, ...pagination(query) });
  }

  @Post('generate')
  @HttpCode(200)
  generate(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(eventGuestIdsSchema)) body: EventGuestIdsInput,
  ): Promise<GenerateTicketsResult> {
    return this.tickets.generate(user, eventId, body.eventGuestIds);
  }

  @Post('revoke')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(revokeTicketsSchema)) body: RevokeTicketsInput,
  ): Promise<RevokeTicketsResult> {
    return this.tickets.revoke(user, eventId, body);
  }

  @Post(':ticketId/regenerate')
  @HttpCode(200)
  regenerate(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Param('ticketId', Uuid) ticketId: string,
  ): Promise<TicketLinkDto> {
    return this.tickets.regenerate(user, eventId, ticketId);
  }

  @Get(':ticketId/link')
  link(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Param('ticketId', Uuid) ticketId: string,
  ): Promise<TicketLinkDto> {
    return this.tickets.link(user, eventId, ticketId);
  }

  @Patch(':ticketId')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Param('ticketId', Uuid) ticketId: string,
    @Body(zod(ticketUpdateSchema)) body: TicketUpdateInput,
  ): Promise<{ ok: true }> {
    await this.tickets.setExpiry(user, eventId, ticketId, body.expiresAt);
    return { ok: true };
  }
}
