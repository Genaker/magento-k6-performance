// Config parsing for magento.js. Runtime-agnostic (k6 + Node unit tests).
import { envGet, isTrue } from './env.js';

/**
 * Parse and validate settings from the k6 environment. Three modes:
 *   single  -e URL=https://site/page   one page; FPC=ON => always cached,
 *                                      FPC=OFF (default) => always busted
 *   csv     -e CSV=scenarios.csv       weighted page mix, per-page hit ratio
 *   plan    -e PLAN=plans/x.yml        YAML plan: sites, settings, sub-requests, pages
 *           (pass planEnv(plan, __ENV) as `env` so plan settings are included)
 * Throws a descriptive Error on bad input instead of silently defaulting.
 */
export function parseConfig(env) {
  const url = envGet(env, 'URL');
  const csv = envGet(env, 'CSV');
  const plan = envGet(env, 'PLAN');
  const targets = [url, csv, plan].filter(function (x) { return x; }).length;
  if (targets > 1) {
    throw new Error('Use only one of URL (single page), CSV (page mix) or PLAN (YAML plan)');
  }
  if (targets === 0) {
    throw new Error(
      'Missing target: -e PLAN=plans/sample-data.yml (YAML plan), -e CSV=scenarios.csv (page mix) ' +
      'or -e URL=https://example.com/ (single page)'
    );
  }
  if (plan && envGet(env, 'PROFILE')) {
    throw new Error('PROFILE is for CSV mode; a plan defines sub-requests in its own "platforms" section');
  }
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error(`URL must start with http:// or https:// (got "${url}")`);
  }

  let n = 1;
  const nRaw = envGet(env, 'N');
  if (nRaw !== undefined) {
    if (!/^\d+$/.test(nRaw.trim()) || Number(nRaw) < 1) {
      throw new Error(`Parameter N must be a positive integer (got "${nRaw}")`);
    }
    n = Number(nRaw);
  }

  let sleep = 0;
  const sleepRaw = envGet(env, 'SLEEP');
  if (sleepRaw !== undefined) {
    sleep = Number(sleepRaw);
    if (!isFinite(sleep) || sleep < 0) {
      throw new Error(`Parameter SLEEP must be a non-negative number of seconds (got "${sleepRaw}")`);
    }
  }

  const bustKey = envGet(env, 'BUST_KEY') || 'fpc';
  if (!/^[A-Za-z0-9_.-]+$/.test(bustKey)) {
    throw new Error(`BUST_KEY may only contain letters, digits, "_", "." or "-" (got "${bustKey}")`);
  }

  const debugRaw = envGet(env, 'DEBUG_HEADER');

  // CACHE_HIT overrides cache_hit for every page: CACHE_HIT=0 busts every
  // request (all uncached, full PHP / Next.js render) to load the CPU.
  let cacheHit;
  const cacheHitRaw = envGet(env, 'CACHE_HIT');
  if (cacheHitRaw !== undefined) {
    cacheHit = Number(cacheHitRaw);
    if (!isFinite(cacheHit) || cacheHit < 0 || cacheHit > 100) {
      throw new Error(`CACHE_HIT must be a number between 0 and 100 (got "${cacheHitRaw}")`);
    }
  }

  const platform = envGet(env, 'PLATFORM');
  // A variant like "flux.min" uses its own sub-requests (platforms["flux.min"])
  // and falls back to "flux" for url/expect overrides.
  if (platform !== undefined && !/^[a-z0-9_-]+(\.[a-z0-9_-]+)?$/.test(platform)) {
    throw new Error(`PLATFORM must be a lowercase word like luma, hyva, flux or a variant like flux.min (got "${platform}")`);
  }
  const profile = envGet(env, 'PROFILE');
  if (profile && !platform) {
    throw new Error('PROFILE needs -e PLATFORM=<name> to pick the platform section');
  }

  return {
    platform: platform,
    profile: profile,
    terms: envGet(env, 'TERMS'),
    cacheHit: cacheHit,
    apiBase: envGet(env, 'API_BASE'),
    mode: url ? 'single' : csv ? 'csv' : 'plan',
    url: url,
    csv: csv,
    plan: plan,
    site: envGet(env, 'SITE'),
    baseUrl: envGet(env, 'BASE_URL'),
    method: (envGet(env, 'METHOD') || 'GET').toUpperCase(),
    n: n,
    sleep: sleep,
    fpcEnabled: (envGet(env, 'FPC') || 'OFF').toUpperCase() === 'ON',
    bustKey: bustKey,
    debugHeader: debugRaw === undefined ? true : isTrue(debugRaw),
    freshSession: isTrue(envGet(env, 'FRESH_SESSION')),
    verbose: isTrue(envGet(env, 'VERBOSE')),
  };
}

/** Single-URL mode expressed as a one-row scenario list (same shape as CSV mode). */
export function singleScenario(cfg) {
  return [{
    name: cfg.url,
    type: 'page',
    url: cfg.url,
    expect: '',
    cacheHit: cfg.fpcEnabled ? 100 : 0,
    traffic: 100,
    share: 1,
    cum: 1,
  }];
}
