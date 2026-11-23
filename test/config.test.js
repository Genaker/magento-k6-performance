import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../lib/config.js';
import { singleScenario } from '../lib/sources/single.js';

const URL = 'https://shop.test/product.html';

test('single mode with defaults', () => {
  const c = parseConfig({ URL });
  assert.equal(c.mode, 'single');
  assert.equal(c.url, URL);
  assert.equal(c.method, 'GET');
  assert.equal(c.n, 1);
  assert.equal(c.sleep, 0);
  assert.equal(c.fpcEnabled, false);
  assert.equal(c.bustKey, 'fpc');
  assert.equal(c.debugHeader, true);
  assert.equal(c.freshSession, false);
  assert.equal(c.verbose, false);
});

test('lowercase env names from the old README work (-e url= -e sleep=)', () => {
  const c = parseConfig({ url: URL, sleep: '0.2', fpc: 'on', n: '3' });
  assert.equal(c.url, URL);
  assert.equal(c.sleep, 0.2);
  assert.equal(c.fpcEnabled, true);
  assert.equal(c.n, 3);
});

test('csv mode', () => {
  const c = parseConfig({ CSV: 'scenarios.csv', BASE_URL: 'https://shop.test' });
  assert.equal(c.mode, 'csv');
  assert.equal(c.csv, 'scenarios.csv');
  assert.equal(c.baseUrl, 'https://shop.test');
});

test('requires exactly one of URL, CSV or PLAN', () => {
  assert.throws(() => parseConfig({}), /Missing target/);
  assert.throws(() => parseConfig({ URL, CSV: 'x.csv' }), /only one of URL/);
  assert.throws(() => parseConfig({ CSV: 'x.csv', PLAN: 'p.yml' }), /only one of URL/);
});

test('plan mode', () => {
  const c = parseConfig({ PLAN: 'plans/p.yml', SITE: 'flux', BASE_URL: 'https://flux.test', PLATFORM: 'flux' });
  assert.equal(c.mode, 'plan');
  assert.equal(c.plan, 'plans/p.yml');
  assert.equal(c.site, 'flux');
});

test('URL must be http(s)', () => {
  assert.throws(() => parseConfig({ URL: 'shop.test/page' }), /must start with http/);
  assert.throws(() => parseConfig({ URL: 'ftp://shop.test' }), /must start with http/);
  assert.doesNotThrow(() => parseConfig({ URL: 'HTTP://shop.test' }));
});

test('METHOD is uppercased (lowercase methods caused 405s before)', () => {
  assert.equal(parseConfig({ URL, METHOD: 'post' }).method, 'POST');
});

test('N must be a positive integer', () => {
  for (const bad of ['0', '-1', '1.5', 'abc', '5abc']) {
    assert.throws(() => parseConfig({ URL, N: bad }), /N must be a positive integer/, bad);
  }
  assert.equal(parseConfig({ URL, N: '10' }).n, 10);
});

test('SLEEP must be a non-negative number', () => {
  assert.throws(() => parseConfig({ URL, SLEEP: '-1' }), /SLEEP/);
  assert.throws(() => parseConfig({ URL, SLEEP: 'soon' }), /SLEEP/);
  assert.equal(parseConfig({ URL, SLEEP: '1.5' }).sleep, 1.5);
});

test('FPC is case-insensitive and only ON enables it', () => {
  assert.equal(parseConfig({ URL, FPC: 'ON' }).fpcEnabled, true);
  assert.equal(parseConfig({ URL, FPC: 'on' }).fpcEnabled, true);
  assert.equal(parseConfig({ URL, FPC: 'OFF' }).fpcEnabled, false);
  assert.equal(parseConfig({ URL, FPC: 'yes' }).fpcEnabled, false);
});

test('BUST_KEY is validated', () => {
  assert.equal(parseConfig({ URL, BUST_KEY: 'nocache_v2' }).bustKey, 'nocache_v2');
  assert.throws(() => parseConfig({ URL, BUST_KEY: 'a&b' }), /BUST_KEY/);
});

test('DEBUG_HEADER defaults on and can be turned off', () => {
  assert.equal(parseConfig({ URL, DEBUG_HEADER: 'false' }).debugHeader, false);
  assert.equal(parseConfig({ URL, DEBUG_HEADER: 'true' }).debugHeader, true);
});

test('platform options', () => {
  const c = parseConfig({ CSV: 'x.csv', PLATFORM: 'flux', PROFILE: 'p.json', TERMS: 't.txt', API_BASE: 'https://api.test' });
  assert.equal(c.platform, 'flux');
  assert.equal(c.profile, 'p.json');
  assert.equal(c.terms, 't.txt');
  assert.equal(c.apiBase, 'https://api.test');
  assert.equal(parseConfig({ URL }).platform, undefined);
});

test('PLATFORM must be a simple word (PROFILE rules are per format: test/sources.test.js)', () => {
  assert.throws(() => parseConfig({ CSV: 'x.csv', PLATFORM: 'Luma Theme' }), /PLATFORM must be/);
  assert.doesNotThrow(() => parseConfig({ CSV: 'x.csv', PLATFORM: 'luma' })); // overrides only, no profile
});

test('singleScenario maps FPC to a 100% / 0% cache-hit row', () => {
  const on = singleScenario(parseConfig({ URL, FPC: 'ON' }));
  assert.deepEqual(on, [{ name: URL, type: 'page', url: URL, expect: '', cacheHit: 100, traffic: 100, share: 1, cum: 1 }]);
  const off = singleScenario(parseConfig({ URL }));
  assert.equal(off[0].cacheHit, 0);
});

test('CACHE_HIT overrides every page (0-100)', () => {
  assert.equal(parseConfig({ CSV: 'x.csv', CACHE_HIT: '0' }).cacheHit, 0);
  assert.equal(parseConfig({ CSV: 'x.csv' }).cacheHit, undefined);
  assert.throws(() => parseConfig({ CSV: 'x.csv', CACHE_HIT: '150' }), /CACHE_HIT/);
});

test('PLATFORM accepts a variant like flux.min', () => {
  assert.equal(parseConfig({ CSV: 'x.csv', PLATFORM: 'flux.min' }).platform, 'flux.min');
  assert.throws(() => parseConfig({ CSV: 'x.csv', PLATFORM: 'flux.min.x' }), /PLATFORM must be/);
});
