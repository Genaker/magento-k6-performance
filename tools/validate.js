#!/usr/bin/env node
// Pre-flight check for a scenario plan or CSV against a real site, before a load test:
// every row is requested once as a cache hit (bare URL) and once busted, plus
// the platform's follow-up calls, and each response must be 2xx/3xx and
// contain its `expect` text. Uses the same lib/ code as magento.js, so it
// sends exactly what k6 will send.
//
//   node tools/validate.js --plan plans/sample-data.yml --site flux [--sites plans/local/my-sites.yml]
//   node tools/validate.js --csv pages.csv --base https://site \
//     [--platform flux --profile platforms.json] [--terms search-terms.txt] [--api-base https://graphql-host]
//   common: [--all-terms] [--concurrency 4] [--timeout 45000]
//
// Options also read the k6 env names (PLAN, SITE, SITES, CSV, BASE_URL,
// PLATFORM, PROFILE, TERMS, API_BASE, BUST_KEY); --base/--api-base override a
// plan's site. The format is handled by the same lib/sources adapters k6 uses.
// Exit code 1 if anything fails.
import { readFileSync } from 'node:fs';
import { scenariosUse } from '../lib/scenarios.js';
import { buildPageView, validatePlan } from '../lib/pageview.js';
import { isErrorStatus } from '../lib/cache.js';
import { parseConfig } from '../lib/config.js';
import { openSource } from '../lib/sources/index.js';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const a = args(process.argv.slice(2));
// Same precedence as k6: source (plan/site) values, then env, then flags.
const ENV_KEYS = ['PLAN', 'SITE', 'SITES', 'CSV', 'BASE_URL', 'PLATFORM', 'PROFILE', 'TERMS', 'API_BASE', 'BUST_KEY'];
const FLAGS = { plan: 'PLAN', site: 'SITE', sites: 'SITES', csv: 'CSV', base: 'BASE_URL', platform: 'PLATFORM', profile: 'PROFILE', terms: 'TERMS', 'api-base': 'API_BASE' };
const env = {};
for (const k of ENV_KEYS) if (process.env[k]) env[k] = process.env[k];
for (const f in FLAGS) if (typeof a[f] === 'string') env[FLAGS[f]] = a[f];
if (!env.PLAN && !env.CSV) {
  console.error('usage: node tools/validate.js --plan <plan.yml> --site <name> [--sites <sites.yml>] [--all-terms]\n' +
    '   or: node tools/validate.js --csv <file> --base <https://site> [--platform p --profile f] [--terms f] [--api-base url] [--all-terms]');
  process.exit(2);
}
const source = openSource(env, (p) => readFileSync(p, 'utf8'));
const cfg = parseConfig(source.env);
const opt = {
  base: cfg.baseUrl,
  platform: cfg.platform,
  apiBase: cfg.apiBase,
  bustKey: cfg.bustKey,
  allTerms: Boolean(a['all-terms']),
  concurrency: Number(a.concurrency || 4),
  timeout: Number(a.timeout || 45000), // milliseconds
};

const scenarios = source.scenarios({ ...cfg, cacheHit: undefined }); // validate always sends hit + miss
const terms = source.terms(cfg);
const calls = source.calls(cfg);
validatePlan(scenarios, { terms, bustKey: opt.bustKey, calls, baseUrl: opt.base, apiBase: opt.apiBase });

// Build the request plan: hit + miss for each row; for {term} rows every term (--all-terms) or the first one.
const requests = [];
for (const s of scenarios) {
  const usesTerm = scenariosUse([s], 'term');
  const rowTerms = usesTerm ? (opt.allTerms ? terms : terms.slice(0, 1)) : [undefined];
  for (const term of rowTerms) {
    for (const wantHit of [true, false]) {
      if (usesTerm && opt.allTerms && !wantHit && term !== terms[0]) continue; // busted once is enough
      const view = buildPageView(s, {
        wantHit, term, bustKey: opt.bustKey, bustToken: `validate-${Date.now()}`, now: Date.now(),
        calls, baseUrl: opt.base, apiBase: opt.apiBase,
      });
      requests.push({ s, term, wantHit, view });
    }
  }
}

const headers = { 'User-Agent': 'k6/MagentoLoadTest/2.0 (validate)', 'X-Magento-Debug': '1' };
async function get(url, expect, extraHeaders) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { ...headers, ...(extraHeaders || {}) }, signal: AbortSignal.timeout(opt.timeout) });
      const body = await r.text();
      const failed = isErrorStatus(r.status);
      const missing = !failed && expect !== '' && !body.includes(expect);
      return { status: r.status, ms: Date.now() - t0, ok: !failed && !missing, missing, retried: attempt > 1 };
    } catch (e) {
      if (attempt === 2) return { status: 0, ms: Date.now() - t0, ok: false, error: (e.cause && e.cause.code) || e.message, retried: true };
    }
  }
}

async function runItem(item) {
  const page = await get(item.view.url, item.view.expect);
  const callResults = page.ok ? await Promise.all(item.view.calls.map((c) => get(c.url, c.expect, c.headers).then((r) => ({ c, r })))) : [];
  return { item, page, callResults };
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: opt.concurrency }, async () => {
  while (next < requests.length) {
    const item = requests[next++];
    results.push(await runItem(item));
  }
}));
results.sort((x, y) => requests.indexOf(x.item) - requests.indexOf(y.item));

let failures = 0;
let flaky = 0;
const fmt = (r) => r.error ? `ERR ${r.error}` : `${r.status}${r.missing ? ' (missing expected text)' : ''} ${r.ms}ms${r.retried ? ' [retried]' : ''}`;
console.log(`Validating ${source.label(cfg, scenarios.length)} on ${opt.base || '(absolute urls)'}${opt.platform ? ` as ${opt.platform}` : ''}: ${requests.length} page views\n`);
for (const { item, page, callResults } of results) {
  const label = `${item.s.name}${item.term !== undefined ? ` [${item.term}]` : ''} ${item.wantHit ? 'hit ' : 'miss'}`;
  const callBad = callResults.filter(({ r }) => !r.ok);
  const ok = page.ok && callBad.length === 0;
  if (!ok) failures++;
  if (page.retried && page.ok) flaky++;
  const callSummary = callResults.length ? `  +${callResults.length} call(s)${callBad.length ? ' FAILED: ' + callBad.map(({ c, r }) => `${c.name} ${fmt(r)}`).join('; ') : ' ok'}` : '';
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label.padEnd(44)} ${fmt(page)}${callSummary}`);
  if (!page.ok) console.log(`         ${item.view.url}${item.view.expect ? `  expect="${item.view.expect}"` : ''}`);
}
console.log(`\n${results.length - failures}/${results.length} page views ok${flaky ? `, ${flaky} needed a retry (network flake)` : ''}`);
process.exit(failures ? 1 : 0);
