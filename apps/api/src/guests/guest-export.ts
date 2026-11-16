import {
  EMAIL_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  GUEST_TICKET_STATE_LABELS,
  TICKET_STATUS_LABELS,
  type EventStatus,
  type GuestRowDto,
  type TicketStatus,
} from '@event-platform/shared';
import ExcelJS from 'exceljs';

// Excel export of an event's guest list: three sheets (guests, individual
// tickets, summary). Every guest-supplied value is written as a plain string
// cell – never as a formula – so nothing in it can be evaluated by Excel.

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface GuestExportTicket {
  eventGuestId: string;
  reference: string;
  ticketTypeName: string;
  status: TicketStatus;
  createdAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  scannedBy: string | null;
}

export interface GuestExportInput {
  event: { name: string; startsAt: Date; endsAt: Date | null; venueName: string; status: EventStatus };
  guests: GuestRowDto[];
  tickets: GuestExportTicket[];
  timeZone: string;
  exportedAt: Date;
  /** Human-readable description of the applied filter / selection, if any. */
  scope: string | null;
}

const DATE_TIME_FORMAT = 'dd.mm.yyyy. hh:mm';
const HEADER_FILL = 'FF1E293B';
const FILL_GREEN = 'FFE7F6EC';
const FILL_AMBER = 'FFFFF4D6';
const FILL_RED = 'FFFDE8E8';
const BORDER = 'FFE2E8F0';

/**
 * Excel dates carry no time zone. This returns a Date whose UTC fields equal
 * the wall-clock time in `timeZone`, which is what ExcelJS serializes.
 */
export function toExcelDate(value: Date | string | null | undefined, timeZone: string): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = Number(part.value);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

interface Column<T> {
  header: string;
  width: number;
  value: (item: T, index: number) => string | number | Date | null;
  align?: 'left' | 'center' | 'right';
  date?: boolean;
  wrap?: boolean;
  /** ARGB background for this cell, or undefined for none. */
  fill?: (item: T) => string | undefined;
}

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function addTable<T>(sheet: ExcelJS.Worksheet, columns: Column<T>[], items: T[]): void {
  sheet.columns = columns.map((c) => ({ width: c.width }));

  const header = sheet.addRow(columns.map((c) => c.header));
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(HEADER_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  items.forEach((item, index) => {
    const row = sheet.addRow(columns.map((c) => c.value(item, index) ?? ''));
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.alignment = { vertical: 'top', horizontal: c.align ?? 'left', wrapText: c.wrap ?? false };
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } };
      if (c.date) cell.numFmt = DATE_TIME_FORMAT;
      const fill = c.fill?.(item);
      if (fill) cell.fill = solid(fill);
    });
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  sheet.pageSetup.printTitlesRow = '1:1';
}

const issued = (g: GuestRowDto) => g.tickets.valid + g.tickets.used;

function guestColumns(tz: string): Column<GuestRowDto>[] {
  return [
    { header: 'R. br.', width: 7, align: 'right', value: (_g, i) => i + 1 },
    { header: 'Ime', width: 18, value: (g) => g.firstName },
    { header: 'Prezime', width: 20, value: (g) => g.lastName },
    { header: 'Email', width: 32, value: (g) => g.email },
    { header: 'Telefon', width: 18, value: (g) => g.phone },
    { header: 'Tip karte', width: 16, value: (g) => g.ticketType.name },
    { header: 'Dodeljeno karata', width: 12, align: 'right', value: (g) => g.ticketQuantity },
    { header: 'Izdato karata', width: 12, align: 'right', value: issued },
    { header: 'Iskorišćeno', width: 12, align: 'right', value: (g) => g.tickets.used },
    { header: 'Poništeno', width: 12, align: 'right', value: (g) => g.tickets.revoked },
    {
      header: 'Status pozivnice',
      width: 22,
      value: (g) => EMAIL_STATUS_LABELS[g.emailStatus],
      fill: (g) =>
        g.emailStatus === 'FAILED' || g.emailStatus === 'BOUNCED' ? FILL_RED : g.emailStatus === 'DELIVERED' ? FILL_GREEN : undefined,
    },
    { header: 'Pozivnica poslata', width: 18, date: true, value: (g) => toExcelDate(g.lastEmailAt, tz) },
    {
      header: 'Status karte',
      width: 22,
      value: (g) => GUEST_TICKET_STATE_LABELS[g.ticketState],
      fill: (g) =>
        g.ticketState === 'USED' ? FILL_GREEN : g.ticketState === 'PARTIALLY_USED' ? FILL_AMBER : g.ticketState === 'REVOKED' ? FILL_RED : undefined,
    },
    { header: 'Vreme ulaska', width: 18, date: true, value: (g) => toExcelDate(g.firstCheckInAt, tz) },
    { header: 'Napomena', width: 40, wrap: true, value: (g) => g.notes },
    { header: 'Dodat na listu', width: 18, date: true, value: (g) => toExcelDate(g.createdAt, tz) },
  ];
}

type TicketLine = GuestExportTicket & { guest: GuestRowDto };

