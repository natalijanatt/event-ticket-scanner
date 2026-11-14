import { Controller, Get, Header, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { isTicketToken, type PublicTicketDto } from '@event-platform/shared';
import * as QRCode from 'qrcode';
import { Public } from '../auth/decorators';
import { notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { TicketCryptoService } from './ticket-crypto.service';

/**
 * The guest-facing ticket. Possession of the link is the only credential, so:
 *  • responses are never cached or indexed and carry no referrer,
 *  • every failure is the same 404 (no hint whether a token "almost" exists),
 *  • the endpoint is rate limited per IP,
 *  • it is strictly READ-ONLY – viewing a ticket can never check it in.
 */
@Public()
@Controller('public/tickets')
export class PublicTicketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TicketCryptoService,
  ) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, private')
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  @Header('Referrer-Policy', 'no-referrer')
  async get(@Param('token') token: string): Promise<PublicTicketDto> {
    if (!isTicketToken(token)) throw notFound('Ulaznica nije pronađena.');
    const ticket = await this.prisma.ticket.findUnique({
      where: { tokenHash: this.crypto.hashToken(token) },
      include: {
        guest: { select: { firstName: true, lastName: true } },
        ticketType: { select: { name: true, color: true, instructions: true } },
        event: { include: { organizer: { select: { name: true, logoUrl: true } } } },
      },
    });
    if (!ticket) throw notFound('Ulaznica nije pronađena.');

    const qrSvg = await QRCode.toString(this.crypto.ticketUrl(token), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#0B1220', light: '#FFFFFF' },
    });

    // Forced dark mode (Samsung Internet, Chrome "auto dark") repaints CSS
    // backgrounds and SVG fills, which leaves a dark code on a dark tile. A
    // bitmap is left alone, so the PNG carries its own white background and the
    // full 4-module quiet zone, in pure black on white.
    const qrPng = await QRCode.toDataURL(this.crypto.ticketUrl(token), {
      type: 'image/png',
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 720,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    return {
      reference: ticket.reference,
      status: ticket.status,
      expired: ticket.status === 'VALID' && ticket.expiresAt !== null && ticket.expiresAt <= new Date(),
      usedAt: ticket.usedAt?.toISOString() ?? null,
      guestName: `${ticket.guest.firstName} ${ticket.guest.lastName}`.trim(),
      ticketType: ticket.ticketType,
      event: {
        name: ticket.event.name,
        startsAt: ticket.event.startsAt.toISOString(),
        endsAt: ticket.event.endsAt?.toISOString() ?? null,
        venueName: ticket.event.venueName,
        venueAddress: ticket.event.venueAddress,
        coverImageUrl: ticket.event.coverImageUrl,
        status: ticket.event.status,
        organizerName: ticket.event.organizer.name,
        organizerLogoUrl: ticket.event.organizer.logoUrl,
      },
      qrSvg,
      qrPng,
    };
  }
}
