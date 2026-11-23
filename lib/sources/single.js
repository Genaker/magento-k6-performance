// Single-URL source adapter (-e URL=https://site/page): one page, always a
// cache hit (FPC=ON) or always busted (FPC=OFF, default). No sub-requests.
// Runtime-agnostic.
import { envGet } from '../env.js';

/** Single-URL mode as a one-row scenario list (the common scenario shape). */
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

export const singleSource = {
  kind: 'single',
  claims: function (env) { return Boolean(envGet(env, 'URL')); },
  open: function (env) {
    if (envGet(env, 'PROFILE')) {
      throw new Error('PROFILE needs a page mix: use it with -e CSV=..., not -e URL=...');
    }
    return {
      env: env,
      scenarios: function (cfg) { return singleScenario(cfg); },
      profile: function () { return null; },
      terms: function () { return []; },
      label: function (cfg) { return cfg.url; },
    };
  },
};
