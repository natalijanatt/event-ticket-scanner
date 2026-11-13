import type { EmailStatus } from '@event-platform/shared';
import { csvCell, toCsv } from '../common/csv';
import { invitationSubject, renderInvitationHtml, renderInvitationText, ticketsNoun, type InvitationData } from '../email/templates/invitation.template';
import { allowedPredecessors, canTransition, targetStatus } from './delivery-status';
import { signWebhook, verifyWebhookSignature } from './webhook-signature';

describe('e-mail delivery state machine', () => {
  it('moves forward through the normal lifecycle', () => {
    expect(canTransition('QUEUED', 'SENDING')).toBe(true);
    expect(canTransition('SENDING', 'SENT')).toBe(true);
    expect(canTransition('SENT', 'DELIVERED')).toBe(true);
  });

  it('ignores duplicate events', () => {
    for (const s of ['SENT', 'DELIVERED', 'BOUNCED', 'FAILED'] as EmailStatus[]) expect(canTransition(s, s)).toBe(false);
  });

  it('ignores events that arrive out of order', () => {
    expect(canTransition('DELIVERED', 'SENT')).toBe(false); // "sent" after "delivered"
    expect(canTransition('BOUNCED', 'DELIVERED')).toBe(false); // "delivered" after "bounced"
    expect(canTransition('BOUNCED', 'SENT')).toBe(false);
  });

  it('lets a bounce override an optimistic status', () => {
    expect(canTransition('SENT', 'BOUNCED')).toBe(true);
    expect(canTransition('DELIVERED', 'BOUNCED')).toBe(true);
  });

  it('never claims delivery from "accepted by provider"', () => {
    expect(targetStatus('sent')).toBe('SENT');
    expect(targetStatus('delivered')).toBe('DELIVERED');
    expect(targetStatus('delivery_delayed')).toBeNull();
    expect(targetStatus('complained')).toBeNull();
  });

  it('derives the atomic WHERE guard from the same ranks', () => {
    expect(allowedPredecessors('DELIVERED').sort()).toEqual(['QUEUED', 'SENDING', 'SENT']);
    expect(allowedPredecessors('SENT').sort()).toEqual(['QUEUED', 'SENDING']);
  });
});

describe('webhook signature verification', () => {
  const secret = `whsec_${Buffer.from('super-secret-signing-key').toString('base64')}`;
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc' } });
  const now = new Date('2026-11-21T12:00:00Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const id = 'msg_1';
  const signatureHeader = signWebhook(secret, id, timestamp, body);

  it('accepts a correctly signed payload', () => {
    expect(verifyWebhookSignature({ secret, id, timestamp, signatureHeader, rawBody: body, now })).toBe(true);
    expect(verifyWebhookSignature({ secret, id, timestamp, signatureHeader: `v1,AAAA ${signatureHeader}`, rawBody: Buffer.from(body), now })).toBe(true);
  });

  it('rejects a modified body, id or secret', () => {
    expect(verifyWebhookSignature({ secret, id, timestamp, signatureHeader, rawBody: body.replace('delivered', 'bounced'), now })).toBe(false);
    expect(verifyWebhookSignature({ secret, id: 'msg_2', timestamp, signatureHeader, rawBody: body, now })).toBe(false);
    expect(verifyWebhookSignature({ secret: `whsec_${Buffer.from('other').toString('base64')}`, id, timestamp, signatureHeader, rawBody: body, now })).toBe(false);
  });

  it('rejects replays outside the tolerance window', () => {
    const later = new Date(now.getTime() + 6 * 60 * 1000);
    expect(verifyWebhookSignature({ secret, id, timestamp, signatureHeader, rawBody: body, now: later })).toBe(false);
  });

  it('rejects missing headers', () => {
    expect(verifyWebhookSignature({ secret, id: undefined, timestamp, signatureHeader, rawBody: body, now })).toBe(false);
    expect(verifyWebhookSignature({ secret, id, timestamp, signatureHeader: undefined, rawBody: body, now })).toBe(false);
    expect(verifyWebhookSignature({ secret: '', id, timestamp, signatureHeader, rawBody: body, now })).toBe(false);
  });
});

describe('invitation template', () => {
  const base: InvitationData = {
    guestFirstName: 'Marko',
    eventName: 'Friday Night Party',
    dateLong: '21. novembar 2026.',
    dateShort: '21. novembar',
    time: '23:00',
    venueName: 'Club Central',
    venueAddress: null,
    organizerName: 'Club Central',
    coverImageUrl: null,
    instructions: null,
    tickets: [{ reference: 'AAAAA-BBBBB', url: 'https://tickets.example.com/t/x', typeName: 'VIP' }],
  };

  it('builds the subject', () => {
    expect(invitationSubject(base)).toBe('Pozivnica za Friday Night Party – 21. novembar');
  });

  it('renders the single-ticket invitation in Serbian', () => {
    const html = renderInvitationHtml(base);
    expect(html).toContain('Zdravo, Marko!');
    expect(html).toContain('OTVORI ULAZNICU');
    expect(html).toContain('https://tickets.example.com/t/x');
    expect(html).toContain('Vidimo se!');
    expect(renderInvitationText(base)).toContain('Datum: 21. novembar 2026.');
  });

  it('states the quantity and links every ticket for multi-ticket invitations', () => {
    const tickets = [1, 2, 3].map((n) => ({ reference: `REF-${n}`, url: `https://tickets.example.com/t/${n}`, typeName: 'Regular' }));
    const html = renderInvitationHtml({ ...base, tickets });
    expect(html).toContain('3 ulaznice');
    for (const t of tickets) expect(html).toContain(t.url);
    expect(html).toContain('Ulaznica 2 od 3');
  });

  it('escapes guest-controlled content', () => {
    const html = renderInvitationHtml({ ...base, guestFirstName: '<script>alert(1)</script>', eventName: 'A & B "Party"' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &quot;Party&quot;');
  });

  it('uses Serbian plural forms', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25].map(ticketsNoun)).toEqual([
      'ulaznica', 'ulaznice', 'ulaznice', 'ulaznica', 'ulaznica', 'ulaznica', 'ulaznica', 'ulaznice', 'ulaznica',
    ]);
  });
});

describe('CSV export', () => {
  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+381641234567')).toBe("'+381641234567");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-1')).toBe("'-1");
  });

  it('quotes separators and keeps plain values untouched', () => {
    expect(csvCell('Petrović, Marko')).toBe('"Petrović, Marko"');
    expect(csvCell('Marko')).toBe('Marko');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['Ime'], [['Ana']])).toBe('﻿Ime\r\nAna\r\n');
  });
});
