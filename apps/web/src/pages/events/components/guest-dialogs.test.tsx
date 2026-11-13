import type { EventDto, GuestMutationResult, InvitationPreviewDto, TicketTypeDto } from '@event-platform/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '@/test/utils';
import { GuestFormDialog, parseGuestLines } from './guest-dialogs';
import { EmailPreviewDialog, SendInvitationsDialog } from './invitation-dialogs';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const REGULAR = '22222222-2222-4222-8222-222222222222';
const VIP = '33333333-3333-4333-8333-333333333333';

const event: EventDto = {
  id: EVENT_ID,
  organizerId: 'o1',
  organizerName: 'Club Central',
  name: 'Friday Night Party',
  description: null,
  startsAt: '2026-11-21T22:00:00.000Z',
  endsAt: null,
  venueName: 'Club Central',
  venueAddress: null,
  coverImageUrl: null,
  status: 'ACTIVE',
  capacity: null,
  enforceCapacity: false,
  archivedAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  counts: { guests: 0, tickets: 0, checkedIn: 0 },
};

const ticketTypes: TicketTypeDto[] = [
  { id: REGULAR, eventId: EVENT_ID, name: 'Regular', description: null, capacity: null, color: '#5B6577', instructions: null, ticketCount: 0, allocatedCount: 0 },
  { id: VIP, eventId: EVENT_ID, name: 'VIP', description: null, capacity: 60, color: '#B8862B', instructions: null, ticketCount: 0, allocatedCount: 0 },
];

const created: GuestMutationResult = {
  guest: {
    id: 'eg1',
    guestId: 'g1',
    firstName: 'Marko',
    lastName: 'Petrović',
    email: 'marko@example.com',
    phone: null,
    notes: null,
    ticketType: { id: REGULAR, name: 'Regular', color: '#5B6577' },
    ticketQuantity: 2,
    tickets: { valid: 2, used: 0, revoked: 0 },
    ticketState: 'VALID',
    emailStatus: 'QUEUED',
    emailError: null,
    lastEmailAt: null,
    firstCheckInAt: null,
    createdAt: '2026-11-13T10:00:00.000Z',
  },
  alreadyOnEvent: false,
  ticketsGenerated: 2,
  invitationQueued: true,
};

const me = { path: '/auth/me', status: 401, body: {} };
const refresh = { method: 'POST', path: '/auth/refresh', status: 401, body: {} };

