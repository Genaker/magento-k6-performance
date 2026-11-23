// Tiny Magento + Varnish FPC stand-in for smoke tests (Node, no dependencies).
//
// Pages
// - Cache key is the FULL url (path + query), like Varnish, so ?fpc=<token>
//   is a new key => MISS. The first request for a key stores it (request
//   coalescing), so a warm key is exactly one MISS then HITs.
// - /checkout/* and /customer/* are never cached.
// - Sends Age, and X-Magento-Cache-Debug: HIT|MISS when X-Magento-Debug is set.
// - MISS responses are delayed (MISS_DELAY_MS) to mimic a PHP render.
// - Body contains "page=<path?query>" and "term:<q>" so `expect` can be checked.
//
// Browser follow-up calls (counted separately from pages)
// - /banner/ajax/load/  -> 400 unless X-Requested-With: XMLHttpRequest (like Magento)
// - /graphql?q=<term>   -> {"data":{"products":{"items":[...]}}}
//
// GET /__stats returns counters, POST /__reset clears everything.
import http from 'node:http';
import { BUST_KEY, pageKey, isCacheable } from './key.js';

const PORT = Number(process.env.PORT || 18080);
const MISS_DELAY_MS = Number(process.env.MISS_DELAY_MS || 15);

let cache;
let stats;
function reset() {
  cache = new Map();
  stats = {
    total: 0,
    pages: {},
    calls: {
      banner: { total: 0, busted: 0, noXhr: 0 },
      graphql: { total: 0, busted: 0, bySort: {} },
    },
  };
}
reset();

function pageStats(key) {
  if (!stats.pages[key]) {
    stats.pages[key] = { total: 0, busted: 0, bustValues: new Set(), hits: 0, misses: 0, unbustedHits: 0, unbustedMisses: 0 };
  }
  return stats.pages[key];
}

function serializeStats() {
  const pages = {};
  for (const [k, p] of Object.entries(stats.pages)) {
    pages[k] = { ...p, bustValues: p.bustValues.size };
  }
  return JSON.stringify({ total: stats.total, pages, calls: stats.calls }, null, 2);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://mock.local');
  const busted = u.searchParams.get(BUST_KEY) !== null;

  if (u.pathname === '/__stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(serializeStats());
    return;
  }
  if (u.pathname === '/__reset') {
    reset();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('reset');
    return;
  }
  if (u.pathname === '/banner/ajax/load/') {
    const b = stats.calls.banner;
    b.total++;
    if (busted) b.busted++;
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      b.noXhr++;
      json(res, 400, { error: 'not an AJAX request' });
      return;
    }
    json(res, 200, { data: { items: {} }, store_id: '1' });
    return;
  }
  if (u.pathname === '/graphql') {
    const g = stats.calls.graphql;
    g.total++;
    if (busted) g.busted++;
    const sort = u.searchParams.get('sort') || 'none';
    g.bySort[sort] = (g.bySort[sort] || 0) + 1;
    const q = u.searchParams.get('q') || '';
    const items = q && !q.startsWith('zzz') ? [{ name: `${q} product` }] : [];
    json(res, 200, { data: { products: { total_count: items.length, items } } });
    return;
  }

  const key = pageKey(u);
  const p = pageStats(key);
  const bust = u.searchParams.get(BUST_KEY);
  const cacheable = isCacheable(u);
  const cacheKey = u.pathname + u.search;

  const storedAt = cacheable ? cache.get(cacheKey) : undefined;
  const hit = storedAt !== undefined;
  if (!hit && cacheable) cache.set(cacheKey, Date.now());

  stats.total++;
  p.total++;
  if (bust !== null) {
    p.busted++;
    p.bustValues.add(bust);
  }
  if (hit) p.hits++;
  else p.misses++;
  if (bust === null) {
    if (hit) p.unbustedHits++;
    else p.unbustedMisses++;
  }

  const headers = {
    'Content-Type': 'text/html; charset=UTF-8',
    'Cache-Control': cacheable ? 'max-age=0, must-revalidate, no-cache, no-store' : 'no-store, no-cache',
    Age: hit ? String(Math.max(1, Math.floor((Date.now() - storedAt) / 1000))) : '0',
  };
  if (req.headers['x-magento-debug']) headers['X-Magento-Cache-Debug'] = hit ? 'HIT' : 'MISS';

  const term = u.searchParams.get('q');
  const body = `<!doctype html><title>mock</title><p>page=${key}</p>${term !== null ? `<p>term:${term}</p>` : ''}`;
  const send = () => {
    res.writeHead(200, headers);
    res.end(body);
  };
  if (hit) send();
  else setTimeout(send, MISS_DELAY_MS);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock magento listening on http://127.0.0.1:${PORT}`);
});
