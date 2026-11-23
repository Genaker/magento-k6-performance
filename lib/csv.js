// Minimal RFC 4180 CSV parser. Runtime-agnostic, so the CSV pipeline can be
// unit-tested in Node and k6 runs need no remote papaparse download.
//
// - first non-empty row is the header (trimmed, lowercased)
// - quoted fields may contain commas, newlines and "" escaped quotes
// - CRLF / LF line endings, UTF-8 BOM, blank lines are handled
// - a row whose first cell starts with '#' is a comment and is skipped

export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1; // current source line
  let rowLine = 1; // source line where the current row started
  const rowLines = [];

  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (src.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      rowLines.push(rowLine);
      line++;
      rowLine = line;
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error('CSV parse error: unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
    rowLines.push(rowLine);
  }

  const kept = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nonEmpty = r.some(function (f) { return f.trim() !== ''; });
    if (nonEmpty && r[0].trim().charAt(0) !== '#') kept.push({ cells: r, line: rowLines[i] });
  }
  if (kept.length === 0) return [];

  const header = kept[0].cells.map(function (h) { return h.trim().toLowerCase(); });
  return kept.slice(1).map(function (k) {
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = k.cells[j] === undefined ? '' : k.cells[j].trim();
    }
    // Source line for error messages; non-enumerable so it never looks like a column.
    Object.defineProperty(obj, '__line', { value: k.line, enumerable: false });
    return obj;
  });
}
