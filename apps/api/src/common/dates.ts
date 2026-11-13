// Serbian (Latin) date formatting for e-mails. Month names are spelled out
// explicitly: ICU's `sr-Latn` data is not guaranteed in every Node build.

const MONTHS_GENITIVE = [
  'januar', 'februar', 'mart', 'april', 'maj', 'jun',
  'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar',
];

function parts(date: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** "21. novembar 2026." */
export function formatDateLong(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${Number(p.day)}. ${MONTHS_GENITIVE[Number(p.month) - 1]} ${p.year}.`;
}

/** "21. novembar" */
export function formatDateShort(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${Number(p.day)}. ${MONTHS_GENITIVE[Number(p.month) - 1]}`;
}

/** "23:00" */
export function formatTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** "21.11.2026. 23:14" – compact form for exports. */
export function formatDateTimeCompact(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.day.padStart(2, '0')}.${p.month.padStart(2, '0')}.${p.year}. ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
