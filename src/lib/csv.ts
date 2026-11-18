/**
 * RFC 4180 CSV parser returning one object per row keyed by the header.
 * Handles quotes, escaped quotes, CRLF, newlines inside quotes and a UTF-8 BOM.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const rows = parseRows(input.replace(/^﻿/, ''));
  const header = rows.shift()?.map((h) => h.trim()) ?? [];
  return rows
    .filter((r) => r.some((cell) => cell.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function parseRows(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (quoted) {
      if (ch === '"' && s.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Quotes a value for CSV output when needed. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
