import type { PublicTicketDto } from '@event-platform/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '@/test/utils';
import { TicketPage, ticketNotice } from './ticket-page';

const TOKEN = 'J4sxvdIaEPLHt2RGSClPQ7urnZ4iIK1bpukaqJ69-z8';

const ticket: PublicTicketDto = {
  reference: 'K7QM2-XRD4H',
  status: 'VALID',
  expired: false,
  usedAt: null,
  guestName: 'Marko Petrović',
  ticketType: { name: 'VIP', color: '#B8862B', instructions: 'VIP ulaz je sa leve strane.' },
  event: {
    name: 'Friday Night Party',
    startsAt: '2026-11-21T22:00:00.000Z',
    endsAt: null,
    venueName: 'Club Central',
    venueAddress: 'Karađorđeva 12, Beograd',
    coverImageUrl: null,
    status: 'ACTIVE',
    organizerName: 'Club Central',
  },
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

const me = { path: '/auth/me', status: 401, body: {} };
const refresh = { method: 'POST', path: '/auth/refresh', status: 401, body: {} };
const show = (body: PublicTicketDto) => {
  const calls = mockApi([me, refresh, { path: `/public/tickets/${TOKEN}`, body }]);
  renderApp(<TicketPage />, { route: `/t/${TOKEN}`, path: '/t/:token' });
  return calls;
};

describe('digital ticket (guest view)', () => {
  it('shows event, guest, ticket type, reference and a scannable QR code', async () => {
    const calls = show(ticket);

    expect(await screen.findByRole('heading', { name: 'Friday Night Party' })).toBeInTheDocument();
    expect(screen.getByText('Marko Petrović')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('K7QM2-XRD4H')).toBeInTheDocument();
    expect(screen.getByText('Club Central', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/21\. novembar 2026\./)).toBeInTheDocument();
    expect(screen.getByText('VIP ulaz je sa leve strane.')).toBeInTheDocument();

    const qr = screen.getByAltText('QR kod ulaznice — pokaži ga na ulazu') as HTMLImageElement;
    expect(qr.src).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByRole('button', { name: /Sačuvaj sliku/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Štampaj \/ PDF/ })).toBeEnabled();

    // Viewing is read-only: the page only ever GETs the ticket.
    expect(calls.filter((c) => c.path.startsWith('/public/tickets')).every((c) => c.method === 'GET')).toBe(true);
    expect(calls.some((c) => c.method !== 'GET' && c.path.includes('ticket'))).toBe(false);
  });

  it('says clearly when the ticket has already been used', async () => {
    show({ ...ticket, status: 'USED', usedAt: '2026-11-21T23:14:00.000Z' });
    expect(await screen.findByText('Karta je iskorišćena')).toBeInTheDocument();
    expect(screen.getByAltText('QR kod ulaznice (karta više ne važi)')).toBeInTheDocument();
  });

  it('says clearly when the ticket was revoked or the event cancelled', async () => {
    show({ ...ticket, status: 'REVOKED' });
    expect(await screen.findByText('Karta je poništena')).toBeInTheDocument();
    expect(ticketNotice({ ...ticket, event: { ...ticket.event, status: 'CANCELLED' } })?.title).toBe('Događaj je otkazan');
    expect(ticketNotice({ ...ticket, expired: true })?.title).toBe('Karta je istekla');
    expect(ticketNotice(ticket)).toBeNull(); // opened before the event: simply a valid ticket
  });

  it('shows a friendly message for an unknown link', async () => {
    mockApi([me, refresh]); // API answers 404
    renderApp(<TicketPage />, { route: `/t/${TOKEN}`, path: '/t/:token' });
    expect(await screen.findByRole('heading', { name: 'Ulaznica nije pronađena' })).toBeInTheDocument();
  });

  it('does not even call the API for a malformed link', async () => {
    const calls = mockApi([me, refresh]);
    renderApp(<TicketPage />, { route: '/t/nije-token', path: '/t/:token' });
    expect(await screen.findByRole('heading', { name: 'Ulaznica nije pronađena' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/public/tickets'))).toBe(false);
  });

  it('offers a retry when the network is down', async () => {
    mockApi([me, refresh, { path: `/public/tickets/${TOKEN}`, networkError: true }]);
    renderApp(<TicketPage />, { route: `/t/${TOKEN}`, path: '/t/:token' });
    expect(await screen.findByRole('heading', { name: 'Ulaznica nije učitana' }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pokušaj ponovo' })).toBeInTheDocument();
  }, 12_000);
});
