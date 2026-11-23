import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenarios, pickScenario, decideHit, scenariosUse } from '../lib/scenarios.js';
import { seededRandom } from './helpers/rng.js';

const row = (o) => Object.assign({ name: '', url: '', cache_hit_pct: '50', traffic_pct: '10' }, o);

test('computes normalized share and cumulative weight', () => {
  const s = normalizeScenarios([
    row({ name: 'a', url: 'https://s.test/a', traffic_pct: '60' }),
    row({ name: 'b', url: 'https://s.test/b', traffic_pct: '30' }),
    row({ name: 'c', url: 'https://s.test/c', traffic_pct: '10' }),
  ]);
  assert.deepEqual(s.map((x) => x.share), [0.6, 0.3, 0.1]);
  assert.equal(s[0].cum, 0.6);
  assert.ok(Math.abs(s[1].cum - 0.9) < 1e-12);
  assert.equal(s[2].cum, 1);
});

test('traffic_pct need not sum to 100', () => {
  const s = normalizeScenarios([
    row({ name: 'a', url: 'https://s.test/a', traffic_pct: '3' }),
    row({ name: 'b', url: 'https://s.test/b', traffic_pct: '1' }),
  ]);
  assert.equal(s[0].share, 0.75);
  assert.equal(s[1].share, 0.25);
  assert.equal(s[1].cum, 1);
});

test('last cum is exactly 1 despite float drift', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row({ name: `p${i}`, url: `https://s.test/${i}`, traffic_pct: '0.1' }));
  assert.equal(normalizeScenarios(rows).at(-1).cum, 1);
});

test('traffic_pct = 0 switches a row off', () => {
  const s = normalizeScenarios([
    row({ name: 'on', url: 'https://s.test/on', traffic_pct: '5' }),
    row({ name: 'off', url: 'https://s.test/off', traffic_pct: '0' }),
  ]);
  assert.deepEqual(s.map((x) => x.name), ['on']);
});

test('name defaults to the url', () => {
  const s = normalizeScenarios([row({ url: 'https://s.test/x' })]);
  assert.equal(s[0].name, 'https://s.test/x');
});

test('relative urls are joined with BASE_URL (trailing slash tolerated)', () => {
  const s = normalizeScenarios([row({ name: 'w', url: '/women.html' })], { baseUrl: 'https://s.test/' });
  assert.equal(s[0].url, 'https://s.test/women.html');
});

test('relative url without BASE_URL is an error', () => {
  assert.throws(() => normalizeScenarios([row({ name: 'w', url: '/women.html' })]), /line 2: .*BASE_URL/);
});

test('url must be absolute http(s) or start with /', () => {
  assert.throws(() => normalizeScenarios([row({ url: 'women.html' })]), /line 2: url must be absolute/);
});

test('missing url is an error with the CSV line number', () => {
  assert.throws(
    () => normalizeScenarios([row({ name: 'a', url: 'https://s.test/a' }), row({ name: 'b' })]),
    /CSV line 3: url is required/
  );
});

test('cache_hit_pct must be 0..100', () => {
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', cache_hit_pct: '120' })]), /cache_hit_pct/);
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', cache_hit_pct: '-1' })]), /cache_hit_pct/);
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', cache_hit_pct: 'lots' })]), /cache_hit_pct/);
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', cache_hit_pct: '' })]), /cache_hit_pct is required/);
});

test('traffic_pct must be a non-negative number', () => {
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', traffic_pct: '-5' })]), /traffic_pct/);
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', traffic_pct: 'x' })]), /traffic_pct/);
});

test('duplicate names are rejected (metrics are tagged by name)', () => {
  assert.throws(
    () => normalizeScenarios([row({ name: 'a', url: 'https://s.test/1' }), row({ name: 'a', url: 'https://s.test/2' })]),
    /duplicate name "a"/
  );
});

test('no usable rows is an error', () => {
  assert.throws(() => normalizeScenarios([]), /no usable rows/);
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', traffic_pct: '0' })]), /no usable rows/);
});

test('type defaults to "page", is lowercased and validated', () => {
  assert.equal(normalizeScenarios([row({ url: 'https://s.test/' })])[0].type, 'page');
  assert.equal(normalizeScenarios([row({ url: 'https://s.test/', type: 'Search' })])[0].type, 'search');
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/', type: 'a b' })]), /type must be/);
});

