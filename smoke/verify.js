// Checks what the mock server actually received against what magento.js was
// asked to send. Exits 1 on any failure.
//
//   node smoke/verify.js mix   <base> <csv> <expectedTotal>
//   node smoke/verify.js bust  <base> <path> <expectedTotal>   (FPC=OFF)
//   node smoke/verify.js cache <base> <path> <expectedTotal>   (FPC=ON)
import { readFileSync } from 'node:fs';
import { parseCsv } from '../lib/csv.js';
import { normalizeScenarios } from '../lib/scenarios.js';
import { pageKey, isCacheable } from './key.js';

const [mode, base, target, expectedRaw] = process.argv.slice(2);
const expectedTotal = Number(expectedRaw);
const failures = [];
const expect = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};
const empty = { total: 0, busted: 0, bustValues: 0, hits: 0, misses: 0, unbustedHits: 0, unbustedMisses: 0 };

const stats = await (await fetch(`${base}/__stats`)).json();
const pct = (x) => `${(x * 100).toFixed(1)}%`;

expect(stats.total === expectedTotal, `total requests ${stats.total} === ${expectedTotal}`);

if (mode === 'mix') {
  const scenarios = normalizeScenarios(parseCsv(readFileSync(target, 'utf8')), { baseUrl: base });
  const N = stats.total;
  const known = new Set();
  for (const s of scenarios) {
    const u = new URL(s.url);
    const key = pageKey(u);
    known.add(key);
    const p = stats.pages[key] || empty;

    // traffic share (4 sigma + 1pt slack: random, but practically never flaky)
    const share = p.total / N;
    const tolShare = 4 * Math.sqrt((s.share * (1 - s.share)) / N) + 0.01;
    expect(Math.abs(share - s.share) <= tolShare,
      `${s.name}: traffic ${pct(share)} ≈ ${pct(s.share)} (±${pct(tolShare)})`);

    // busted share = 1 - cache_hit_pct
    const wantBust = 1 - s.cacheHit / 100;
    const busted = p.total ? p.busted / p.total : 0;
    const tolBust = 4 * Math.sqrt((wantBust * (1 - wantBust)) / Math.max(p.total, 1)) + 0.02;
    expect(Math.abs(busted - wantBust) <= tolBust,
      `${s.name}: busted ${pct(busted)} ≈ ${pct(wantBust)} (±${pct(tolBust)})`);

    expect(p.bustValues === p.busted, `${s.name}: every cache-buster token unique (${p.bustValues}/${p.busted})`);

    if (isCacheable(u) && p.total - p.busted > 0) {
      expect(p.unbustedMisses <= 1, `${s.name}: bare URL missed only on cold cache (misses=${p.unbustedMisses})`);
    }
  }
  const unexpected = Object.keys(stats.pages).filter((k) => !known.has(k));
  expect(unexpected.length === 0, `no requests outside the CSV (${unexpected.join(', ') || 'none'})`);
} else if (mode === 'bust' || mode === 'cache') {
  const u = new URL(target, base);
  const key = pageKey(u);
  const p = stats.pages[key] || empty;
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
} else {
  console.error(`unknown mode "${mode}" (use mix, bust or cache)`);
  process.exit(2);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
