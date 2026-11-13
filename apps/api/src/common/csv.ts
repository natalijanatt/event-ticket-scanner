/**
 * CSV cell encoder with spreadsheet formula-injection protection: values that
 * a spreadsheet would evaluate (`=`, `+`, `-`, `@`, tab, CR) are prefixed with
 * an apostrophe so they are treated as text.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r;]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  // BOM so Excel opens UTF-8 (č, ć, š, ž, đ) correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}