function ticketColumns(tz: string): Column<TicketLine>[] {
  return [
    { header: 'Referenca', width: 16, value: (t) => t.reference },
    { header: 'Ime', width: 18, value: (t) => t.guest.firstName },
    { header: 'Prezime', width: 20, value: (t) => t.guest.lastName },
    { header: 'Email', width: 32, value: (t) => t.guest.email },
    { header: 'Tip karte', width: 16, value: (t) => t.ticketTypeName },
    {
      header: 'Status',
      width: 16,
      value: (t) => TICKET_STATUS_LABELS[t.status],
      fill: (t) => (t.status === 'USED' ? FILL_GREEN : t.status === 'REVOKED' ? FILL_RED : undefined),
    },
    { header: 'Izdata', width: 18, date: true, value: (t) => toExcelDate(t.createdAt, tz) },
    { header: 'Vreme ulaska', width: 18, date: true, value: (t) => toExcelDate(t.usedAt, tz) },
    { header: 'Skenirao', width: 24, value: (t) => t.scannedBy },
    { header: 'Poništena', width: 18, date: true, value: (t) => toExcelDate(t.revokedAt, tz) },
  ];
}

function addSummary(sheet: ExcelJS.Worksheet, input: GuestExportInput): void {
  const { event, guests, timeZone: tz } = input;
  sheet.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];

  const title = sheet.addRow([event.name]);
  title.font = { bold: true, size: 16 };
  title.height = 26;
  sheet.addRow([]);

  const pair = (label: string, value: string | number | Date | null, date = false) => {
    const row = sheet.addRow([label, value ?? '']);
    row.getCell(1).font = { color: { argb: 'FF64748B' } };
    row.getCell(2).alignment = { horizontal: 'left' };
    if (date) row.getCell(2).numFmt = DATE_TIME_FORMAT;
  };
  const section = (label: string) => {
    sheet.addRow([]);
    sheet.addRow([label]).font = { bold: true, size: 12 };
  };

  pair('Početak', toExcelDate(event.startsAt, tz), true);
  if (event.endsAt) pair('Kraj', toExcelDate(event.endsAt, tz), true);
  pair('Mesto', event.venueName);
  pair('Status događaja', EVENT_STATUS_LABELS[event.status]);
  pair('Izvezeno', toExcelDate(input.exportedAt, tz), true);
  pair('Obuhvat izvoza', input.scope ?? 'Svi gosti');

  const sum = (pick: (g: GuestRowDto) => number) => guests.reduce((total, g) => total + pick(g), 0);
  const count = (test: (g: GuestRowDto) => boolean) => guests.filter(test).length;

  section('Ukupno');
  pair('Gostiju', guests.length);
  pair('Gostiju koji su ušli', count((g) => g.tickets.used > 0));
  pair('Dodeljeno karata', sum((g) => g.ticketQuantity));
  pair('Izdato karata', sum(issued));
  pair('Iskorišćeno karata', sum((g) => g.tickets.used));
  pair('Poništeno karata', sum((g) => g.tickets.revoked));

  section('Pozivnice');
  pair('Nije poslato', count((g) => g.emailStatus === 'NOT_SENT'));
  pair('U redu za slanje / slanje u toku', count((g) => g.emailStatus === 'QUEUED' || g.emailStatus === 'SENDING'));
  pair('Poslato', count((g) => g.emailStatus === 'SENT'));
  pair('Isporuka potvrđena', count((g) => g.emailStatus === 'DELIVERED'));
  pair('Greška pri slanju', count((g) => g.emailStatus === 'FAILED' || g.emailStatus === 'BOUNCED'));

  section('Po tipu karte');
  const head = sheet.addRow(['Tip karte', 'Gostiju', 'Dodeljeno', 'Izdato', 'Iskorišćeno', 'Poništeno']);
  head.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(HEADER_FILL);
    cell.alignment = { horizontal: col === 1 ? 'left' : 'right' };
  });
  const byType = new Map<string, GuestRowDto[]>();
  for (const g of guests) byType.set(g.ticketType.name, [...(byType.get(g.ticketType.name) ?? []), g]);
  for (const [name, list] of [...byType].sort(([a], [b]) => a.localeCompare(b, 'sr-Latn'))) {
    const of = (pick: (g: GuestRowDto) => number) => list.reduce((total, g) => total + pick(g), 0);
    sheet.addRow([name, list.length, of((g) => g.ticketQuantity), of(issued), of((g) => g.tickets.used), of((g) => g.tickets.revoked)]);
  }
}

export async function buildGuestWorkbook(input: GuestExportInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = input.exportedAt;
  workbook.title = `Gosti — ${input.event.name}`;

  addTable(workbook.addWorksheet('Gosti'), guestColumns(input.timeZone), input.guests);

  // Tickets follow the order of the guest sheet.
  const order = new Map(input.guests.map((g, i) => [g.id, i]));
  const lines: TicketLine[] = input.tickets
    .filter((t) => order.has(t.eventGuestId))
    .map((t) => ({ ...t, guest: input.guests[order.get(t.eventGuestId) as number] }))
    .sort((a, b) => (order.get(a.eventGuestId) as number) - (order.get(b.eventGuestId) as number) || a.reference.localeCompare(b.reference));
  addTable(workbook.addWorksheet('Karte'), ticketColumns(input.timeZone), lines);

  addSummary(workbook.addWorksheet('Rezime'), input);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
