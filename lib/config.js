// Config parsing for magento.js. Runtime-agnostic (k6 + Node unit tests).
import { envGet, isTrue } from './env.js';

/**
 * Parse and validate settings from the k6 environment. Two modes:
 *   single  -e URL=https://site/page   one page; FPC=ON => always cached,
 *                                      FPC=OFF (default) => always busted
 *   csv     -e CSV=scenarios.csv       weighted page mix, per-page hit ratio
 * Throws a descriptive Error on bad input instead of silently defaulting.
 */
export function parseConfig(env) {
  const url = envGet(env, 'URL');
  const csv = envGet(env, 'CSV');
  if (url && csv) {
    throw new Error('Use either URL (single page) or CSV (page mix), not both');
  }
  if (!url && !csv) {
    throw new Error(
      'Missing target: -e URL=https://example.com/ (single page) or -e CSV=scenarios.csv (page mix)'
    );
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

  return {
    mode: url ? 'single' : 'csv',
    url: url,
    csv: csv,
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
    url: cfg.url,
    cacheHit: cfg.fpcEnabled ? 100 : 0,
    traffic: 100,
    share: 1,
    cum: 1,
  }];
}