describe('guest creation form', () => {
  it('creates a guest and sends the invitation in one step', async () => {
    const calls = mockApi([me, refresh, { method: 'POST', path: `/events/${EVENT_ID}/guests`, status: 201, body: created }]);
    const onOpenChange = vi.fn();
    renderApp(<GuestFormDialog event={event} ticketTypes={ticketTypes} open onOpenChange={onOpenChange} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Ime'), 'Marko');
    await user.type(screen.getByLabelText(/Prezime/), 'Petrović');
    await user.type(screen.getByLabelText('Email adresa'), ' Marko@Example.com ');
    const quantity = screen.getByLabelText('Broj karata');
    await user.clear(quantity);
    await user.type(quantity, '2');

    // With an active event the primary action is the single-invitation flow.
    await user.click(screen.getByRole('button', { name: 'Pošalji pozivnicu' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = calls.find((c) => c.method === 'POST' && c.path === `/events/${EVENT_ID}/guests`);
    expect(request?.body).toMatchObject({
      firstName: 'Marko',
      lastName: 'Petrović',
      email: 'marko@example.com',
      ticketTypeId: REGULAR,
      ticketQuantity: 2,
      sendInvitation: true,
    });
    // A request id makes a repeated submit idempotent on the server.
    expect((request?.body as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows validation errors and does not call the API', async () => {
    const calls = mockApi([me, refresh]);
    renderApp(<GuestFormDialog event={event} ticketTypes={ticketTypes} open onOpenChange={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email adresa'), 'nije-email');
    const quantity = screen.getByLabelText('Broj karata');
    await user.clear(quantity);
    await user.type(quantity, '50');
    await user.click(screen.getByRole('button', { name: 'Pošalji pozivnicu' }));

    expect(await screen.findByText('Ime je obavezno polje.')).toBeInTheDocument();
    expect(screen.getByText('Unesi ispravnu email adresu.')).toBeInTheDocument();
    expect(screen.getByText('Najviše 20 karata po gostu.')).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('/guests'))).toBe(false);
  });

  it('only adds the guest (no invitation) while the event is a draft', async () => {
    const calls = mockApi([me, refresh, { method: 'POST', path: `/events/${EVENT_ID}/guests`, status: 201, body: { ...created, ticketsGenerated: 0, invitationQueued: false } }]);
    renderApp(<GuestFormDialog event={{ ...event, status: 'DRAFT' }} ticketTypes={ticketTypes} open onOpenChange={vi.fn()} />);
    const user = userEvent.setup();

    expect(screen.getByText('Dostupno kada je događaj aktivan.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Ime'), 'Ana');
    await user.type(screen.getByLabelText('Email adresa'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Dodaj gosta' }));

    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/guests'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/guests'))?.body).toMatchObject({ sendInvitation: false });
  });

  it('puts a server-side field error next to its input', async () => {
    mockApi([
      me,
      refresh,
      { method: 'PATCH', path: `/events/${EVENT_ID}/guests/eg1`, status: 400, body: { statusCode: 400, code: 'EMAIL_IN_USE', message: 'Proveri unete podatke.', fieldErrors: { email: 'Drugi gost već koristi ovu email adresu.' } } },
    ]);
    renderApp(<GuestFormDialog event={event} ticketTypes={ticketTypes} guest={created.guest} open onOpenChange={vi.fn()} />);
    const user = userEvent.setup();
    expect(screen.getByLabelText('Ime')).toHaveValue('Marko');
    await user.click(screen.getByRole('button', { name: 'Sačuvaj izmene' }));
    expect(await screen.findByText('Drugi gost već koristi ovu email adresu.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email adresa')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('bulk paste parsing', () => {
  it('reads names and e-mails in the common formats', () => {
    const parsed = parseGuestLines('Marko Petrović, marko@example.com\nJelena Jovanović <JELENA@example.com>\n\nana@example.com\nBez mejla');
    expect(parsed.map((p) => p.guest ?? p.error)).toEqual([
      { firstName: 'Marko', lastName: 'Petrović', email: 'marko@example.com' },
      { firstName: 'Jelena', lastName: 'Jovanović', email: 'jelena@example.com' },
      { firstName: 'ana', lastName: '', email: 'ana@example.com' },
      'Nedostaje email adresa.',
    ]);
  });
});

describe('email preview', () => {
  const preview: InvitationPreviewDto = {
    to: 'marko@example.com',
    subject: 'Pozivnica za Friday Night Party – 21. novembar',
    html: '<html><body><h1>Zdravo, Marko!</h1><script>window.parent.hacked = true</script></body></html>',
  };

  it('shows the recipient, the subject and the rendered template in a sandboxed frame', async () => {
    const calls = mockApi([me, refresh, { method: 'POST', path: `/events/${EVENT_ID}/invitations/preview`, body: preview }]);
    renderApp(<EmailPreviewDialog eventId={EVENT_ID} eventGuestId="eg1" open onOpenChange={vi.fn()} />);

    expect(await screen.findByText(preview.subject)).toBeInTheDocument();
    expect(screen.getByText('marko@example.com')).toBeInTheDocument();
    const frame = screen.getByTitle('Pregled pozivnice') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toContain('Zdravo, Marko!');
    // Empty sandbox: template markup can never script the admin panel.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(calls.find((c) => c.path.endsWith('/invitations/preview'))?.body).toEqual({ eventGuestId: 'eg1' });
  });

  it('shows an error state when the preview cannot be loaded', async () => {
    mockApi([me, refresh, { method: 'POST', path: `/events/${EVENT_ID}/invitations/preview`, status: 404, body: { statusCode: 404, code: 'NOT_FOUND', message: 'Dodaj bar jednog gosta da bi video/la pregled pozivnice.' } }]);
    renderApp(<EmailPreviewDialog eventId={EVENT_ID} open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Dodaj bar jednog gosta da bi video/la pregled pozivnice.')).toBeInTheDocument();
  });
});

describe('bulk send confirmation', () => {
  const ids = ['a1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111'];

  it('shows recipients, tickets and the event name before sending, then sends once', async () => {
    const calls = mockApi([
      me,
      refresh,
      { method: 'POST', path: `/events/${EVENT_ID}/invitations/summary`, body: { eventName: 'Friday Night Party', recipients: 2, tickets: 5, ticketsToGenerate: 3, skippedAlreadySent: 1, skippedNoTickets: 0 } },
      { method: 'POST', path: `/events/${EVENT_ID}/invitations/send`, body: { queued: 2, skippedAlreadySent: 1, skippedNoTickets: 0, ticketsGenerated: 3 } },
    ]);
    const onOpenChange = vi.fn();
    renderApp(<SendInvitationsDialog eventId={EVENT_ID} eventGuestIds={ids} mode="SEND" open onOpenChange={onOpenChange} />);
    const user = userEvent.setup();

    expect(await screen.findByText('Friday Night Party')).toBeInTheDocument();
    expect(screen.getByText('Broj primalaca').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Broj karata').nextElementSibling).toHaveTextContent('5');
    expect(screen.getByText(/pozivnica je već poslata/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pošalji izabrane pozivnice' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    const sends = calls.filter((c) => c.path.endsWith('/invitations/send'));
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toMatchObject({ eventGuestIds: ids, mode: 'SEND' });
    expect((sends[0].body as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('disables sending when nobody would receive an e-mail', async () => {
    mockApi([me, refresh, { method: 'POST', path: `/events/${EVENT_ID}/invitations/summary`, body: { eventName: 'Friday Night Party', recipients: 0, tickets: 0, ticketsToGenerate: 0, skippedAlreadySent: 3, skippedNoTickets: 0 } }]);
    renderApp(<SendInvitationsDialog eventId={EVENT_ID} eventGuestIds={ids} mode="SEND" open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/Nema kome da se pošalje/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pošalji pozivnicu' })).toBeDisabled();
  });
});
