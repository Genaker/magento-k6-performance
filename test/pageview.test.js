import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageView, validatePlan } from '../lib/pageview.js';
import { parsePlatformProfile } from '../lib/platform.js';

const calls = parsePlatformProfile({
  platforms: {
    luma: {
      calls: {
        '*': [{ name: 'banner', url: '/banner?u={page_url}&_={ts}', headers: { 'X-Requested-With': 'XMLHttpRequest' } }],
        search: [{ name: 'gql', url: '{api_base}/graphql?q={term}', expect: 'term={term}' }],
      },
    },
  },
}, 'luma');

const base = { bustKey: 'fpc', bustToken: 'TOK', now: 123, calls, baseUrl: 'https://shop.test', apiBase: 'https://api.test/' };
const search = { url: 'https://shop.test/s?q={term}', expect: 'Results for {term}', type: 'search' };
const pdp = { url: 'https://shop.test/p.html', expect: 'Hero', type: 'product' };

test('cache hit: bare urls, term filled, placeholders resolved', () => {
  const v = buildPageView(search, { ...base, wantHit: true, term: 'yoga mat' });
  assert.equal(v.url, 'https://shop.test/s?q=yoga+mat');
  assert.equal(v.expect, 'Results for yoga mat');
  assert.deepEqual(v.calls.map((c) => c.url), [
    `https://shop.test/banner?u=${encodeURIComponent('https://shop.test/s?q=yoga+mat')}&_=123`,
    'https://api.test/graphql?q=yoga+mat',
  ]);
  assert.equal(v.calls[1].expect, 'term=yoga mat');
  assert.deepEqual(v.calls[0].headers, { 'X-Requested-With': 'XMLHttpRequest' });
});

test('cache miss: page AND follow-up calls are busted', () => {
  const v = buildPageView(search, { ...base, wantHit: false, term: 'bag' });
  assert.equal(v.url, 'https://shop.test/s?q=bag&fpc=TOK');
  for (const c of v.calls) assert.match(c.url, /&fpc=TOK$/);
  // the browser reports the URL it actually loaded
  assert.ok(v.calls[0].url.includes(encodeURIComponent('https://shop.test/s?q=bag&fpc=TOK')));
});

test('only "*" calls for a type without its own list', () => {
  const v = buildPageView(pdp, { ...base, wantHit: true });
  assert.deepEqual(v.calls.map((c) => c.name), ['banner']);
});

test('no profile => no calls', () => {
  const v = buildPageView(pdp, { ...base, calls: null, wantHit: true });
  assert.deepEqual(v.calls, []);
});

test('relative calls fall back to the page origin without BASE_URL', () => {
  const v = buildPageView({ url: 'https://other.test/x', expect: '', type: 'page' }, { ...base, baseUrl: undefined, wantHit: true });
  assert.match(v.calls[0].url, /^https:\/\/other\.test\/banner\?/);
});

test('validatePlan explains a missing TERMS or API_BASE', () => {
  assert.throws(() => validatePlan([search], { ...base, terms: [] }), /Scenario .*\{term\}.*TERMS=/);
  assert.throws(() => validatePlan([search], { ...base, terms: ['bag'], apiBase: undefined }), /\{api_base\}.*API_BASE=/);
  assert.doesNotThrow(() => validatePlan([search, pdp], { ...base, terms: ['bag'] }));
});
