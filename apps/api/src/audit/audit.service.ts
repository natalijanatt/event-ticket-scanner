import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  organizerId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Counts and ids only – never names, e-mails or tokens. */
  metadata?: Prisma.InputJsonValue;
}

/** Records administrative actions. Failures are logged, never thrown: auditing must not break the action itself. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          organizerId: entry.organizerId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata,
        },
      });
    } catch (err) {
      this.logger.error(`Audit log write failed (${entry.action}): ${(err as Error).message}`);
    }
  }
}
