// Scenario (CSV row) normalization and weighted selection. Runtime-agnostic.
import { placeholders } from './template.js';

const ROW_PLACEHOLDERS = ['term'];

function parsePct(raw, field, line, allowOver100) {
  if (raw === undefined || String(raw).trim() === '') {
    throw new Error(`${line}: ${field} is required`);
  }
  const n = Number(raw);
  if (!isFinite(n) || n < 0 || (!allowOver100 && n > 100)) {
    const range = allowOver100 ? '>= 0' : 'between 0 and 100';
    throw new Error(`${line}: ${field} must be a number ${range} (got "${raw}")`);
  }
  return n;
}

function resolveUrl(raw, baseUrl, line) {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.charAt(0) === '/') {
    if (!baseUrl) {
      throw new Error(`${line}: relative url "${raw}" needs -e BASE_URL=https://your-site`);
    }
    return baseUrl.replace(/\/+$/, '') + raw;
  }
  throw new Error(`${line}: url must be absolute (https://...) or start with "/" (got "${raw}")`);
}

/** Column value with a per-platform override: `url_flux` beats `url` when platform=flux. */
function pick(r, col, platform) {
  if (platform) {
    const v = r[`${col}_${platform}`];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return (r[col] || '').trim();
}

/**
 * Validate parsed CSV rows and compute traffic weights.
 * Returns [{ name, type, url, expect, cacheHit, traffic, share, cum }], where
 * `share` is the normalized traffic share (0..1) and `cum` the cumulative
 * share (the last row's `cum` is exactly 1).
 *
 * - traffic_pct = 0 skips a row (switch a page off without deleting it)
 * - `<column>_<platform>` overrides `<column>` when opts.platform is set
 * - url "-" (e.g. url_flux = -) skips the row on that platform
 * - urls may use {term} (search terms); expect may use {term} too
 */
export function normalizeScenarios(rows, opts) {
  const baseUrl = opts && opts.baseUrl ? String(opts.baseUrl) : '';
  const platform = opts && opts.platform ? String(opts.platform) : '';
  const out = [];
  const seen = {};

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // "CSV line N" (real line when parsed by parseCsv) or "Plan pages[i] (name)"
    const line = r.__where || `CSV line ${r.__line || i + 2}`;
    const rawUrl = pick(r, 'url', platform);
    if (!rawUrl) {
      throw new Error(`${line}: url is required${platform ? ` (or url_${platform})` : ''}`);
    }

    const traffic = parsePct(r.traffic_pct, 'traffic_pct', line, true);
    const cacheHit = parsePct(r.cache_hit_pct, 'cache_hit_pct', line, false);
    if (traffic === 0 || rawUrl === '-') continue;

    const bad = placeholders(rawUrl).filter(function (n) { return ROW_PLACEHOLDERS.indexOf(n) === -1; });
    if (bad.length) throw new Error(`${line}: unknown placeholder {${bad[0]}} in url (allowed: {term})`);

    const url = resolveUrl(rawUrl, baseUrl, line);
    const name = (r.name || '').trim() || rawUrl;
    if (seen[name]) {
      throw new Error(`${line}: duplicate name "${name}" (metrics are tagged by name)`);
    }
    seen[name] = true;
    const type = (r.type || '').trim().toLowerCase() || 'page';
    if (!/^[a-z0-9_-]+$/.test(type)) throw new Error(`${line}: type must be a simple word (got "${type}")`);

    out.push({
      name: name,
      type: type,
      url: url,
      expect: pick(r, 'expect', platform),
      cacheHit: cacheHit,
      traffic: traffic,
    });
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

/** True if any scenario url or expect uses the given placeholder. */
export function scenariosUse(scenarios, name) {
  for (let i = 0; i < scenarios.length; i++) {
    if (placeholders(scenarios[i].url).indexOf(name) !== -1) return true;
    if (placeholders(scenarios[i].expect).indexOf(name) !== -1) return true;
  }
  return false;
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
