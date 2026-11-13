import { Controller, Get, Module, Param } from '@nestjs/common';
import type { DashboardDto, EventStatsDto } from '@event-platform/shared';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser } from '../auth/decorators';
import { Uuid } from '../common/uuid.pipe';
import { EventsModule } from '../events/events.module';
import { AnalyticsService } from './analytics.service';

@AdminOnly()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: RequestUser): Promise<DashboardDto> {
    return this.analytics.dashboard(user);
  }

  @Get('events/:eventId/stats')
  stats(@CurrentUser() user: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<EventStatsDto> {
    return this.analytics.eventStats(user, eventId);
  }
}

@Module({ imports: [EventsModule], controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
