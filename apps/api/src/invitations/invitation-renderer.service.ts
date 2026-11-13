import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { formatDateLong, formatDateShort, formatTime } from '../common/dates';
import { AppConfig } from '../config/app-config';
import type { EmailAttachment } from '../email/email.types';
import {
  invitationSubject,
  renderInvitationHtml,
  renderInvitationText,
  type InvitationData,
  type InvitationTicket,
} from '../email/templates/invitation.template';
import { PrismaService } from '../prisma/prisma.service';
import { TicketCryptoService } from '../tickets/ticket-crypto.service';

export interface RenderedInvitation {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
  ticketCount: number;
}

/** Above this many tickets the QR images are left out of the e-mail to keep it small. */
const MAX_EMBEDDED_QR = 6;

@Injectable()
export class InvitationRenderer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TicketCryptoService,
    private readonly config: AppConfig,
  ) {}

  subjectFor(event: { name: string; startsAt: Date }): string {
    return invitationSubject({ eventName: event.name, dateShort: formatDateShort(event.startsAt, this.config.timezone) });
  }

  /**
   * Builds the invitation for one guest of one event from their VALID tickets.
   *  mode 'send'    – QR codes as inline CID attachments (what goes to the provider)
   *  mode 'preview' – QR codes as data URLs; guests without tickets get sample tickets
   * Returns null when there is nothing to send.
   */
  async render(eventGuestId: string, mode: 'send' | 'preview'): Promise<RenderedInvitation | null> {
    const eg = await this.prisma.eventGuest.findUnique({
      where: { id: eventGuestId },
      include: {
        guest: true,
        ticketType: true,
        event: { include: { organizer: { select: { name: true } } } },
        tickets: { where: { status: 'VALID' }, include: { ticketType: { select: { name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!eg) return null;

    const embedQr = this.config.emailEmbedQr;
    const attachments: EmailAttachment[] = [];
    let tickets: InvitationTicket[] = [];

    for (const ticket of eg.tickets) {
      const url = this.crypto.ticketUrl(this.crypto.decrypt(ticket.tokenCipher, ticket.id));
      tickets.push({ reference: ticket.reference, url, typeName: ticket.ticketType.name });
    }

    if (tickets.length === 0) {
      if (mode === 'send') return null;
      // Preview before tickets exist: illustrate with the allocated quantity.
      tickets = Array.from({ length: eg.ticketQuantity }, (_, i) => ({
        reference: `PRIMER-${String(i + 1).padStart(4, '0')}`,
        url: `${this.config.publicAppUrl}/t/primer`,
        typeName: eg.ticketType.name,
      }));
    }

    if (embedQr && tickets.length <= MAX_EMBEDDED_QR) {
      for (const [index, ticket] of tickets.entries()) {
        const png = await QRCode.toBuffer(ticket.url, { type: 'png', width: 336, margin: 2, errorCorrectionLevel: 'M' });
        if (mode === 'preview') {
          ticket.qrSrc = `data:image/png;base64,${png.toString('base64')}`;
        } else {
          const contentId = `qr-${index + 1}`;
          ticket.qrSrc = `cid:${contentId}`;
          attachments.push({ filename: `ulaznica-${ticket.reference}.png`, content: png, contentId });
        }
      }
    }

    const tz = this.config.timezone;
    const data: InvitationData = {
      guestFirstName: eg.guest.firstName,
      eventName: eg.event.name,
      dateLong: formatDateLong(eg.event.startsAt, tz),
      dateShort: formatDateShort(eg.event.startsAt, tz),
      time: formatTime(eg.event.startsAt, tz),
      venueName: eg.event.venueName,
      venueAddress: eg.event.venueAddress,
      organizerName: eg.event.organizer.name,
      coverImageUrl: eg.event.coverImageUrl ? `${this.config.publicAppUrl}${eg.event.coverImageUrl}` : null,
      instructions: eg.ticketType.instructions,
      tickets,
    };

    return {
      to: eg.guest.email,
      subject: invitationSubject(data),
      html: renderInvitationHtml(data),
      text: renderInvitationText(data),
      attachments,
      ticketCount: tickets.length,
    };
  }
}
