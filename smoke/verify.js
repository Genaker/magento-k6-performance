// Checks what the mock server actually received against what magento.js was
// asked to send. Exits 1 on any failure.
//
//   node smoke/verify.js mix      <base> <csv> <terms> <expectedPages> [platform]
//   node smoke/verify.js bust     <base> <path> <expectedTotal>   (FPC=OFF)
//   node smoke/verify.js cache    <base> <path> <expectedTotal>   (FPC=ON)
//   node smoke/verify.js calls-magento  <base> <expectedPages>
//   node smoke/verify.js calls-headless <base> <expectedPages>
import { readFileSync } from 'node:fs';
import { parseCsv } from '../lib/csv.js';
import { normalizeScenarios } from '../lib/scenarios.js';
import { parseTerms } from '../lib/template.js';
import { pageKey, isCacheable } from './key.js';

const [mode, base, ...rest] = process.argv.slice(2);
const failures = [];
const expect = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};
const empty = { total: 0, busted: 0, bustValues: 0, hits: 0, misses: 0, unbustedHits: 0, unbustedMisses: 0 };
const sum = (list) => list.reduce((acc, p) => {
  for (const k of Object.keys(empty)) acc[k] += p[k];
  return acc;
}, { ...empty });
const pct = (x) => `${(x * 100).toFixed(1)}%`;

const stats = await (await fetch(`${base}/__stats`)).json();
const pagesBusted = Object.values(stats.pages).reduce((n, p) => n + p.busted, 0);

/** Stats for one scenario; a {term} row is the sum over every term's page key. */
function statsFor(s) {
  if (!s.url.includes('{term}')) {
    const key = pageKey(new URL(s.url));
    return { keys: [key], p: stats.pages[key] || empty, u: new URL(s.url) };
  }
  const u = new URL(s.url.replace('{term}', 'x'));
  const keys = Object.keys(stats.pages).filter((k) => k.startsWith(`${u.pathname}?`));
  return { keys, p: sum(keys.map((k) => stats.pages[k])), u, terms: keys.length };
}

if (mode === 'mix') {
  const [csv, termsFile, expectedRaw, platform] = rest;
  const scenarios = normalizeScenarios(parseCsv(readFileSync(csv, 'utf8')), { baseUrl: base, platform });
  const terms = parseTerms(readFileSync(termsFile, 'utf8'));
  const N = stats.total;
  expect(N === Number(expectedRaw), `total page requests ${N} === ${expectedRaw}`);
  const known = new Set();
  for (const s of scenarios) {
    const { keys, p, u, terms: termKeys } = statsFor(s);
    keys.forEach((k) => known.add(k));

    const share = p.total / N;
    const tolShare = 4 * Math.sqrt((s.share * (1 - s.share)) / N) + 0.01;
    expect(Math.abs(share - s.share) <= tolShare, `${s.name}: traffic ${pct(share)} ≈ ${pct(s.share)} (±${pct(tolShare)})`);

    const wantBust = 1 - s.cacheHit / 100;
    const busted = p.total ? p.busted / p.total : 0;
    const tolBust = 4 * Math.sqrt((wantBust * (1 - wantBust)) / Math.max(p.total, 1)) + 0.02;
    expect(Math.abs(busted - wantBust) <= tolBust, `${s.name}: busted ${pct(busted)} ≈ ${pct(wantBust)} (±${pct(tolBust)})`);
    expect(p.bustValues === p.busted, `${s.name}: every cache-buster token unique (${p.bustValues}/${p.busted})`);

    if (termKeys !== undefined) {
      expect(termKeys >= 1 && termKeys <= terms.length * 1, `${s.name}: spread over ${termKeys} search term(s) from the pool of ${terms.length}`);
    }
    if (isCacheable(u) && p.total - p.busted > 0) {
      const maxCold = termKeys !== undefined ? termKeys : 1;
      expect(p.unbustedMisses <= maxCold, `${s.name}: bare URL missed only on cold cache (misses=${p.unbustedMisses}, max ${maxCold})`);
    }
  }
  const unexpected = Object.keys(stats.pages).filter((k) => !known.has(k));
  expect(unexpected.length === 0, `no requests outside the CSV (${unexpected.join(', ') || 'none'})`);
} else if (mode === 'bust' || mode === 'cache') {
  const [path, expectedRaw] = rest;
  const key = pageKey(new URL(path, base));
  const p = stats.pages[key] || empty;
  expect(stats.total === Number(expectedRaw), `total requests ${stats.total} === ${expectedRaw}`);
  expect(Object.keys(stats.pages).length === 1, `only ${key} was requested`);
  if (mode === 'bust') {
    expect(p.busted === p.total, `every request busted (${p.busted}/${p.total})`);
    expect(p.bustValues === p.total, `every token unique (${p.bustValues}/${p.total})`);
    expect(p.hits === 0, `no cache hits (${p.hits})`);
  } else {
    expect(p.busted === 0, `no request busted (${p.busted})`);
    expect(p.misses === 1, `exactly one cold MISS (${p.misses})`);
    expect(p.hits === p.total - 1, `all others HIT (${p.hits}/${p.total - 1})`);
  }
  expect(stats.calls.banner.total + stats.calls.graphql.total === 0, 'no follow-up calls without a profile');
} else if (mode === 'calls-magento') {
  const [expectedRaw] = rest;
  const b = stats.calls.banner;
  expect(stats.total === Number(expectedRaw), `total page requests ${stats.total} === ${expectedRaw}`);
  expect(b.total === stats.total, `one banner AJAX call per page view (${b.total}/${stats.total})`);
  expect(b.noXhr === 0, `every call sent X-Requested-With (missing: ${b.noXhr})`);
  expect(b.busted === pagesBusted, `busted page views busted their call too (${b.busted}/${pagesBusted})`);
  expect(stats.calls.graphql.total === 0, `no GraphQL calls on this platform (${stats.calls.graphql.total})`);
} else if (mode === 'calls-headless') {
  const [expectedRaw] = rest;
  const g = stats.calls.graphql;
  const search = Object.entries(stats.pages).filter(([k]) => k.startsWith('/search?'));
  const searchTotal = search.reduce((n, [, p]) => n + p.total, 0);
  const searchBusted = search.reduce((n, [, p]) => n + p.busted, 0);
  expect(stats.total === Number(expectedRaw), `total page requests ${stats.total} === ${expectedRaw}`);
  expect(searchTotal > 0, `headless search route used (/search?q=...: ${searchTotal})`);
  expect(!Object.keys(stats.pages).some((k) => k.startsWith('/catalogsearch/')), 'Magento search route not used (url_headless override)');
  expect(g.total === 2 * searchTotal, `two GraphQL calls per search page view (${g.total} = 2 × ${searchTotal})`);
  expect(g.bySort.asc === searchTotal && g.bySort.desc === searchTotal, `one asc + one desc each (${JSON.stringify(g.bySort)})`);
  expect(g.busted === 2 * searchBusted, `busted searches busted both calls (${g.busted} = 2 × ${searchBusted})`);
  expect(stats.calls.banner.total === 0, `no banner AJAX on this platform (${stats.calls.banner.total})`);
} else {
  console.error(`unknown mode "${mode}"`);
  process.exit(2);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
