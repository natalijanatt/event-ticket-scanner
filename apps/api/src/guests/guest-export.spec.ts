import type { GuestRowDto } from '@event-platform/shared';
import ExcelJS from 'exceljs';
import { buildGuestWorkbook, toExcelDate } from './guest-export';

const guest = (over: Partial<GuestRowDto>): GuestRowDto => ({
  id: 'eg-1',
  guestId: 'g-1',
  firstName: 'Ana',
  lastName: 'Marković',
  email: 'ana@example.com',
  phone: null,
  notes: null,
  ticketType: { id: 'tt-1', name: 'VIP', color: '#000000' },
  ticketQuantity: 2,
  tickets: { valid: 1, used: 1, revoked: 0 },
  ticketState: 'PARTIALLY_USED',
  emailStatus: 'DELIVERED',
  emailError: null,
  lastEmailAt: '2026-11-20T10:00:00.000Z',
  firstCheckInAt: '2026-11-21T22:14:00.000Z',
  createdAt: '2026-11-01T09:00:00.000Z',
  ...over,
});

describe('guest Excel export', () => {
  it('converts instants to wall-clock time in the configured zone', () => {
    // 22:14 UTC in November is 23:14 in Belgrade (CET).
    expect(toExcelDate('2026-11-21T22:14:00.000Z', 'Europe/Belgrade')?.toISOString()).toBe('2026-11-21T23:14:00.000Z');
    expect(toExcelDate(null, 'Europe/Belgrade')).toBeNull();
  });

  it('builds guests, tickets and summary sheets without evaluating guest input', async () => {
    const buffer = await buildGuestWorkbook({
      event: { name: 'Gala', startsAt: new Date('2026-11-21T20:00:00Z'), endsAt: null, venueName: 'Sala', status: 'ACTIVE' },
      guests: [
        guest({}),
        guest({
          id: 'eg-2',
          firstName: '=HYPERLINK("http://x")',
          ticketType: { id: 'tt-2', name: 'Regular', color: '#000000' },
          ticketQuantity: 1,
          tickets: { valid: 0, used: 0, revoked: 0 },
          ticketState: 'NONE',
          emailStatus: 'NOT_SENT',
          lastEmailAt: null,
          firstCheckInAt: null,
        }),
      ],
      tickets: [
        { eventGuestId: 'eg-1', reference: 'B-2', ticketTypeName: 'VIP', status: 'VALID', createdAt: new Date('2026-11-02T09:00:00Z'), usedAt: null, revokedAt: null, scannedBy: null },
        { eventGuestId: 'eg-1', reference: 'A-1', ticketTypeName: 'VIP', status: 'USED', createdAt: new Date('2026-11-02T09:00:00Z'), usedAt: new Date('2026-11-21T22:14:00Z'), revokedAt: null, scannedBy: 'Petar Petrović' },
        { eventGuestId: 'not-exported', reference: 'Z-9', ticketTypeName: 'VIP', status: 'VALID', createdAt: new Date(), usedAt: null, revokedAt: null, scannedBy: null },
      ],
      timeZone: 'Europe/Belgrade',
      exportedAt: new Date('2026-11-22T08:00:00Z'),
      scope: null,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Gosti', 'Karte', 'Rezime']);

    const guests = workbook.getWorksheet('Gosti') as ExcelJS.Worksheet;
    expect(guests.rowCount).toBe(3);
    expect(guests.getRow(1).getCell(2).value).toBe('Ime');
    expect(guests.getRow(2).getCell(14).value).toEqual(new Date('2026-11-21T23:14:00.000Z'));
    // A formula-looking name stays a plain string cell.
    const risky = guests.getRow(3).getCell(2);
    expect(risky.type).toBe(ExcelJS.ValueType.String);
    expect(risky.value).toBe('=HYPERLINK("http://x")');

    const tickets = workbook.getWorksheet('Karte') as ExcelJS.Worksheet;
    expect(tickets.rowCount).toBe(3); // header + 2; the ticket of a guest outside the export is left out
    expect(tickets.getRow(2).getCell(1).value).toBe('A-1');
    expect(tickets.getRow(2).getCell(9).value).toBe('Petar Petrović');

    const summary = workbook.getWorksheet('Rezime') as ExcelJS.Worksheet;
    const cells: Record<string, unknown> = {};
    summary.eachRow((row) => {
      cells[String(row.getCell(1).value)] = row.getCell(2).value;
    });
    expect(cells).toMatchObject({
      Gostiju: 2,
      'Gostiju koji su ušli': 1,
      'Dodeljeno karata': 3,
      'Iskorišćeno karata': 1,
      'Obuhvat izvoza': 'Svi gosti',
      VIP: 1,
      Regular: 1,
    });
  });
});
