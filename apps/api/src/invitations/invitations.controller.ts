import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  EMAIL_STATUSES,
  invitationSummarySchema,
  previewInvitationSchema,
  sendInvitationsSchema,
  type DeliveryRowDto,
  type EmailStatus,
  type InvitationPreviewDto,
  type InvitationSummaryDto,
  type InvitationSummaryInput,
  type Paginated,
  type SendInvitationsInput,
  type SendInvitationsResult,
} from '@event-platform/shared';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser } from '../auth/decorators';
import { pagination } from '../common/pagination';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { InvitationsService } from './invitations.service';

@AdminOnly()
@Controller('events/:eventId/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Query() query: Record<string, string>,
  ): Promise<Paginated<DeliveryRowDto>> {
    const status = EMAIL_STATUSES.includes(query.status as EmailStatus) ? (query.status as EmailStatus) : undefined;
    return this.invitations.list(user, eventId, { status, search: query.search?.slice(0, 100), ...pagination(query) });
  }

  @Post('send')
  @HttpCode(200)
  send(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(sendInvitationsSchema)) body: SendInvitationsInput,
  ): Promise<SendInvitationsResult> {
    return this.invitations.send(user, eventId, body);
  }

  @Post('summary')
  @HttpCode(200)
  summary(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(invitationSummarySchema)) body: InvitationSummaryInput,
  ): Promise<InvitationSummaryDto> {
    return this.invitations.summary(user, eventId, body);
  }

  @Post('preview')
  @HttpCode(200)
  preview(
    @CurrentUser() user: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(previewInvitationSchema)) body: { eventGuestId?: string },
  ): Promise<InvitationPreviewDto> {
    return this.invitations.preview(user, eventId, body.eventGuestId);
  }
}
