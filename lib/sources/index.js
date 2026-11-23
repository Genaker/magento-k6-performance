// Scenario sources: one adapter per input format, behind one interface, so
// magento.js and tools/validate.js never branch on the format.
//
//   yaml.js    -e PLAN=plans/x.yml   (+ SITES)          recommended
//   csv.js     -e CSV=pages.csv      (+ PROFILE, TERMS)
//   single.js  -e URL=https://...    (FPC=ON|OFF)
//
// An adapter is { kind, claims(env), open(env, readFile) } and open() returns:
//   env                 settings for parseConfig/buildOptions (a plan merges its
//                       own values under the real -e values)
//   rows()              raw page rows (common column shape: name, type, url,
//                       url_<platform>, expect, expect_<platform>, cache_hit_pct,
//                       traffic_pct); or scenarios(cfg) for ready-made scenarios
//   profile()           { platforms: {...} } sub-requests, or null
//   terms()             the source's own search terms ([] if none)
//   label(cfg, count)   short description for logs
//
// To add a format (e.g. JSON lines), write an adapter and list it in SOURCES.
// `readFile(path) -> string` is passed in: k6's open() (init context only)
// or Node's readFileSync. Runtime-agnostic.
import { parseConfig } from '../config.js';
import { normalizeScenarios } from '../scenarios.js';
import { parseTerms } from '../template.js';
import { parsePlatformProfile } from '../platform.js';
import { yamlSource } from './yaml.js';
import { csvSource } from './csv.js';
import { singleSource } from './single.js';

export const SOURCES = [yamlSource, csvSource, singleSource];

/**
 * Pick the adapter for `env` and open it. Returns the common source:
 * { kind, env, scenarios(cfg), calls(cfg), terms(cfg), label(cfg, count) }.
 * Methods that read files are lazy, so k6 can call them inside SharedArray.
 */
export function openSource(env, readFile) {
  const claimed = SOURCES.filter(function (s) { return s.claims(env); });
  if (claimed.length !== 1) {
    parseConfig(env); // throws the "missing target" / "use only one of" message
    throw new Error('Use exactly one of PLAN, CSV or URL');
  }
  const adapter = claimed[0];
  const src = adapter.open(env, readFile);
  return {
    kind: adapter.kind,
    env: src.env,
    /** Normalized, weighted scenarios (see lib/scenarios.js). */
    scenarios: function (cfg) {
      if (src.scenarios) return src.scenarios(cfg);
      return normalizeScenarios(src.rows(), { baseUrl: cfg.baseUrl, platform: cfg.platform, cacheHit: cfg.cacheHit });
    },
    /** Sub-requests for cfg.platform, or null (no platform / no profile). */
    calls: function (cfg) {
      if (!cfg.platform) return null;
      const profile = src.profile();
      return profile ? parsePlatformProfile(profile, cfg.platform) : null;
    },
    /** Search terms: -e TERMS=<file> wins over the source's own terms. */
    terms: function (cfg) {
      return cfg.terms ? parseTerms(readFile(cfg.terms)) : src.terms();
    },
    label: function (cfg, count) { return src.label(cfg, count); },
  };
}
