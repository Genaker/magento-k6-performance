import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlanText, applySitesText, planEnv, planRows, planProfile, resolveRelative, planTermsSource,
} from '../lib/plan.js';
import { normalizeScenarios } from '../lib/scenarios.js';

const PLAN = `
name: test plan
sites:
  luma: { base_url: https://luma.test }
  flux: { base_url: https://flux.test, api_base: https://api.test, platform: flux }
load: { mode: rps, rps: 20, duration: 2m }
thresholds: { t_p95: 3000, max_error_rate: 0.01 }
options: { debug_header: false }
search_terms: [bag, yoga mat]
platforms:
  flux:
    calls:
      search:
        - { name: gql, url: "{api_base}/graphql?q={term}", expect: '"items":[{' }
pages:
  - { name: home, type: home, url: /, cache_hit: 95, traffic: 30, expect: { luma: Hero, flux: Tank } }
  - { name: search, type: search, url: { default: "/s?q={term}", flux: "/search?q={term}" }, cache_hit: 50, traffic: 20 }
  - { name: magento_only, url: { default: /x, flux: "-" }, cache_hit: 0, traffic: 10 }
`;

test('parses a plan and maps settings to env names', () => {
  const plan = parsePlanText(PLAN, 'p.yml');
  const env = planEnv(plan, { SITE: 'flux' });
  assert.equal(env.MODE, 'rps');
  assert.equal(env.RPS, '20');
  assert.equal(env.DURATION, '2m');
  assert.equal(env.T_P95, '3000');
  assert.equal(env.MAX_ERROR_RATE, '0.01');
  assert.equal(env.DEBUG_HEADER, 'false');
  assert.equal(env.BASE_URL, 'https://flux.test');
  assert.equal(env.API_BASE, 'https://api.test');
  assert.equal(env.PLATFORM, 'flux');
});

test('-e values override plan values (any case)', () => {
  const env = planEnv(parsePlanText(PLAN), { SITE: 'flux', rps: '5', BASE_URL: 'https://other.test' });
  assert.equal(env.RPS, '5');
  assert.equal(env.BASE_URL, 'https://other.test');
  assert.equal(env.API_BASE, 'https://api.test');
});

test('platform defaults to the site name', () => {
  assert.equal(planEnv(parsePlanText(PLAN), { SITE: 'luma' }).PLATFORM, 'luma');
});

test('SITE is required with several sites, optional with one, must exist', () => {
  assert.throws(() => planEnv(parsePlanText(PLAN), {}), /-e SITE=<luma\|flux>/);
  assert.throws(() => planEnv(parsePlanText(PLAN), { SITE: 'pwa' }), /"pwa" not in plan/);
  const one = parsePlanText('sites: { only: { base_url: https://one.test } }\npages: [{ url: /, cache_hit: 1, traffic: 1 }]');
  assert.equal(planEnv(one, {}).BASE_URL, 'https://one.test');
  const none = parsePlanText('pages: [{ url: https://a.test/, cache_hit: 1, traffic: 1 }]');
  assert.equal(planEnv(none, {}).BASE_URL, undefined);
});

test('pages become rows with per-platform url/expect overrides', () => {
  const plan = parsePlanText(PLAN);
  const flux = normalizeScenarios(planRows(plan), { baseUrl: 'https://flux.test', platform: 'flux' });
  assert.deepEqual(flux.map((s) => s.name), ['home', 'search']); // "-" skips magento_only
  assert.equal(flux[0].expect, 'Tank');
  assert.equal(flux[1].url, 'https://flux.test/search?q={term}');
  const luma = normalizeScenarios(planRows(plan), { baseUrl: 'https://luma.test', platform: 'luma' });
  assert.equal(luma.length, 3);
  assert.equal(luma[0].expect, 'Hero');
  assert.equal(luma[1].url, 'https://luma.test/s?q={term}');
  assert.equal(luma[0].share, 0.5);
});

test('page errors name the plan entry', () => {
  const plan = parsePlanText('pages:\n  - { name: a, url: /, cache_hit: 1, traffic: 1 }\n  - { name: b, url: /b, cache_hit: 500, traffic: 1 }');
  assert.throws(() => normalizeScenarios(planRows(plan), { baseUrl: 'https://s.test' }), /Plan pages\[1\] \(b\): cache_hit_pct/);
});

test('unknown keys are rejected (typos fail fast)', () => {
  assert.throws(() => parsePlanText('pagez: []'), /unknown key "pagez" in the top level/);
  assert.throws(() => parsePlanText('load: { vu: 5 }\npages: [{ url: /, cache_hit: 1, traffic: 1 }]'), /unknown key "vu" in load/);
  assert.throws(() => parsePlanText('pages: [{ url: /, cache_hits: 1, traffic: 1 }]'), /unknown key "cache_hits" in pages\[0\]/);
  assert.throws(() => parsePlanText('sites: { a: { base: x } }\npages: [{ url: /, cache_hit: 1, traffic: 1 }]'), /unknown key "base" in sites\.a/);
});

