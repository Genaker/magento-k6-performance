/**
 * magento.js — Magento 2 page load test for k6 (FPC-aware)
 *
 * Single page (original behavior):
 *   k6 run magento.js -e URL=https://example.com/product.html -u 50 -d 2m
 *   FPC=OFF (default) busts the cache on every request with ?fpc=<token>,
 *   FPC=ON requests the bare URL so the Full Page Cache can serve it.
 *
 * Page mix from a CSV (name,type,url,cache_hit_pct,traffic_pct,expect,...):
 *   k6 run magento.js -e CSV=scenarios/sample-data.csv -e BASE_URL=https://site -u 100 -d 5m
 *   Pages are picked by traffic_pct; for each request, cache_hit_pct decides
 *   whether the bare URL (cache hit) or a busted URL (forced miss) is sent.
 *
 * YAML plan (recommended): sites, load settings, thresholds, per-platform
 * browser sub-requests and the page mix in one file:
 *   k6 run magento.js -e PLAN=plans/sample-data.yml -e SITE=flux
 *
 * Same scenarios on different storefronts from a CSV:
 *   -e PLATFORM=flux -e PROFILE=profiles/platforms.json -e TERMS=scenarios/search-terms.txt
 *   PLATFORM picks `<column>_<platform>` CSV overrides; PROFILE adds the
 *   AJAX/GraphQL calls that platform's browser makes after each page type.
 *
 * Load comes from k6 CLI flags, or from MODE=vus|rps|iterations.
 * All logic lives in ./lib (unit-tested with `npm test`). See README.md.
 */
