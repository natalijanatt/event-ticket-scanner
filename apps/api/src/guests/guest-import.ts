import { emailSchema, MAX_TICKETS_PER_GUEST } from '@event-platform/shared';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { badRequest } from '../common/errors';

// Safe parsing of organizer-supplied guest lists.
//  • size and row limits are enforced before/while parsing
//  • the file type is decided from the content, not the extension
//  • .xlsx cells are read as displayed text – formulas are never evaluated
//  • every value is treated as untrusted text and validated per row

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export interface ParsedGuestRow {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  ticketTypeName: string | null;
  ticketQuantity: number;
  error: string | null;
}

type Field = 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone' | 'notes' | 'ticketType' | 'quantity';

const HEADER_ALIASES: Record<Field, string[]> = {
  firstName: ['ime', 'firstname', 'first', 'givenname'],
  lastName: ['prezime', 'lastname', 'last', 'surname', 'familyname'],
  fullName: ['imeiprezime', 'punoime', 'fullname', 'name', 'gost', 'guest', 'naziv'],
  email: ['email', 'emailadresa', 'eposta', 'mail', 'emailaddress', 'imejl', 'mejl'],
  phone: ['telefon', 'phone', 'mobilni', 'brojtelefona', 'tel', 'mobile', 'phonenumber'],
  notes: ['napomena', 'napomene', 'notes', 'note', 'komentar', 'beleska', 'beleske'],
  ticketType: ['tipkarte', 'tip', 'karta', 'tickettype', 'type', 'vrstakarte', 'ulaznica', 'tipulaznice'],
  quantity: ['brojkarata', 'kolicina', 'karata', 'quantity', 'qty', 'tickets', 'brkarata', 'brojulaznica', 'karte'],
};

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function clean(value: unknown, max: number): string {
  // Strip control characters; collapse whitespace.
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function readTable(buffer: Buffer): Promise<string[][]> {
  if (buffer.length > IMPORT_MAX_BYTES) throw badRequest('FILE_TOO_LARGE', 'Fajl je prevelik. Najveća dozvoljena veličina je 2 MB.');

  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw badRequest('FILE_UNREADABLE', 'Excel fajl nije moguće pročitati. Sačuvaj ga kao .xlsx ili .csv i pokušaj ponovo.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length > IMPORT_MAX_ROWS + 1) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        // `text` is the displayed value; a formula cell yields its cached result, never code.
        cells[col - 1] = typeof cell.text === 'string' ? cell.text : String(cell.text ?? '');
      });
      rows.push(Array.from(cells, (c) => c ?? ''));
    });
    return rows;
  }

  // Legacy binary .xls (OLE2 header) is not supported.
  if (buffer.length > 8 && buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw badRequest('FILE_UNSUPPORTED', 'Stari .xls format nije podržan. Sačuvaj fajl kao .xlsx ili .csv.');
  }

  const text = buffer.toString('utf8');
  if (text.includes('\u0000')) throw badRequest('FILE_UNSUPPORTED', 'Fajl nije u podržanom formatu. Koristi .csv ili .xlsx.');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  try {
    return parseCsv(text, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
      to: IMPORT_MAX_ROWS + 2,
    }) as string[][];
  } catch {
    throw badRequest('FILE_UNREADABLE', 'CSV fajl nije moguće pročitati. Proveri da li je ispravno formatiran.');
  }
}

export async function parseGuestFile(buffer: Buffer): Promise<ParsedGuestRow[]> {
  const table = await readTable(buffer);
  if (table.length < 2) throw badRequest('FILE_EMPTY', 'Fajl ne sadrži nijednog gosta. Prvi red mora biti zaglavlje sa nazivima kolona.');
  if (table.length - 1 > IMPORT_MAX_ROWS) {
    throw badRequest('TOO_MANY_ROWS', `Fajl sadrži previše redova. Najviše ${IMPORT_MAX_ROWS} gostiju po uvozu.`);
  }

  const columns = new Map<Field, number>();
  table[0].forEach((header, index) => {
    const key = normalizeHeader(String(header ?? ''));
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      if (!columns.has(field) && HEADER_ALIASES[field].includes(key)) columns.set(field, index);
    }
  });
  if (!columns.has('email')) {
    throw badRequest('MISSING_EMAIL_COLUMN', 'U fajlu nije pronađena kolona „Email". Dodaj zaglavlje sa nazivima kolona (npr. Ime, Prezime, Email).');
  }
  if (!columns.has('firstName') && !columns.has('fullName')) {
    throw badRequest('MISSING_NAME_COLUMN', 'U fajlu nije pronađena kolona „Ime".');
  }

  const cell = (row: string[], field: Field, max: number) => (columns.has(field) ? clean(row[columns.get(field) as number], max) : '');

  const rows: ParsedGuestRow[] = [];
  table.slice(1).forEach((raw, index) => {
    if (raw.every((c) => clean(c, 10) === '')) return;
    let firstName = cell(raw, 'firstName', 60);
    let lastName = cell(raw, 'lastName', 60);
    if (!firstName && columns.has('fullName')) {
      const [first, ...rest] = cell(raw, 'fullName', 120).split(' ');
      firstName = (first ?? '').slice(0, 60);
      if (!lastName) lastName = rest.join(' ').slice(0, 60);
    }
    const emailRaw = cell(raw, 'email', 254);
    const email = emailSchema.safeParse(emailRaw);
    const quantityRaw = cell(raw, 'quantity', 10);
    const quantity = quantityRaw === '' ? 1 : Number(quantityRaw.replace(',', '.'));

    let error: string | null = null;
    if (!firstName) error = 'Nedostaje ime.';
    else if (!emailRaw) error = 'Nedostaje email adresa.';
    else if (!email.success) error = 'Neispravna email adresa.';
    else if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_GUEST) {
      error = `Broj karata mora biti između 1 i ${MAX_TICKETS_PER_GUEST}.`;
    }

    rows.push({
      row: index + 2,
      firstName,
      lastName,
      email: email.success ? email.data : emailRaw.toLowerCase(),
      phone: cell(raw, 'phone', 40) || null,
      notes: cell(raw, 'notes', 1000) || null,
      ticketTypeName: cell(raw, 'ticketType', 60) || null,
      ticketQuantity: Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_TICKETS_PER_GUEST ? quantity : 1,
      error,
    });
  });
  return rows;
}
