import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ticketTypeInputSchema, type TicketTypeDto, type TicketTypeInput } from '@event-platform/shared';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser } from '../auth/decorators';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { TicketTypesService } from './ticket-types.service';

@AdminOnly()
@Controller('events/:eventId/ticket-types')
export class TicketTypesController {
  constructor(private readonly ticketTypes: TicketTypesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<TicketTypeDto[]> {
    return this.ticketTypes.list(user, eventId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(ticketTypeInputSchema)) body: TicketTypeInput,
  ): Promise<TicketTypeDto> {
    return this.ticketTypes.create(user, eventId, body);
  }

  @Patch(':ticketTypeId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Param('ticketTypeId', Uuid) ticketTypeId: string,
    @Body(zod(ticketTypeInputSchema)) body: TicketTypeInput,
  ): Promise<TicketTypeDto> {
    return this.ticketTypes.update(user, eventId, ticketTypeId, body);
  }

  @Delete(':ticketTypeId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Param('ticketTypeId', Uuid) ticketTypeId: string,
  ): Promise<void> {
    return this.ticketTypes.remove(user, eventId, ticketTypeId);
  }
}
