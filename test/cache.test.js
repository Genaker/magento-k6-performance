import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCacheHit, isErrorStatus, headerValue } from '../lib/cache.js';

test('headerValue is case-insensitive', () => {
  assert.equal(headerValue({ 'x-cache': 'HIT' }, 'X-Cache'), 'HIT');
  assert.equal(headerValue({ 'X-CACHE': 'HIT' }, 'x-cache'), 'HIT');
  assert.equal(headerValue({}, 'X-Cache'), undefined);
  assert.equal(headerValue(undefined, 'X-Cache'), undefined);
});

test('X-Magento-Cache-Debug decides first', () => {
  assert.deepEqual(detectCacheHit({ 'X-Magento-Cache-Debug': 'HIT' }), { hit: true, source: 'X-Magento-Cache-Debug' });
  assert.deepEqual(detectCacheHit({ 'X-Magento-Cache-Debug': 'MISS', Age: '50' }), { hit: false, source: 'X-Magento-Cache-Debug' });
});

test('X-Cache (Fastly/CDN), including shield chains', () => {
  assert.equal(detectCacheHit({ 'X-Cache': 'HIT' }).hit, true);
  assert.equal(detectCacheHit({ 'X-Cache': 'MISS' }).hit, false);
  // shield hit, edge miss: origin (Magento) did not render it => hit
  assert.equal(detectCacheHit({ 'X-Cache': 'HIT, MISS' }).hit, true);
  assert.equal(detectCacheHit({ 'X-Cache': 'MISS, MISS' }).hit, false);
});

test('CF-Cache-Status (Cloudflare)', () => {
  assert.equal(detectCacheHit({ 'CF-Cache-Status': 'HIT' }).hit, true);
  assert.equal(detectCacheHit({ 'CF-Cache-Status': 'MISS' }).hit, false);
});

test('falls back to Age when no cache header is present', () => {
  assert.deepEqual(detectCacheHit({ Age: '12' }), { hit: true, source: 'Age' });
  assert.deepEqual(detectCacheHit({ Age: '0' }), { hit: false, source: 'Age' });
  assert.deepEqual(detectCacheHit({}), { hit: false, source: 'Age' });
  assert.equal(detectCacheHit({ Age: 'junk' }).hit, false);
});

test('blank or unknown cache header values fall through to Age', () => {
  assert.equal(detectCacheHit({ 'X-Cache': '', Age: '3' }).hit, true);
  assert.equal(detectCacheHit({ 'CF-Cache-Status': 'DYNAMIC', Age: '0' }).hit, false);
});

test('isErrorStatus: network errors and 4xx/5xx only', () => {
  for (const s of [0, 400, 404, 429, 500, 503]) assert.equal(isErrorStatus(s), true, String(s));
  for (const s of [200, 201, 204, 301, 302, 304]) assert.equal(isErrorStatus(s), false, String(s));
});
