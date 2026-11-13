// Serbian (Latin) formatting. Month and weekday names are spelled out here
// rather than taken from Intl, whose sr-Latn data differs between browsers.

const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const WEEKDAYS = ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'];

type DateInput = string | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 21. novembar 2026. */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return d ? `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}.` : '—';
}

/** 21. nov 2026. */
export function formatDateShort(value: DateInput): string {
  const d = toDate(value);
  return d ? `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}.` : '—';
}

/** 23:00 */
export function formatTime(value: DateInput): string {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
}

/** 23:00:14 */
export function formatTimeSeconds(value: DateInput): string {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '—';
}

/** 21. nov 2026. u 23:00 */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  return d ? `${formatDateShort(d)} u ${formatTime(d)}` : '—';
}

/** petak, 21. novembar 2026. */
export function formatDateWithWeekday(value: DateInput): string {
  const d = toDate(value);
  return d ? `${WEEKDAYS[d.getDay()]}, ${formatDate(d)}` : '—';
}

/** Compact day/month pieces for date tiles. */
export function dateParts(value: DateInput): { day: string; month: string; weekday: string } {
  const d = toDate(value);
  if (!d) return { day: '—', month: '', weekday: '' };
  return { day: String(d.getDate()), month: MONTHS_SHORT[d.getMonth()], weekday: WEEKDAYS[d.getDay()].slice(0, 3) };
}

/** "upravo sada", "pre 5 min", "pre 2 h", otherwise the date. */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '—';
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 0) return formatDateTime(d);
  if (seconds < 45) return 'upravo sada';
  if (seconds < 3600) return `pre ${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) return `pre ${Math.round(seconds / 3600)} h`;
  return formatDateTime(d);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('sr-Latn-RS').format(value);
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('sr-Latn-RS', { maximumFractionDigits: 1 }).format(value)}%`;
}

/** Serbian plural: plural(3, 'gost', 'gosta', 'gostiju') → "gosta". */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const guestsLabel = (n: number) => `${formatNumber(n)} ${plural(n, 'gost', 'gosta', 'gostiju')}`;
export const ticketsLabel = (n: number) => `${formatNumber(n)} ${plural(n, 'karta', 'karte', 'karata')}`;

// ── <input type="date"> / <input type="time"> helpers (local time) ──────────

export function toDateInput(value: DateInput): string {
  const d = toDate(value);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}

export function toTimeInput(value: DateInput): string {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** Combines local date + time inputs into an ISO string; null when incomplete. */
export function fromDateTimeInputs(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
