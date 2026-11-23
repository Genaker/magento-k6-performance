// Build one "page view": the page request plus the follow-up calls the
// platform's browser makes (AJAX / GraphQL). Pure function, runtime-agnostic.
import { fillTemplate, encodeTerm } from './template.js';
import { appendQueryParam } from './url.js';
import { callsFor } from './platform.js';

function originOf(url) {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return m ? m[1] : '';
}

/**
 * @param s    scenario row ({ url, expect, type })
 * @param ctx  { wantHit, term, bustKey, bustToken, now, calls, baseUrl, apiBase }
 * @returns    { url, expect, calls: [{ name, url, expect, headers }] }
 *
 * A planned cache MISS busts the page AND its follow-up calls, so a "cold"
 * page view is cold end to end (e.g. Flux's GraphQL search is busted too).
 * Relative call URLs resolve against BASE_URL, else the page's origin.
 */
export function buildPageView(s, ctx) {
  const termEnc = ctx.term === undefined ? undefined : encodeTerm(ctx.term);
  let url = fillTemplate(s.url, { term: termEnc });
  if (!ctx.wantHit) url = appendQueryParam(url, ctx.bustKey, ctx.bustToken);
  const expect = s.expect ? fillTemplate(s.expect, { term: ctx.term }) : '';

  const base = ctx.baseUrl ? String(ctx.baseUrl).replace(/\/+$/, '') : originOf(url);
  const vars = {
    term: termEnc,
    page_url: encodeURIComponent(url),
    ts: String(ctx.now),
    api_base: ctx.apiBase ? String(ctx.apiBase).replace(/\/+$/, '') : undefined,
    base_url: base,
  };

  const calls = callsFor(ctx.calls, s.type).map(function (c) {
    let u = fillTemplate(c.url, vars);
    if (u.charAt(0) === '/') u = base + u;
    if (!ctx.wantHit) u = appendQueryParam(u, ctx.bustKey, ctx.bustToken);
    return {
      name: c.name,
      url: u,
      expect: c.expect ? fillTemplate(c.expect, { term: ctx.term }) : '',
      headers: c.headers || {},
    };
  });

  return { url: url, expect: expect, calls: calls };
}

/**
 * Fail fast at startup: build every scenario once (hit and miss) with sample
 * values, so a bad template or a missing TERMS / API_BASE stops the run
 * before any load is generated.
 */
export function validatePlan(scenarios, ctx) {
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    for (let h = 0; h < 2; h++) {
      try {
        buildPageView(s, {
          wantHit: h === 0,
          term: ctx.terms && ctx.terms.length ? ctx.terms[0] : undefined,
          bustKey: ctx.bustKey,
          bustToken: 'validate',
          now: 0,
          calls: ctx.calls,
          baseUrl: ctx.baseUrl,
          apiBase: ctx.apiBase,
        });
      } catch (e) {
        let hint = '';
        if (/\{term\}/.test(e.message)) hint = ' - set -e TERMS=path/to/search-terms.txt';
        if (/\{api_base\}/.test(e.message)) hint = ' - set -e API_BASE=https://your-graphql-host';
        throw new Error(`Scenario "${s.name}": ${e.message}${hint}`);
      }
    }
  }
}
