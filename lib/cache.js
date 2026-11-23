// Response classification. Runtime-agnostic.

/** Case-insensitive header lookup (k6 canonicalizes names, mocks may not). */
export function headerValue(headers, name) {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const k in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, k) && k.toLowerCase() === want) {
      return String(headers[k]);
    }
  }
  return undefined;
}

/**
 * Was this response served from cache?
 * Checks, in order: X-Magento-Cache-Debug (Magento/Varnish, needs the debug
 * ACL), X-Cache (Fastly/CDNs; "MISS, HIT" from a shield chain counts as a hit
 * since the origin did not render it), CF-Cache-Status (Cloudflare), then falls
 * back to Age > 0. Note Varnish reports Age: 0 for a hit in the first second
 * after the object was stored, so the fallback undercounts hits on a cold cache.
 */
export function detectCacheHit(headers) {
  const sources = ['X-Magento-Cache-Debug', 'X-Cache', 'CF-Cache-Status'];
  for (let i = 0; i < sources.length; i++) {
    const v = headerValue(headers, sources[i]);
    if (v === undefined || v.trim() === '') continue;
    const up = v.toUpperCase();
    if (up.indexOf('HIT') !== -1) return { hit: true, source: sources[i] };
    if (up.indexOf('MISS') !== -1) return { hit: false, source: sources[i] };
  }
  const age = Number(headerValue(headers, 'Age'));
  return { hit: isFinite(age) && age > 0, source: 'Age' };
}

/** Network error/timeout (status 0) or HTTP 4xx/5xx. 2xx and 3xx are fine. */
export function isErrorStatus(status) {
  return status === 0 || status >= 400;
}
