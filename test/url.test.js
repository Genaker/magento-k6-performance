import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendQueryParam, makeBustToken } from '../lib/url.js';

test('appendQueryParam adds ? when there is no query', () => {
  assert.equal(appendQueryParam('https://s.test/p.html', 'fpc', 'x'), 'https://s.test/p.html?fpc=x');
});

test('appendQueryParam adds & when there is a query', () => {
  assert.equal(
    appendQueryParam('https://s.test/search?q=shirt', 'fpc', 'x'),
    'https://s.test/search?q=shirt&fpc=x'
  );
});

test('appendQueryParam does not double separators', () => {
  assert.equal(appendQueryParam('https://s.test/p?', 'fpc', 'x'), 'https://s.test/p?fpc=x');
  assert.equal(appendQueryParam('https://s.test/p?a=1&', 'fpc', 'x'), 'https://s.test/p?a=1&fpc=x');
});

test('appendQueryParam keeps #fragment last (fragment is never sent to the server)', () => {
  assert.equal(appendQueryParam('https://s.test/p.html#reviews', 'fpc', 'x'), 'https://s.test/p.html?fpc=x#reviews');
  assert.equal(appendQueryParam('https://s.test/p?a=1#top', 'fpc', 'x'), 'https://s.test/p?a=1&fpc=x#top');
});

test('appendQueryParam encodes key and value', () => {
  assert.equal(appendQueryParam('https://s.test/', 'k y', 'a&b'), 'https://s.test/?k%20y=a%26b');
});

test('makeBustToken is deterministic for fixed inputs', () => {
  assert.equal(makeBustToken(3, 7, 2, 1700000000000, 0.5), '3-7-2-1700000000000-i');
});

test('makeBustToken differs per request within one iteration (seq)', () => {
  const a = makeBustToken(1, 1, 0, 1000, 0.123456);
  const b = makeBustToken(1, 1, 1, 1000, 0.123456);
  assert.notEqual(a, b);
});

test('makeBustToken is unique across many real calls', () => {
  const seen = new Set();
  for (let i = 0; i < 10000; i++) seen.add(makeBustToken(1, 1, i));
  assert.equal(seen.size, 10000);
});

test('makeBustToken output is URL-safe', () => {
  assert.match(makeBustToken(12, 345, 6), /^[0-9a-z-]+$/);
});
