// The shipped plan must stay valid for every site/platform it defines.
// (Whether its pages return data on a real store is checked with
// `npm run validate`, see README.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePlanText, planEnv, planRows, planProfile, planTermsSource } from '../lib/sources/yaml.js';
import { normalizeScenarios } from '../lib/scenarios.js';
import { parseTerms } from '../lib/template.js';
import { parsePlatformProfile } from '../lib/platform.js';
import { validatePlan, buildPageView } from '../lib/pageview.js';
import { parseConfig } from '../lib/config.js';
import { buildOptions } from '../lib/profile.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PLAN_PATH = 'plans/sample-data.yml';
const plan = parsePlanText(readFileSync(`${root}/${PLAN_PATH}`, 'utf8'), PLAN_PATH);
const termsSrc = planTermsSource(plan, PLAN_PATH);
const terms = parseTerms(readFileSync(`${root}/${termsSrc.file}`, 'utf8'));

function siteSetup(site) {
  const env = planEnv(plan, { PLAN: PLAN_PATH, SITE: site });
  const cfg = parseConfig(env);
  const scenarios = normalizeScenarios(planRows(plan), { baseUrl: cfg.baseUrl, platform: cfg.platform });
  const calls = parsePlatformProfile(planProfile(plan), cfg.platform);
  return { env, cfg, scenarios, calls };
}

for (const site of Object.keys(plan.sites)) {
  test(`plan is valid end to end for site ${site}`, () => {
    const { env, cfg, scenarios, calls } = siteSetup(site);
    assert.equal(cfg.mode, 'plan');
    assert.doesNotThrow(() => validatePlan(scenarios, { terms, bustKey: cfg.bustKey, calls, baseUrl: cfg.baseUrl, apiBase: cfg.apiBase }));
    const options = buildOptions(env);
    assert.equal(options.scenarios.load.executor, 'constant-arrival-rate');
    assert.ok(options.thresholds.api_errors && options.thresholds.errors);
  });
}

test('traffic mix: search 20%, 16 categories 32%, 16 products 32%, sums to 100', () => {
  const scenarios = normalizeScenarios(planRows(plan), { baseUrl: 'https://shop.test' });
  const byType = {};
  let total = 0;
  for (const s of scenarios) {
    byType[s.type] = (byType[s.type] || 0) + s.traffic;
    total += s.traffic;
  }
  assert.equal(total, 100);
  assert.equal(byType.search, 20);
  assert.equal(byType.category, 32);
  assert.equal(byType.product, 32);
  assert.equal(scenarios.filter((s) => s.type === 'category').length, 16);
  assert.equal(scenarios.filter((s) => s.type === 'product').length, 16);
  assert.ok(byType.cms > 0 && byType.cart > 0 && byType.checkout > 0 && byType.home > 0);
});

test('every page has an expect text on every site', () => {
  for (const site of Object.keys(plan.sites)) {
    for (const s of siteSetup(site).scenarios) assert.ok(s.expect, `${s.name} has no expect on ${site}`);
  }
});

function fluxSearchView(platform) {
  const env = planEnv(plan, { PLAN: PLAN_PATH, SITE: 'flux' });
  const s = normalizeScenarios(planRows(plan), { baseUrl: env.BASE_URL, platform }).find((x) => x.type === 'search');
  const v = buildPageView(s, {
    wantHit: true, term: 'bag', bustKey: 'fpc', bustToken: 't', now: 1,
    calls: parsePlatformProfile(planProfile(plan), platform), baseUrl: env.BASE_URL, apiBase: env.API_BASE,
  });
  assert.equal(v.url, `${env.BASE_URL}/catalog/product_search?search=bag`, platform);
  for (const c of v.calls) {
    assert.ok(c.url.startsWith(`${env.API_BASE}/graphql?query=`), platform);
    assert.ok(c.url.includes('%22search%22%3A%22bag%22'), platform);
  }
  return v;
}

test('flux search sends ONE full GraphQL call per search (the displayed DESC sort, no duplicate)', () => {
  const v = fluxSearchView('flux');
  assert.deepEqual(v.calls.map((c) => c.name), ['gql_search_products']);
  assert.ok(v.calls[0].url.includes('%22DESC%22') && !v.calls[0].url.includes('%22ASC%22'));
});

test('flux.asis reproduces the deployed duplicate: same query twice, ASC then DESC', () => {
  const v = fluxSearchView('flux.asis');
  assert.deepEqual(v.calls.map((c) => c.name), ['gql_search_products', 'gql_search_products_resort']);
  assert.ok(v.calls[0].url.includes('%22ASC%22') && v.calls[1].url.includes('%22DESC%22'));
  // identical apart from the sort direction
  assert.equal(v.calls[0].url.replace('%22ASC%22', '%22DESC%22'), v.calls[1].url);
});

test('luma: only search pages log the term (banner AJAX deliberately left out)', () => {
  const { cfg, scenarios, calls } = siteSetup('luma');
  for (const s of scenarios) {
    const v = buildPageView(s, { wantHit: true, term: 'bag', bustKey: 'fpc', bustToken: 't', now: 1, calls, baseUrl: cfg.baseUrl });
    assert.ok(!v.calls.some((c) => c.name === 'banner_ajax'), `${s.name} must not send banner_ajax`);
    if (s.type === 'search') {
      assert.deepEqual(v.calls.map((c) => c.name), ['search_terms_log']);
      assert.equal(v.calls[0].headers['X-Requested-With'], 'XMLHttpRequest');
      assert.ok(v.calls[0].url.endsWith('/catalogsearch/searchTermsLog/save/?q=bag&_=1'));
    } else {
      assert.equal(v.calls.length, 0, s.name);
    }
  }
});

test('hyva has no follow-up calls', () => {
  const { scenarios, calls } = siteSetup('hyva');
  for (const s of scenarios) {
    assert.equal(buildPageView(s, { wantHit: true, term: 'bag', bustKey: 'fpc', bustToken: 't', now: 1, calls }).calls.length, 0);
  }
});

test('search terms are unique and plentiful', () => {
  assert.equal(new Set(terms).size, terms.length);
  assert.ok(terms.length >= 20);
});

test('flux.min sends one minimal search call', () => {
  const v = fluxSearchView('flux.min');
  assert.deepEqual(v.calls.map((c) => c.name), ['gql_search_products_min']);
  assert.ok(v.calls[0].url.includes('getProductsListMin'));
});

test('no Flux platform sends the duplicate except flux.asis', () => {
  const profile = planProfile(plan);
  for (const platform of Object.keys(plan.platforms).filter((p) => p.split('.')[0] === 'flux' && p !== 'flux.asis')) {
    const names = (parsePlatformProfile(profile, platform).search || []).map((c) => c.name);
    assert.ok(!names.includes('gql_search_products_resort'), platform);
    assert.equal(names.length, 1, platform);
  }
});
