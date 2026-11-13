import { SCAN_RESULT_TITLES, type CheckInResponse, type ScanResult } from '@event-platform/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_DISMISS_MS, ScanResultView } from './scan-result';

const ticket: NonNullable<CheckInResponse['ticket']> = {
  reference: 'K7QM2-XRD4H',
  guestName: 'Marko Petrović',
  ticketType: { id: 't1', name: 'VIP', color: '#B8862B', instructions: 'VIP ulaz je sa leve strane.' },
  usedAt: '2026-11-21T23:14:05.000Z',
};

const response = (result: ScanResult, withTicket = true): CheckInResponse => ({
  result,
  title: SCAN_RESULT_TITLES[result],
  scannedAt: '2026-11-21T23:14:05.000Z',
  ticket: withTicket ? ticket : null,
});

afterEach(() => vi.useRealTimers());

describe('scanner result states', () => {
  it('shows a green ULAZ DOZVOLJEN with guest, ticket type, reference and check-in time', () => {
    render(<ScanResultView outcome={{ kind: 'server', response: response('ADMITTED') }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByRole('heading', { name: 'ULAZ DOZVOLJEN' })).toBeInTheDocument();
    expect(screen.getByText('Marko Petrović')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('K7QM2-XRD4H')).toBeInTheDocument();
    expect(screen.getByText('Vreme ulaska')).toBeInTheDocument();
    expect(screen.getByText('VIP ulaz je sa leve strane.')).toBeInTheDocument();
  });

  it('shows a red KARTA JE VEĆ ISKORIŠĆENA with the original check-in time', () => {
    render(<ScanResultView outcome={{ kind: 'server', response: response('ALREADY_USED') }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByRole('heading', { name: 'KARTA JE VEĆ ISKORIŠĆENA' })).toBeInTheDocument();
    expect(screen.getByText('Prvi ulazak')).toBeInTheDocument();
    expect(screen.getByText('Marko Petrović')).toBeInTheDocument();
  });

  it.each([
    ['INVALID', 'NEVAŽEĆA KARTA', 'danger'],
    ['REVOKED', 'KARTA JE PONIŠTENA', 'danger'],
    ['WRONG_EVENT', 'KARTA NIJE ZA OVAJ DOGAĐAJ', 'warning'],
    ['EXPIRED', 'KARTA JE ISTEKLA', 'danger'],
    ['EVENT_NOT_ACTIVE', 'DOGAĐAJ NIJE AKTIVAN', 'warning'],
    ['CAPACITY_REACHED', 'KAPACITET JE POPUNJEN', 'warning'],
  ] as const)('shows %s as "%s"', (result, title, tone) => {
    render(<ScanResultView outcome={{ kind: 'server', response: response(result, false) }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-tone', tone);
    // No ticket details are shown for a rejected, unidentified ticket.
    expect(screen.queryByText('Marko Petrović')).not.toBeInTheDocument();
  });

  it('never looks like a successful entry when the server is unreachable', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(<ScanResultView outcome={{ kind: 'network' }} onDismiss={onDismiss} onRetry={onRetry} />);

    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-tone', 'offline');
    expect(screen.getByRole('heading', { name: 'PROVERA NIJE USPELA — PROVERI INTERNET KONEKCIJU' })).toBeInTheDocument();
    expect(screen.getByText(/Karta NIJE proverena/)).toBeInTheDocument();
    expect(screen.queryByText('ULAZ DOZVOLJEN')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Pokušaj ponovo/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('auto-dismisses a successful scan so the queue keeps moving', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ScanResultView outcome={{ kind: 'server', response: response('ADMITTED') }} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(AUTO_DISMISS_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejection on screen until staff acknowledge it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDismiss = vi.fn();
    render(<ScanResultView outcome={{ kind: 'server', response: response('ALREADY_USED') }} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(AUTO_DISMISS_MS * 4));
    expect(onDismiss).not.toHaveBeenCalled();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Sledeća karta' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
