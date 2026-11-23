// YAML (or JSON) test plans: one file with sites, load settings, thresholds,
// per-platform browser sub-requests and the page mix. A plan compiles to the
// same pieces the CSV mode uses (env-style settings, scenario rows, platform
// calls), so both share one tested code path. Runtime-agnostic.
import { load as yamlLoad } from './vendor/js-yaml.js';
import { parseTerms } from './template.js';

const TOP_KEYS = ['name', 'description', 'sites', 'load', 'thresholds', 'options', 'search_terms', 'search_terms_file', 'platforms', 'pages'];
const SITE_KEYS = ['base_url', 'api_base', 'platform'];
const LOAD_KEYS = ['mode', 'vus', 'rps', 'max_vus', 'duration', 'ramp', 'rampdown', 'iterations', 'max_duration', 'sleep', 'n', 'stages', 'start_rps'];
const THRESHOLD_KEYS = ['t_p95', 't_hit', 't_miss', 'max_error_rate', 'max_api_error_rate', 'max_mismatch', 'abort_on_fail'];
const OPTION_KEYS = ['method', 'bust_key', 'debug_header', 'fresh_session', 'verbose', 'cache_hit'];
const PAGE_KEYS = ['name', 'type', 'url', 'expect', 'cache_hit', 'traffic'];

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkKeys(obj, allowed, where) {
  if (!isObject(obj)) throw new Error(`Plan: ${where} must be a mapping`);
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && allowed.indexOf(k) === -1) {
      throw new Error(`Plan: unknown key "${k}" in ${where} (allowed: ${allowed.join(', ')})`);
    }
  }
}

function validateSites(sites, where) {
  if (!isObject(sites) || Object.keys(sites).length === 0) throw new Error(`Plan: ${where} must be a non-empty mapping`);
  for (const s in sites) {
    if (!Object.prototype.hasOwnProperty.call(sites, s)) continue;
    checkKeys(sites[s], SITE_KEYS, `${where}.${s}`);
    if (!sites[s].base_url) throw new Error(`Plan: ${where}.${s}.base_url is required`);
    if (!/^https?:\/\//i.test(String(sites[s].base_url))) {
      throw new Error(`Plan: ${where}.${s}.base_url must start with http(s):// (got "${sites[s].base_url}")`);
    }
  }
}

/**
 * Replace the plan's sites with a separate sites file (-e SITES=...), so a
 * shared plan can point at private hosts kept out of version control.
 * The file holds `sites: {...}` (or just the site mapping).
 */
export function applySitesText(plan, text, path) {
  let parsed;
  try {
    parsed = yamlLoad(String(text));
  } catch (e) {
    throw new Error(`Sites file ${path || ''}: invalid YAML - ${e.message.split('\n')[0]}`);
  }
  const sites = isObject(parsed) && isObject(parsed.sites) ? parsed.sites : parsed;
  validateSites(sites, `sites (${path || 'SITES file'})`);
  const out = {};
  for (const k in plan) if (Object.prototype.hasOwnProperty.call(plan, k)) out[k] = plan[k];
  out.sites = sites;
  return out;
}

/** Parse plan text (YAML; JSON is valid YAML too) into a validated object. */
export function parsePlanText(text, path) {
  let plan;
  try {
    plan = yamlLoad(String(text));
  } catch (e) {
    throw new Error(`Plan ${path || ''}: invalid YAML - ${e.message.split('\n')[0]}`);
  }
  checkKeys(plan, TOP_KEYS, 'the top level');
  if (!Array.isArray(plan.pages) || plan.pages.length === 0) throw new Error('Plan: "pages" must be a non-empty list');
  for (let i = 0; i < plan.pages.length; i++) {
    const p = plan.pages[i];
    checkKeys(p, PAGE_KEYS, `pages[${i}]${p && p.name ? ` (${p.name})` : ''}`);
  }
  if (plan.sites !== undefined) validateSites(plan.sites, 'sites');
  if (plan.load !== undefined) checkKeys(plan.load, LOAD_KEYS, 'load');
  if (plan.thresholds !== undefined) checkKeys(plan.thresholds, THRESHOLD_KEYS, 'thresholds');
  if (plan.options !== undefined) checkKeys(plan.options, OPTION_KEYS, 'options');
  if (plan.platforms !== undefined && !isObject(plan.platforms)) throw new Error('Plan: "platforms" must be a mapping');
  if (plan.search_terms !== undefined && !Array.isArray(plan.search_terms)) throw new Error('Plan: "search_terms" must be a list');
  if (plan.search_terms !== undefined && plan.search_terms_file !== undefined) {
    throw new Error('Plan: use either search_terms or search_terms_file, not both');
  }
  return plan;
}

