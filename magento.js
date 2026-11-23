/**
 * magento.js — Magento 2 page load test for k6 (FPC-aware)
 *
 * Single page (original behavior):
 *   k6 run magento.js -e URL=https://example.com/product.html -u 50 -d 2m
 *   FPC=OFF (default) busts the cache on every request with ?fpc=<token>,
 *   FPC=ON requests the bare URL so the Full Page Cache can serve it.
 *
 * Page mix from a CSV (name,url,cache_hit_pct,traffic_pct):
 *   k6 run magento.js -e CSV=scenarios.csv -u 100 -d 5m
 *   Pages are picked by traffic_pct; for each request, cache_hit_pct decides
 *   whether the bare URL (cache hit) or a busted URL (forced miss) is sent.
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
import { normalizeScenarios, pickScenario, decideHit } from './lib/scenarios.js';
import { appendQueryParam, makeBustToken } from './lib/url.js';
import { detectCacheHit, isErrorStatus } from './lib/cache.js';
import { buildOptions } from './lib/profile.js';

const CONFIG = parseConfig(__ENV);

// Loaded once and shared by all VUs. open() only works in the init context.
const SCENARIOS = new SharedArray('scenarios', function () {
  if (CONFIG.mode === 'single') return singleScenario(CONFIG);
  return normalizeScenarios(parseCsv(open(CONFIG.csv)), { baseUrl: CONFIG.baseUrl });
});

// Metrics. Every sample is tagged with { page, cache: hit|miss }.
const responseTimes = new Trend('response_times', true);
const ttfb = new Trend('ttfb', true);
const errorRate = new Rate('errors');
const requestsTotal = new Counter('requests_total');
const cacheActualHit = new Rate('cache_actual_hit');
const cacheMismatch = new Rate('cache_expectation_mismatch');

export const options = buildOptions(__ENV);

export function setup() {
  const target = CONFIG.mode === 'single' ? CONFIG.url : `${CONFIG.csv} (${SCENARIOS.length} pages)`;
  console.log(`Mode: ${CONFIG.mode} | Target: ${target} | Method: ${CONFIG.method} | N: ${CONFIG.n}`);
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    const traffic = `${(s.share * 100).toFixed(1)}%`;
    console.log(`  ${s.name}  traffic=${traffic}  cache_hit=${s.cacheHit}%  ${s.url}`);
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
    if (CONFIG.freshSession) http.cookieJar().clear(s.url);

    const wantHit = decideHit(s.cacheHit, Math.random());
    const url = wantHit
      ? s.url
      : appendQueryParam(s.url, CONFIG.bustKey, makeBustToken(__VU, __ITER, i));
    const cache = wantHit ? 'hit' : 'miss';
    // `name` groups every busted URL under its page, otherwise each unique
    // ?fpc= value becomes a new metric time series (memory + k6 warnings).
    const tags = { page: s.name, cache: cache, name: s.url };

    const res = http.request(CONFIG.method, url, null, { headers: headers, tags: tags });
    const failed = isErrorStatus(res.status);
    const actualHit = detectCacheHit(res.headers).hit;

    responseTimes.add(res.timings.duration, tags);
    ttfb.add(res.timings.waiting, tags);
    errorRate.add(failed, tags);
    requestsTotal.add(1, tags);
    cacheActualHit.add(actualHit, tags);
    cacheMismatch.add(actualHit !== wantHit, tags);
    check(res, { 'status is 2xx/3xx': function () { return !failed; } }, tags);

    if (CONFIG.verbose) {
      console.log(
        `[${CONFIG.method}] ${res.status} want=${cache} got=${actualHit ? 'hit' : 'miss'} ` +
        `${res.timings.duration.toFixed(1)}ms ttfb=${res.timings.waiting.toFixed(1)}ms ${url}`
      );
    }
    if (failed) console.error(`[VU${__VU}] ${CONFIG.method} ${url} - Error ${res.status}`);
    if (CONFIG.sleep > 0) sleep(CONFIG.sleep);
  }
}

export function teardown() {
  const strategy = CONFIG.mode === 'single'
    ? (CONFIG.fpcEnabled ? 'FPC Enabled' : 'Cache Busted')
    : 'Per page (cache_hit_pct)';
  console.log(`\nTest Summary:
  Mode: ${CONFIG.mode}
  Target: ${CONFIG.mode === 'single' ? CONFIG.url : CONFIG.csv}
  Method: ${CONFIG.method}
  Requests per iteration (N): ${CONFIG.n}
  Cache Strategy: ${strategy}
  Sleep: ${CONFIG.sleep}s`);
}
