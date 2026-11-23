// Tiny Magento + Varnish FPC stand-in for smoke tests (Node, no dependencies).
//
// - Cache key is the FULL url (path + query), like Varnish, so ?fpc=<token>
//   is a new key => MISS. The first request for a key stores it (request
//   coalescing), so a warm key is exactly one MISS then HITs.
// - /checkout/* and /customer/* are never cached.
// - Sends Age, and X-Magento-Cache-Debug: HIT|MISS when X-Magento-Debug is set.
// - MISS responses are delayed (MISS_DELAY_MS) to mimic a PHP render.
// - GET /__stats returns per-page counters, POST /__reset clears everything.
import http from 'node:http';
import { BUST_KEY, pageKey, isCacheable } from './key.js';

const PORT = Number(process.env.PORT || 18080);
const MISS_DELAY_MS = Number(process.env.MISS_DELAY_MS || 15);

let cache;
let stats;
function reset() {
  cache = new Map();
  stats = { total: 0, pages: {} };
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
  return JSON.stringify({ total: stats.total, pages }, null, 2);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://mock.local');

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

  const body = `<!doctype html><title>mock</title><p>${key}</p>`;
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