import http from 'k6/http';
import encoding from 'k6/encoding';
import { sleep, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import { parseConfig, singleScenario } from './lib/config.js';
import { parseCsv } from './lib/csv.js';
import { normalizeScenarios, pickScenario, decideHit, scenariosUse } from './lib/scenarios.js';
import { makeBustToken } from './lib/url.js';
import { detectCacheHit, isErrorStatus } from './lib/cache.js';
import { buildOptions } from './lib/profile.js';
import { parseTerms } from './lib/template.js';
import { parsePlatformProfile, callsUse } from './lib/platform.js';
import { buildPageView, validatePlan } from './lib/pageview.js';
import { parsePlanText, applySitesText, planEnv, planRows, planProfile, planTermsSource } from './lib/plan.js';

// A YAML plan supplies settings; real -e values override them.
// -e SITES=<file> swaps in private hosts without editing the shared plan.
const PLAN_PATH = __ENV.PLAN || __ENV.plan;
const SITES_PATH = __ENV.SITES || __ENV.sites;
let PLAN = PLAN_PATH ? parsePlanText(open(PLAN_PATH), PLAN_PATH) : null;
if (PLAN && SITES_PATH) PLAN = applySitesText(PLAN, open(SITES_PATH), SITES_PATH);
const ENV = PLAN ? planEnv(PLAN, __ENV) : __ENV;
const CONFIG = parseConfig(ENV);

// Loaded once and shared by all VUs. open() only works in the init context.
const SCENARIOS = new SharedArray('scenarios', function () {
  if (CONFIG.mode === 'single') return singleScenario(CONFIG);
  const rows = CONFIG.mode === 'plan' ? planRows(PLAN) : parseCsv(open(CONFIG.csv));
  return normalizeScenarios(rows, { baseUrl: CONFIG.baseUrl, platform: CONFIG.platform, cacheHit: CONFIG.cacheHit });
});

const TERMS = new SharedArray('terms', function () {
  if (CONFIG.terms) return parseTerms(open(CONFIG.terms)); // -e TERMS= wins over the plan
  const src = PLAN ? planTermsSource(PLAN, PLAN_PATH) : null;
  if (src && src.inline) return src.inline;
  if (src && src.file) return parseTerms(open(src.file));
  return [];
});

// Browser sub-requests for this platform: the plan's "platforms" section, or
// a PROFILE json in CSV mode. SharedArray needs an array, so wrap it.
function loadProfile() {
  if (PLAN) return planProfile(PLAN);
  return CONFIG.profile ? JSON.parse(open(CONFIG.profile)) : null;
}
const CALLS = CONFIG.platform && (PLAN ? PLAN.platforms : CONFIG.profile)
  ? new SharedArray('calls', function () {
    return [parsePlatformProfile(loadProfile(), CONFIG.platform)];
  })[0]
  : null;

if ((scenariosUse(SCENARIOS, 'term') || (CALLS && callsUse(CALLS, 'term'))) && TERMS.length === 0) {
  throw new Error('Scenarios use {term}: set -e TERMS=path/to/search-terms.txt (one term per line)');
}
validatePlan(SCENARIOS, {
  terms: TERMS,
  bustKey: CONFIG.bustKey,
  calls: CALLS,
  baseUrl: CONFIG.baseUrl,
  apiBase: CONFIG.apiBase,
});

// Metrics. Page samples are tagged { page, type, cache: hit|miss };
// follow-up call samples also carry { call }.
const responseTimes = new Trend('response_times', true);
const ttfb = new Trend('ttfb', true);
const apiResponseTimes = new Trend('api_response_times', true);
const pageViewTime = new Trend('page_view_time', true);
const errorRate = new Rate('errors');
const apiErrorRate = new Rate('api_errors');
const contentMissing = new Rate('content_missing');
const requestsTotal = new Counter('requests_total');
const apiCallsTotal = new Counter('api_calls_total');
const cacheActualHit = new Rate('cache_actual_hit');
const cacheMismatch = new Rate('cache_expectation_mismatch');

export const options = buildOptions(ENV);

// Log the first failures per VU, then every 100th, so a broken site can't
// flood the console (the metrics still count every failure).
let failureLogCount = 0;
function logFailure(msg) {
  failureLogCount++;
  if (failureLogCount <= 10 || failureLogCount % 100 === 0) {
    console.error(`[VU${__VU}] ${msg}${failureLogCount > 10 ? ` (failure #${failureLogCount})` : ''}`);
  }
}

function bodyHas(res, text) {
  return typeof res.body === 'string' && res.body.indexOf(text) !== -1;
}

// Who answered an error: Server header + start of the error page (Varnish,
// load balancer and CDN error pages look different). Empty when no body.
function errorHint(res) {
  const server = res.headers && (res.headers.Server || res.headers.server);
  const body = typeof res.body === 'string'
    ? res.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    : '';
  return `${server ? ` server=${server}` : ''}${body ? ` body="${body}"` : ''}`;
}

export function setup() {
  const target = CONFIG.mode === 'single'
    ? CONFIG.url
    : CONFIG.mode === 'plan'
      ? `${PLAN.name || CONFIG.plan} (${SCENARIOS.length} pages${CONFIG.site ? `, site ${CONFIG.site}: ${CONFIG.baseUrl}` : ''})`
      : `${CONFIG.csv} (${SCENARIOS.length} pages)`;
  console.log(
    `Mode: ${CONFIG.mode} | Target: ${target} | Method: ${CONFIG.method} | N: ${CONFIG.n}` +
    (CONFIG.platform ? ` | Platform: ${CONFIG.platform}` : '') +
    (TERMS.length ? ` | Search terms: ${TERMS.length}` : '')
  );
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    const traffic = `${(s.share * 100).toFixed(1)}%`;
    console.log(`  [${s.type}] ${s.name}  traffic=${traffic}  cache_hit=${s.cacheHit}%  ${s.url}`);
  }
  return {};
}

export default function () {
  const headers = { 'User-Agent': 'k6/MagentoLoadTest/2.0' };
  if (__ENV.USERNAME && __ENV.PASSWORD) {
    headers.Authorization = `Basic ${encoding.b64encode(`${__ENV.USERNAME}:${__ENV.PASSWORD}`)}`;
  }
  // Asks Varnish/Magento to echo X-Magento-Cache-Debug (needs the debug ACL).
  if (CONFIG.debugHeader) headers['X-Magento-Debug'] = '1';

  for (let i = 0; i < CONFIG.n; i++) {
    const s = pickScenario(SCENARIOS, Math.random());
    if (CONFIG.freshSession) http.cookieJar().clear(s.url.replace(/\{term\}.*/, ''));

    const wantHit = decideHit(s.cacheHit, Math.random());
    const view = buildPageView(s, {
      wantHit: wantHit,
      term: TERMS.length ? TERMS[Math.floor(Math.random() * TERMS.length)] : undefined,
      bustKey: CONFIG.bustKey,
      bustToken: makeBustToken(__VU, __ITER, i),
      now: Date.now(),
      calls: CALLS,
      baseUrl: CONFIG.baseUrl,
      apiBase: CONFIG.apiBase,
    });
    const cache = wantHit ? 'hit' : 'miss';
    // `name` groups every busted URL / search term under its page, otherwise
    // each unique URL becomes a new metric time series (memory + k6 warnings).
    const tags = { page: s.name, type: s.type, cache: cache, name: s.url };

    // ---- the page ----
    const res = http.request(CONFIG.method, view.url, null, {
      headers: headers,
      tags: tags,
      responseType: view.expect ? 'text' : 'none',
    });
    const httpFailed = isErrorStatus(res.status);
    const missing = !httpFailed && view.expect !== '' && !bodyHas(res, view.expect);
    const failed = httpFailed || missing;
    const actualHit = detectCacheHit(res.headers).hit;

    responseTimes.add(res.timings.duration, tags);
    ttfb.add(res.timings.waiting, tags);
    errorRate.add(failed, tags);
    requestsTotal.add(1, tags);
    cacheActualHit.add(actualHit, tags);
    cacheMismatch.add(actualHit !== wantHit, tags);
    if (view.expect) contentMissing.add(missing, Object.assign({ kind: 'page' }, tags));
    check(res, {
      'status is 2xx/3xx': function () { return !httpFailed; },
      'page has expected content': function () { return !missing; },
    }, tags);

    if (CONFIG.verbose) {
      console.log(
        `[${CONFIG.method}] ${res.status} want=${cache} got=${actualHit ? 'hit' : 'miss'} ` +
        `${res.timings.duration.toFixed(1)}ms ttfb=${res.timings.waiting.toFixed(1)}ms ${view.url}`
      );
    }
    if (httpFailed) logFailure(`${CONFIG.method} ${view.url} - Error ${res.status}${errorHint(res)}`);
    else if (missing) logFailure(`${view.url} - 200 but missing expected text "${view.expect}"`);

    // ---- follow-up calls the browser makes (in parallel, like XHRs) ----
    let slowestCall = 0;
    if (!httpFailed && view.calls.length) {
      const batch = view.calls.map(function (c) {
        return {
          method: 'GET',
          url: c.url,
          params: {
            headers: Object.assign({}, headers, c.headers),
            tags: Object.assign({}, tags, { call: c.name, name: `${s.type}:${c.name}` }),
            responseType: c.expect ? 'text' : 'none',
          },
        };
      });
      const responses = http.batch(batch);
      for (let j = 0; j < responses.length; j++) {
        const c = view.calls[j];
        const r = responses[j];
        const ctags = Object.assign({}, tags, { call: c.name });
        const cHttpFailed = isErrorStatus(r.status);
        const cMissing = !cHttpFailed && c.expect !== '' && !bodyHas(r, c.expect);
        apiResponseTimes.add(r.timings.duration, ctags);
        apiErrorRate.add(cHttpFailed || cMissing, ctags);
        apiCallsTotal.add(1, ctags);
        if (c.expect) contentMissing.add(cMissing, Object.assign({ kind: 'api' }, ctags));
        if (r.timings.duration > slowestCall) slowestCall = r.timings.duration;
        if (cHttpFailed) logFailure(`call ${c.name} ${c.url.slice(0, 120)} - Error ${r.status}${errorHint(r)}`);
        else if (cMissing) logFailure(`call ${c.name} - 200 but missing expected text "${c.expect}"`);
      }
    }
    // Page + slowest follow-up call (they run in parallel after the page).
    pageViewTime.add(res.timings.duration + slowestCall, tags);

    if (CONFIG.sleep > 0) sleep(CONFIG.sleep);
  }
}

export function teardown() {
  const strategy = CONFIG.mode === 'single'
    ? (CONFIG.fpcEnabled ? 'FPC Enabled' : 'Cache Busted')
    : 'Per page (cache_hit_pct)';
  console.log(`\nTest Summary:
  Mode: ${CONFIG.mode}
  Target: ${CONFIG.mode === 'single' ? CONFIG.url : CONFIG.mode === 'plan' ? `${CONFIG.plan}${CONFIG.site ? ` (site ${CONFIG.site})` : ''}` : CONFIG.csv}
  Platform: ${CONFIG.platform || '-'}${CONFIG.profile ? ` (profile ${CONFIG.profile})` : ''}
  Method: ${CONFIG.method}
  Requests per iteration (N): ${CONFIG.n}
  Cache Strategy: ${strategy}
  Sleep: ${CONFIG.sleep}s`);
}
