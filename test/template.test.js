import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeholders, fillTemplate, encodeTerm, parseTerms } from '../lib/template.js';

test('placeholders lists unique lowercase {names} in order', () => {
  assert.deepEqual(placeholders('/s?q={term}&u={page_url}&t={term}'), ['term', 'page_url']);
  assert.deepEqual(placeholders('/plain'), []);
});

test('JSON-like braces are not placeholders', () => {
  assert.deepEqual(placeholders('"items":[{"uid"'), []);
  assert.deepEqual(placeholders('{"a":{b}}'), ['b']);
  assert.equal(fillTemplate('"items":[{', {}), '"items":[{');
});

test('fillTemplate substitutes and rejects unknown or unset names', () => {
  assert.equal(fillTemplate('/s?q={term}&_={ts}', { term: 'bag', ts: 5 }), '/s?q=bag&_=5');
  assert.throws(() => fillTemplate('/s?q={term}', {}), /\{term\}/);
  assert.throws(() => fillTemplate('/s?q={term}', { term: undefined }), /\{term\}/);
});

test('encodeTerm encodes like a browser search form (space as +)', () => {
  assert.equal(encodeTerm('yoga mat'), 'yoga+mat');
  assert.equal(encodeTerm("men's tee"), "men's+tee");
  assert.equal(encodeTerm('t-shirt'), 't-shirt');
});

test('parseTerms skips blanks and comments, trims, validates', () => {
  assert.deepEqual(parseTerms('# terms\nbag\n\n  yoga mat  \r\nt-shirt\n'), ['bag', 'yoga mat', 't-shirt']);
  assert.throws(() => parseTerms('bag\nfoo&bar\n'), /line 2/);
  assert.throws(() => parseTerms('"quoted"\n'), /line 1/);
  assert.deepEqual(parseTerms(''), []);
});
