// Environment helpers shared by the k6 scripts.
// Runtime-agnostic: no k6 or Node imports, plain ES2015+ so it runs in both
// k6 (Sobek) and Node (unit tests). Avoid ??, ?., ||= and Object.fromEntries.

/**
 * Read an env var by name, accepting the UPPERCASE name or its lowercase form
 * (`-e URL=` and `-e url=` both work). Empty strings count as unset.
 */
export function envGet(env, name) {
  const candidates = [name, name.toLowerCase()];
  for (let i = 0; i < candidates.length; i++) {
    const v = env[candidates[i]];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
  }
  return undefined;
}

/** "1", "true", "yes", "on" (any case) => true. Anything else => false. */
export function isTrue(v) {
  if (v === undefined || v === null) return false;
  return ['1', 'true', 'yes', 'on'].indexOf(String(v).trim().toLowerCase()) !== -1;
}

/** Parse a finite number, or return `fallback` when unset/invalid. */
export function toNumber(v, fallback) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}
