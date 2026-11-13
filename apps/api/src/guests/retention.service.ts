import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Data retention: anonymizes guest personal data once every event the guest
 * was invited to ended more than `organizer.retentionDays` days ago.
 *
 * What is erased:  name, e-mail, phone, organizer notes, recipient address of
 *                  past deliveries, and the encrypted ticket link.
 * What is kept:    the ticket rows and scan logs themselves – they contain no
 *                  personal data and remain the minimal audit record of who
 *                  (anonymous) entered when.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 3 * * *')
  async runScheduled(): Promise<void> {
    try {
      const count = await this.run();
      if (count > 0) this.logger.log(`Retention: anonymized ${count} guest(s)`);
    } catch (err) {
      this.logger.error(`Retention run failed: ${(err as Error).message}`);
    }
  }

  /** Anonymizes all guests past their retention period. Returns how many. */
  async run(organizerId?: string, now = new Date()): Promise<number> {
    const organizers = await this.prisma.organizer.findMany({
      where: { retentionDays: { gt: 0 }, ...(organizerId ? { id: organizerId } : {}) },
      select: { id: true, retentionDays: true },
    });
    let total = 0;
    for (const organizer of organizers) {
      const cutoff = new Date(now.getTime() - organizer.retentionDays * 24 * 60 * 60 * 1000);
      const guests = await this.prisma.guest.findMany({
        where: {
          organizerId: organizer.id,
          anonymizedAt: null,
          // No event that is still running, upcoming, or ended after the cutoff …
          eventGuests: {
            none: {
              event: {
                OR: [{ endsAt: { gt: cutoff } }, { endsAt: null, startsAt: { gt: cutoff } }],
              },
            },
          },
          // … and nothing recent about the guest record itself.
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        take: 5000,
      });
      for (const guest of guests) {
        await this.anonymize(guest.id);
        total++;
      }
    }
    return total;
  }

  async anonymize(guestId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.guest.update({
        where: { id: guestId },
        data: {
          firstName: 'Anonimizovan',
          lastName: 'gost',
          // Unique placeholder keeps the (organizer, email) constraint satisfied.
          email: `anon-${guestId}@anonymized.invalid`,
          phone: null,
          anonymizedAt: new Date(),
        },
      }),
      this.prisma.eventGuest.updateMany({ where: { guestId }, data: { notes: null } }),
      this.prisma.emailDelivery.updateMany({ where: { eventGuest: { guestId } }, data: { toEmail: 'anonimizovano', lastError: null } }),
      // The ticket link can no longer be rebuilt or re-sent.
      this.prisma.ticket.updateMany({ where: { guestId }, data: { tokenCipher: '' } }),
      this.prisma.ticket.updateMany({ where: { guestId, status: 'VALID' }, data: { status: 'REVOKED', revokedAt: new Date() } }),
    ] as Prisma.PrismaPromise<unknown>[]);
  }
}