/**
 * Env-style settings for the rest of the code: plan values first, then the
 * real -e values on top (so `-e VUS=5` overrides `load.vus`). SITE picks the
 * site; it may be omitted when the plan has exactly one.
 */
export function planEnv(plan, env) {
  const out = {};
  const groups = [plan.load, plan.thresholds, plan.options];
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g] || {};
    for (const k in group) {
      if (Object.prototype.hasOwnProperty.call(group, k) && group[k] !== null && group[k] !== undefined) {
        out[k.toUpperCase()] = String(group[k]);
      }
    }
  }

  let site = env.SITE || env.site;
  if (plan.sites) {
    const names = Object.keys(plan.sites);
    if (!site && names.length === 1) site = names[0];
    if (!site) throw new Error(`Plan has several sites: pick one with -e SITE=<${names.join('|')}>`);
    const s = plan.sites[site];
    if (!s) throw new Error(`Site "${site}" not in plan (have: ${names.join(', ')})`);
    out.BASE_URL = String(s.base_url);
    if (s.api_base) out.API_BASE = String(s.api_base);
    out.PLATFORM = String(s.platform || site);
    out.SITE = site;
  }

  for (const k in env) {
    if (!Object.prototype.hasOwnProperty.call(env, k)) continue;
    const v = env[k];
    if (v !== undefined && v !== null && String(v) !== '') out[k.toUpperCase()] = String(v);
  }
  return out;
}

/** `url: /x` or `url: {default: /x, flux: /y}` -> row columns url, url_flux. */
function spread(row, col, value, where) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' || typeof value === 'number') {
    row[col] = String(value);
    return;
  }
  if (!isObject(value)) throw new Error(`Plan: ${where}.${col} must be text or a mapping of platform: text`);
  for (const k in value) {
    if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
    row[k === 'default' ? col : `${col}_${k}`] = String(value[k]);
  }
}

/** Plan pages -> rows for normalizeScenarios (same shape as parsed CSV rows). */
export function planRows(plan) {
  return plan.pages.map(function (p, i) {
    const where = `pages[${i}]${p && p.name ? ` (${p.name})` : ''}`;
    checkKeys(p, PAGE_KEYS, where);
    const row = {
      name: p.name === undefined ? '' : String(p.name),
      type: p.type === undefined ? '' : String(p.type),
      cache_hit_pct: p.cache_hit === undefined ? '' : String(p.cache_hit),
      traffic_pct: p.traffic === undefined ? '' : String(p.traffic),
    };
    spread(row, 'url', p.url, where);
    spread(row, 'expect', p.expect, where);
    Object.defineProperty(row, '__where', { value: `Plan ${where}`, enumerable: false });
    return row;
  });
}

/** Platform calls section in the shape parsePlatformProfile expects, or null. */
export function planProfile(plan) {
  return plan.platforms ? { platforms: plan.platforms } : null;
}

/** Resolve `rel` against the directory of `base` (e.g. the plan file). */
export function resolveRelative(base, rel) {
  if (rel.charAt(0) === '/') return rel;
  const dir = base.lastIndexOf('/') === -1 ? '' : base.slice(0, base.lastIndexOf('/') + 1);
  const parts = (dir + rel).split('/');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '.' || (parts[i] === '' && i > 0)) continue;
    if (parts[i] === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(parts[i]);
  }
  return out.join('/');
}

/** Where the plan's search terms come from: { inline: [...] } | { file } | null. */
export function planTermsSource(plan, planPath) {
  if (plan.search_terms) return { inline: parseTerms(plan.search_terms.map(String).join('\n')) };
  if (plan.search_terms_file) return { file: resolveRelative(planPath || '', String(plan.search_terms_file)) };
  return null;
}
