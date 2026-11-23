import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/sources/csv.js';
import { normalizeScenarios } from '../lib/scenarios.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('parses header + rows into objects', () => {
  const rows = parseCsv('name,url\nhome,https://s.test/\ncart,https://s.test/cart\n');
  assert.deepEqual(rows, [
    { name: 'home', url: 'https://s.test/' },
    { name: 'cart', url: 'https://s.test/cart' },
  ]);
});

test('header names are trimmed and lowercased; cells are trimmed', () => {
  const rows = parseCsv(' Name , URL \n  home , https://s.test/ \n');
  assert.deepEqual(rows, [{ name: 'home', url: 'https://s.test/' }]);
});

test('quoted fields may contain commas, quotes and newlines', () => {
  const rows = parseCsv('name,url\n"a, b","https://s.test/?q=""x"""\n"multi\nline",u\n');
  assert.equal(rows[0].name, 'a, b');
  assert.equal(rows[0].url, 'https://s.test/?q="x"');
  assert.equal(rows[1].name, 'multi\nline');
});

test('handles CRLF, BOM, blank lines and a missing trailing newline', () => {
  const rows = parseCsv('﻿name,url\r\n\r\nhome,/\r\n\r\ncart,/cart');
  assert.deepEqual(rows, [{ name: 'home', url: '/' }, { name: 'cart', url: '/cart' }]);
});

test('rows starting with # are comments', () => {
  const rows = parseCsv('name,url\n# disabled for now\nhome,/\n#cart,/cart\n');
  assert.deepEqual(rows, [{ name: 'home', url: '/' }]);
});

test('rows remember their real source line (comments and blank lines counted)', () => {
  const rows = parseCsv('name,url\n# comment\nhome,/\n\n"two\nlines",/x\ncart,/cart\n');
  assert.deepEqual(rows.map((r) => r.__line), [3, 5, 7]);
  assert.deepEqual(Object.keys(rows[0]), ['name', 'url']); // __line is not a column
});

test('validation errors cite the real CSV line', () => {
  const rows = parseCsv('name,url,cache_hit_pct,traffic_pct\n# comment\n\nok,https://s.test/,50,1\nbad,https://s.test/x,500,1\n');
  assert.throws(() => normalizeScenarios(rows), /CSV line 5: cache_hit_pct/);
});

test('short rows get empty strings for missing cells', () => {
  assert.deepEqual(parseCsv('a,b,c\n1\n'), [{ a: '1', b: '', c: '' }]);
});

test('empty input gives no rows', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('\n\n'), []);
  assert.deepEqual(parseCsv('name,url\n'), []);
});

test('unterminated quote is an error, not silent garbage', () => {
  assert.throws(() => parseCsv('name,url\n"home,/\n'), /unterminated/);
});

test('the shipped scenarios.csv is valid', () => {
  const rows = parseCsv(readFileSync(`${root}/scenarios.csv`, 'utf8'));
  const s = normalizeScenarios(rows);
  assert.ok(s.length >= 3);
});

test('the smoke-test CSV is valid with a BASE_URL', () => {
  const rows = parseCsv(readFileSync(`${root}/smoke/scenarios.smoke.csv`, 'utf8'));
  const s = normalizeScenarios(rows, { baseUrl: 'http://127.0.0.1:18080' });
  assert.ok(s.every((x) => x.url.startsWith('http://127.0.0.1:18080/')));
});
