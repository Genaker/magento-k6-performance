// Scenario (CSV row) normalization and weighted selection for magento-load.js.
// Runtime-agnostic.

function parsePct(raw, field, line, allowOver100) {
  if (raw === undefined || String(raw).trim() === '') {
    throw new Error(`CSV line ${line}: ${field} is required`);
  }
  const n = Number(raw);
  if (!isFinite(n) || n < 0 || (!allowOver100 && n > 100)) {
    const range = allowOver100 ? '>= 0' : 'between 0 and 100';
    throw new Error(`CSV line ${line}: ${field} must be a number ${range} (got "${raw}")`);
  }
  return n;
}

function resolveUrl(raw, baseUrl, line) {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.charAt(0) === '/') {
    if (!baseUrl) {
      throw new Error(`CSV line ${line}: relative url "${raw}" needs -e BASE_URL=https://your-site`);
    }
    return baseUrl.replace(/\/+$/, '') + raw;
  }
  throw new Error(`CSV line ${line}: url must be absolute (https://...) or start with "/" (got "${raw}")`);
}

/**
 * Validate parsed CSV rows and compute traffic weights.
 * Returns [{ name, url, cacheHit, traffic, share, cum }] where `share` is the
 * normalized traffic share (0..1) and `cum` the cumulative share; the last
 * row's `cum` is exactly 1. Rows with traffic_pct = 0 are skipped (handy to
 * switch a page off without deleting it).
 */
export function normalizeScenarios(rows, opts) {
  const baseUrl = opts && opts.baseUrl ? String(opts.baseUrl) : '';
  const out = [];
  const seen = {};

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2; // +1 header, +1 one-based
    const rawUrl = (r.url || '').trim();
    if (!rawUrl) throw new Error(`CSV line ${line}: url is required`);

    const traffic = parsePct(r.traffic_pct, 'traffic_pct', line, true);
    const cacheHit = parsePct(r.cache_hit_pct, 'cache_hit_pct', line, false);
    if (traffic === 0) continue;

    const url = resolveUrl(rawUrl, baseUrl, line);
    const name = (r.name || '').trim() || rawUrl;
    if (seen[name]) {
      throw new Error(`CSV line ${line}: duplicate name "${name}" (metrics are tagged by name)`);
    }
    seen[name] = true;
    out.push({ name: name, url: url, cacheHit: cacheHit, traffic: traffic });
  }

  if (out.length === 0) throw new Error('CSV has no usable rows (need url and traffic_pct > 0)');

  let total = 0;
  for (let i = 0; i < out.length; i++) total += out[i].traffic;
  let acc = 0;
  for (let i = 0; i < out.length; i++) {
    out[i].share = out[i].traffic / total;
    acc += out[i].share;
    out[i].cum = acc;
  }
  out[out.length - 1].cum = 1; // guard against float drift
  return out;
}

/** Pick a scenario by cumulative weight. `r` is a uniform random in [0, 1). */
export function pickScenario(scenarios, r) {
  for (let i = 0; i < scenarios.length; i++) {
    if (r < scenarios[i].cum) return scenarios[i];
  }
  return scenarios[scenarios.length - 1];
}

/** true => request the bare URL (cache hit wanted); false => bust the cache. */
export function decideHit(cacheHitPct, r) {
  return r * 100 < cacheHitPct;
}
