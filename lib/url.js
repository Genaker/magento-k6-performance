// URL helpers for FPC cache busting. Runtime-agnostic (k6 has no global URL
// class, so this works on plain strings).

/**
 * Append `key=value` to a URL's query string, keeping any #fragment at the end.
 * Appending after a '#' would never reach the server, so the cache would not
 * actually be busted.
 */
export function appendQueryParam(url, key, value) {
  const hashIdx = url.indexOf('#');
  const base = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : url.slice(hashIdx);
  let sep = '?';
  if (base.indexOf('?') !== -1) {
    const last = base.charAt(base.length - 1);
    sep = last === '?' || last === '&' ? '' : '&';
  }
  return base + sep + encodeURIComponent(key) + '=' + encodeURIComponent(value) + hash;
}

/**
 * Unique cache-buster token. `seq` separates multiple requests inside one VU
 * iteration (magento.js N>1), which would otherwise share VU+ITER+ms.
 */
export function makeBustToken(vu, iter, seq, now, rand) {
  const t = now === undefined ? Date.now() : now;
  const r = rand === undefined ? Math.random() : rand;
  return [vu, iter, seq || 0, t, r.toString(36).slice(2, 8)].join('-');
}