test('structure errors', () => {
  assert.throws(() => parsePlanText('name: x'), /"pages" must be a non-empty list/);
  assert.throws(() => parsePlanText('- just\n- a list'), /must be a mapping/);
  assert.throws(() => parsePlanText('pages: [\n'), /invalid YAML/);
  assert.throws(() => parsePlanText('sites: { a: {} }\npages: [{ url: /, cache_hit: 1, traffic: 1 }]'), /base_url is required/);
  assert.throws(() => parsePlanText('sites: { a: { base_url: shop.test } }\npages: [{ url: /, cache_hit: 1, traffic: 1 }]'), /must start with http/);
  assert.throws(() => parsePlanText('search_terms: bag\npages: [{ url: /, cache_hit: 1, traffic: 1 }]'), /"search_terms" must be a list/);
  assert.throws(
    () => parsePlanText('search_terms: [a]\nsearch_terms_file: t.txt\npages: [{ url: /, cache_hit: 1, traffic: 1 }]'),
    /either search_terms or search_terms_file/
  );
  assert.throws(() => planRows(parsePlanText('pages: [{ url: [1, 2], cache_hit: 1, traffic: 1 }]')), /url must be text or a mapping/);
});

test('JSON plans work too (JSON is YAML)', () => {
  const plan = parsePlanText('{"pages":[{"name":"a","url":"https://s.test/","cache_hit":1,"traffic":1}]}');
  assert.equal(planRows(plan)[0].url, 'https://s.test/');
});

test('applySitesText swaps in private hosts', () => {
  const plan = parsePlanText(PLAN);
  const swapped = applySitesText(plan, 'sites:\n  flux: { base_url: https://flux-test.private, api_base: https://api.private }\n', 's.yml');
  assert.equal(planEnv(swapped, {}).BASE_URL, 'https://flux-test.private');
  assert.equal(plan.sites.luma.base_url, 'https://luma.test'); // original untouched
  const bare = applySitesText(plan, 'x: { base_url: https://x.test }', 's.yml'); // mapping without "sites:"
  assert.equal(planEnv(bare, {}).BASE_URL, 'https://x.test');
  assert.throws(() => applySitesText(plan, 'sites: { a: { base_url: nope } }', 's.yml'), /must start with http/);
  assert.throws(() => applySitesText(plan, 'sites: {}', 's.yml'), /non-empty/);
});

test('planProfile exposes the platforms section', () => {
  assert.deepEqual(Object.keys(planProfile(parsePlanText(PLAN)).platforms), ['flux']);
  assert.equal(planProfile(parsePlanText('pages: [{ url: /, cache_hit: 1, traffic: 1 }]')), null);
});

test('resolveRelative resolves against the plan directory', () => {
  assert.equal(resolveRelative('plans/sample-data.yml', '../scenarios/terms.txt'), 'scenarios/terms.txt');
  assert.equal(resolveRelative('plans/sample-data.yml', 'terms.txt'), 'plans/terms.txt');
  assert.equal(resolveRelative('plan.yml', './terms.txt'), 'terms.txt');
  assert.equal(resolveRelative('a/b/plan.yml', '../../x.txt'), 'x.txt');
  assert.equal(resolveRelative('plans/p.yml', '/abs/terms.txt'), '/abs/terms.txt');
});

test('planTermsSource: inline list (validated) or file', () => {
  assert.deepEqual(planTermsSource(parsePlanText(PLAN), 'p.yml'), { inline: ['bag', 'yoga mat'] });
  const f = parsePlanText('search_terms_file: ../t.txt\npages: [{ url: /, cache_hit: 1, traffic: 1 }]');
  assert.deepEqual(planTermsSource(f, 'plans/p.yml'), { file: 't.txt' });
  assert.equal(planTermsSource(parsePlanText('pages: [{ url: /, cache_hit: 1, traffic: 1 }]'), 'p.yml'), null);
  assert.throws(() => planTermsSource(parsePlanText('search_terms: [ok, "a&b"]\npages: [{ url: /, cache_hit: 1, traffic: 1 }]'), 'p'), /line 2/);
});

test('plan accepts stages, abort_on_fail and cache_hit', () => {
  const plan = parsePlanText('load: { mode: ramp-rps, stages: "1m:10,2m:40" }\nthresholds: { abort_on_fail: true }\noptions: { cache_hit: 0 }\npages: [{ url: /, cache_hit: 90, traffic: 1 }]');
  const env = planEnv(plan, {});
  assert.equal(env.STAGES, '1m:10,2m:40');
  assert.equal(env.ABORT_ON_FAIL, 'true');
  assert.equal(env.CACHE_HIT, '0');
});
