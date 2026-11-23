// The shipped plan must stay valid for every site/platform it defines.
// (Whether its pages return data on a real store is checked with
// `npm run validate`, see README.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePlanText, planEnv, planRows, planProfile, planTermsSource } from '../lib/plan.js';
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

test('flux search uses the Flux route and fires both GraphQL calls', () => {
  const { cfg, scenarios, calls } = siteSetup('flux');
  const s = scenarios.find((x) => x.type === 'search');
  const v = buildPageView(s, {
    wantHit: true, term: 'bag', bustKey: 'fpc', bustToken: 't', now: 1, calls, baseUrl: cfg.baseUrl, apiBase: cfg.apiBase,
  });
  assert.equal(v.url, `${cfg.baseUrl}/catalog/product_search?search=bag`);
  assert.equal(v.calls.length, 2);
  for (const c of v.calls) {
    assert.ok(c.url.startsWith(`${cfg.apiBase}/graphql?query=`));
    assert.ok(c.url.includes('%22search%22%3A%22bag%22'));
  }
  assert.ok(v.calls[0].url.includes('%22ASC%22') && v.calls[1].url.includes('%22DESC%22'));
});

test('luma sends the banner AJAX on every page with the XHR header', () => {
  const { cfg, scenarios, calls } = siteSetup('luma');
  for (const s of scenarios) {
    const v = buildPageView(s, { wantHit: true, term: 'bag', bustKey: 'fpc', bustToken: 't', now: 1, calls, baseUrl: cfg.baseUrl });
    const banner = v.calls.find((c) => c.name === 'banner_ajax');
    assert.ok(banner, s.name);
    assert.equal(banner.headers['X-Requested-With'], 'XMLHttpRequest');
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
