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
  }

  const kept = rows.filter(function (r) {
    const nonEmpty = r.some(function (f) { return f.trim() !== ''; });
    return nonEmpty && r[0].trim().charAt(0) !== '#';
  });
  if (kept.length === 0) return [];

  const header = kept[0].map(function (h) { return h.trim().toLowerCase(); });
  return kept.slice(1).map(function (r) {
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = r[j] === undefined ? '' : r[j].trim();
    }
    return obj;
  });
}
