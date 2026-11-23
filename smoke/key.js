// Shared by the mock server and the verifier (Node only).
export const BUST_KEY = 'fpc';

// Paths Magento never caches (customer-specific). The mock always MISSes them.
export const UNCACHEABLE_PREFIXES = ['/checkout/', '/customer/'];

/** Page key: path + query without the cache-buster param. */
export function pageKey(u) {
  const params = new URLSearchParams(u.search);
  params.delete(BUST_KEY);
  const q = params.toString();
  return u.pathname + (q ? `?${q}` : '');
}

export function isCacheable(u) {
  return !UNCACHEABLE_PREFIXES.some((p) => u.pathname.startsWith(p));
}
