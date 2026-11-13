import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from './auth/decorators';
import { PrismaService } from './prisma/prisma.service';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness + database readiness. 503 when the database is unreachable. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'degraded'; database: 'up' | 'down'; uptime: number }> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: database === 'up' ? 'ok' : 'degraded', database, uptime: Math.round(process.uptime()) };
  }
}
