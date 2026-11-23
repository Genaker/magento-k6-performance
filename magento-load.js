/**
 * magento-load.js — CSV-driven Magento FPC load test for k6
 * -------------------------------------------------------------------------
 * Improves on Genaker/magento-k6-performance (single URL, CLI-only shaping,
 * no verification) by driving the whole run from a CSV where each row is a
 * page and carries two independent weights:
 *
 *   url            the page to hit
 *   cache_hit_pct  % of requests to this page that SHOULD be cache hits.
 *                  The remaining (100 - cache_hit_pct)% get a unique
 *                  `?fpc=<token>` query param appended so Varnish / Magento
 *                  Full Page Cache treats them as a new key => cache MISS.
 *   traffic_pct    relative share of total traffic this page receives
 *                  (does NOT need to sum to 100 — it is normalized).
 *
 * The script also VERIFIES the cache result from the response (Age header /
 * X-Magento-Cache-Debug / X-Cache) so you can see expected vs actual hit
 * ratio, and tags every metric by page and by hit/miss.
 *
 * Run:
 *   k6 run magento-load.js -e CSV=scenarios.csv -e VUS=100 -e DURATION=3m
 *   k6 run magento-load.js -e MODE=rps -e RPS=200 -e DURATION=2m
 *
 * See README.md for the full option list.
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.2/index.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

const CSV_PATH = __ENV.CSV || './scenarios.csv';
// Query key used to bust FPC on the cache-miss share of traffic.
const BUST_KEY = __ENV.BUST_KEY || 'fpc';
// Send Magento's debug header so the edge echoes X-Magento-Cache-Debug.
const DEBUG_HEADER = String(__ENV.DEBUG_HEADER || 'true').toLowerCase() === 'true';
// Clear the cookie jar every iteration => behave like a brand-new visitor.
const FRESH_SESSION = String(__ENV.FRESH_SESSION || 'false').toLowerCase() === 'true';
// Think time (seconds) between iterations.
const SLEEP = num(__ENV.SLEEP, 0.5);

// ---------------------------------------------------------------------------
// Load + normalize the CSV once, shared across all VUs.
// Each row gets a cumulative weight `cum` (0..1) for weighted selection.
// ---------------------------------------------------------------------------
const scenarios = new SharedArray('scenarios', function () {
  const parsed = papaparse.parse(open(CSV_PATH), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const rows = parsed.data
    .map((r) => ({
      name: (r.name || r.url || '').trim(),
      url: (r.url || '').trim(),
      cacheHit: clampPct(r.cache_hit_pct),
      traffic: Math.max(0, num(r.traffic_pct, 0)),
    }))
    .filter((r) => r.url && r.traffic > 0);

  if (rows.length === 0) {
    throw new Error(`No usable rows in ${CSV_PATH} (need url + traffic_pct > 0)`);
  }

  const total = rows.reduce((s, r) => s + r.traffic, 0);
  let acc = 0;
  for (const r of rows) {
    r.share = r.traffic / total; // normalized traffic share 0..1
    acc += r.share;
    r.cum = acc; // last row ends at ~1.0
  }
  return rows;
});

// Weighted pick by cumulative traffic share.
function pickScenario() {
  const x = Math.random();
  for (let i = 0; i < scenarios.length; i++) {
    if (x <= scenarios[i].cum) return scenarios[i];
  }
  return scenarios[scenarios.length - 1];
}

// Unique token so a busted URL is never served from cache.
function bustToken() {
  return `${__VU}-${__ITER}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Custom metrics (all tagged by { page, cache })
// ---------------------------------------------------------------------------
const respTime = new Trend('resp_time', true);
const ttfb = new Trend('ttfb', true);
const errors = new Rate('errors');
const requests = new Counter('requests_total');
const actualHitRate = new Rate('cache_actual_hit'); // measured from response
const expectMismatch = new Rate('cache_expectation_mismatch'); // wanted!=got

// ---------------------------------------------------------------------------
// Load shape: `vus` (ramping-vus, default) or `rps` (constant-arrival-rate)
// ---------------------------------------------------------------------------
function buildScenarios() {
  const mode = (__ENV.MODE || 'vus').toLowerCase();
  if (mode === 'rps') {
    const rps = num(__ENV.RPS, 50);
    return {
      load: {
        executor: 'constant-arrival-rate',
        rate: rps,
        timeUnit: '1s',
        duration: __ENV.DURATION || '1m',
        preAllocatedVUs: num(__ENV.VUS, rps),
        maxVUs: num(__ENV.MAX_VUS, rps * 4),
      },
    };
  }
  const vus = num(__ENV.VUS, 50);
  return {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '30s', target: vus },
        { duration: __ENV.DURATION || '3m', target: vus },
        { duration: __ENV.RAMPDOWN || '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  };
}

export const options = {
  discardResponseBodies: true,
  insecureSkipTLSVerify: true,
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    // Hits should be fast; misses are allowed to be slower (full render).
    'resp_time{cache:hit}': [`p(95)<${num(__ENV.T_HIT, 800)}`],
    'resp_time{cache:miss}': [`p(95)<${num(__ENV.T_MISS, 4000)}`],
  },
  scenarios: buildScenarios(),
};

// ---------------------------------------------------------------------------
// setup(): print the resolved plan once.
// ---------------------------------------------------------------------------
export function setup() {
  console.log(`Loaded ${scenarios.length} page scenarios from ${CSV_PATH}`);
  for (const s of scenarios) {
    const traffic = `${(s.share * 100).toFixed(1)}%`;
    const hit = `${s.cacheHit}%`;
    console.log(`  ${s.name.padEnd(18)} traffic=${traffic.padStart(6)}  hit=${hit.padStart(4)}  ${s.url}`);
  }
  return {};
}

// ---------------------------------------------------------------------------
// Main VU loop
// ---------------------------------------------------------------------------
export default function () {
  const s = pickScenario();

  // New-visitor behavior: drop this VU's cookies for the target before the hit.
  if (FRESH_SESSION) http.cookieJar().clear(s.url);

  // Decide hit vs miss for THIS request using the page's cache_hit_pct.
  const wantHit = Math.random() * 100 < s.cacheHit;

  let url = s.url;
  if (!wantHit) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}${BUST_KEY}=${bustToken()}`;
  }

  const cacheTag = wantHit ? 'hit' : 'miss';
  const tags = { page: s.name, cache: cacheTag };

  const headers = { 'User-Agent': 'k6/MagentoFPCLoadTest/2.0' };
  if (DEBUG_HEADER) headers['X-Magento-Debug'] = '1';

  const res = http.get(url, { headers, tags });

  // ---- record ----
  requests.add(1, tags);
  respTime.add(res.timings.duration, tags);
  ttfb.add(res.timings.waiting, tags);
  // status 0 = network error / timeout (no HTTP response at all)
  errors.add(res.status === 0 || res.status >= 400, { page: s.name });

  // ---- verify actual cache result from the edge ----
  const age = num(res.headers['Age'], 0);
  const dbg = String(
    res.headers['X-Magento-Cache-Debug'] || res.headers['X-Cache'] || ''
  ).toUpperCase();
  let actualHit;
  if (dbg.includes('HIT')) actualHit = true;
  else if (dbg.includes('MISS')) actualHit = false;
  else actualHit = age > 0; // fallback: Varnish/Fastly set Age>0 on hits

  actualHitRate.add(actualHit, { page: s.name });
  expectMismatch.add(wantHit !== actualHit, { page: s.name, cache: cacheTag });

  check(res, {
    'status is 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
  }, tags);

  if (res.status === 0 || res.status >= 400) {
    console.error(`${res.status} ${cacheTag} ${s.name} ${url} (${res.timings.duration}ms)`);
  }

  if (SLEEP > 0) sleep(SLEEP);
}

// ---------------------------------------------------------------------------
// Report: stdout + machine-readable summary.json
// ---------------------------------------------------------------------------
export function handleSummary(data) {
  const out = {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
  if (String(__ENV.SUMMARY_JSON || 'true').toLowerCase() === 'true') {
    out['summary.json'] = JSON.stringify(data, null, 2);
  }
  return out;
}
