import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CsrfMiddleware } from './common/csrf.middleware';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ConfigModule } from './config/config.module';
import { EmailModule } from './email/email.module';
import { EventsModule } from './events/events.module';
import { GuestsModule } from './guests/guests.module';
import { HealthController } from './health.controller';
import { InvitationsModule } from './invitations/invitations.module';
import { OrganizersModule } from './organizers/organizers.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScannerModule } from './scanner/scanner.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CommonModule,
    AuditModule,
    EmailModule,
    AuthModule,
    // Baseline per-IP limit; credential and public-ticket routes tighten it.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 600 }],
      skipIf: () => process.env.NODE_ENV === 'test' && process.env.THROTTLE_IN_TESTS !== 'true',
    }),
    ScheduleModule.forRoot(),
    UsersModule,
    OrganizersModule,
    EventsModule,
    TicketTypesModule,
    GuestsModule,
    TicketsModule,
    InvitationsModule,
    ScannerModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