test('url_<platform> and expect_<platform> override the base columns', () => {
  const r = row({
    name: 's', url: '/catalogsearch/result/?q={term}', url_flux: '/catalog/product_search?search={term}',
    expect: 'price-box', expect_flux: 'Search results for',
  });
  const magento = normalizeScenarios([r], { baseUrl: 'https://s.test', platform: 'luma' })[0];
  assert.equal(magento.url, 'https://s.test/catalogsearch/result/?q={term}');
  assert.equal(magento.expect, 'price-box');
  const flux = normalizeScenarios([r], { baseUrl: 'https://s.test', platform: 'flux' })[0];
  assert.equal(flux.url, 'https://s.test/catalog/product_search?search={term}');
  assert.equal(flux.expect, 'Search results for');
});

test('empty override falls back; "-" skips the row on that platform', () => {
  const rows = [
    row({ name: 'a', url: 'https://s.test/a', url_flux: '' }),
    row({ name: 'b', url: 'https://s.test/b', url_flux: '-' }),
  ];
  assert.deepEqual(normalizeScenarios(rows, { platform: 'flux' }).map((s) => s.name), ['a']);
  assert.deepEqual(normalizeScenarios(rows, { platform: 'luma' }).map((s) => s.name), ['a', 'b']);
});

test('url may use {term} but no other placeholder', () => {
  assert.doesNotThrow(() => normalizeScenarios([row({ url: 'https://s.test/s?q={term}' })]));
  assert.throws(() => normalizeScenarios([row({ url: 'https://s.test/s?q={query}' })]), /\{query\}/);
});

test('scenariosUse detects {term} in url or expect', () => {
  const a = normalizeScenarios([row({ url: 'https://s.test/s?q={term}' })]);
  const b = normalizeScenarios([row({ url: 'https://s.test/x', expect: 'for {term}' })]);
  const c = normalizeScenarios([row({ url: 'https://s.test/x' })]);
  assert.equal(scenariosUse(a, 'term'), true);
  assert.equal(scenariosUse(b, 'term'), true);
  assert.equal(scenariosUse(c, 'term'), false);
});

test('pickScenario honours boundaries', () => {
  const s = normalizeScenarios([
    row({ name: 'a', url: 'https://s.test/a', traffic_pct: '50' }),
    row({ name: 'b', url: 'https://s.test/b', traffic_pct: '50' }),
  ]);
  assert.equal(pickScenario(s, 0).name, 'a');
  assert.equal(pickScenario(s, 0.4999).name, 'a');
  assert.equal(pickScenario(s, 0.5).name, 'b');
  assert.equal(pickScenario(s, 0.999999).name, 'b');
});

test('pickScenario matches traffic shares over many draws', () => {
  const s = normalizeScenarios([
    row({ name: 'home', url: 'https://s.test/', traffic_pct: '35' }),
    row({ name: 'cat', url: 'https://s.test/c', traffic_pct: '25' }),
    row({ name: 'pdp', url: 'https://s.test/p', traffic_pct: '20' }),
    row({ name: 'search', url: 'https://s.test/s', traffic_pct: '10' }),
    row({ name: 'cms', url: 'https://s.test/m', traffic_pct: '5' }),
    row({ name: 'cart', url: 'https://s.test/k', traffic_pct: '5' }),
  ]);
  const rnd = seededRandom(42);
  const N = 200000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    const n = pickScenario(s, rnd()).name;
    counts[n] = (counts[n] || 0) + 1;
  }
  for (const x of s) {
    const got = counts[x.name] / N;
    const tol = 4 * Math.sqrt((x.share * (1 - x.share)) / N);
    assert.ok(Math.abs(got - x.share) <= tol, `${x.name}: got ${got}, want ${x.share} ± ${tol}`);
  }
});

test('decideHit: 0% never hits, 100% always hits', () => {
  const rnd = seededRandom(7);
  for (let i = 0; i < 10000; i++) {
    const r = rnd();
    assert.equal(decideHit(0, r), false);
    assert.equal(decideHit(100, r), true);
  }
  assert.equal(decideHit(100, 0.9999999), true);
  assert.equal(decideHit(0, 0), false);
});

test('decideHit matches cache_hit_pct over many draws', () => {
  for (const pct of [5, 20, 50, 80, 95]) {
    const rnd = seededRandom(pct);
    const N = 100000;
    let hits = 0;
    for (let i = 0; i < N; i++) if (decideHit(pct, rnd())) hits++;
    const p = pct / 100;
    const tol = 4 * Math.sqrt((p * (1 - p)) / N);
    assert.ok(Math.abs(hits / N - p) <= tol, `${pct}%: got ${hits / N}`);
  }
});

test('opts.cacheHit overrides every row', () => {
  const s = normalizeScenarios([
    row({ name: 'a', url: 'https://s.test/a', cache_hit_pct: '95' }),
    row({ name: 'b', url: 'https://s.test/b', cache_hit_pct: '50' }),
  ], { cacheHit: 0 });
  assert.deepEqual(s.map((x) => x.cacheHit), [0, 0]);
});
