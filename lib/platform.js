// Platform profiles: the extra requests a real browser makes after a page
// loads (AJAX/XHR/GraphQL), per page type. Runtime-agnostic.
//
// {
//   "platforms": {
//     "luma": { "calls": { "*": [ {name, url, expect?, headers?} ], "search": [ ... ] } },
//     "hyva": { "calls": {} }
//   }
// }
// "*" applies to every page type; a type's own list is added after it.
import { placeholders } from './template.js';

const CALL_PLACEHOLDERS = ['term', 'page_url', 'ts', 'api_base', 'base_url'];

/** Validate a parsed profile and return the call map for one platform. */
export function parsePlatformProfile(profile, platform) {
  if (!profile || typeof profile !== 'object' || !profile.platforms || typeof profile.platforms !== 'object') {
    throw new Error('Profile must be a JSON object with a "platforms" object');
  }
  const p = profile.platforms[platform];
  if (!p) {
    throw new Error(`Platform "${platform}" not in profile (have: ${Object.keys(profile.platforms).join(', ')})`);
  }
  const calls = p.calls || {};
  const out = {};
  for (const type in calls) {
    if (!Object.prototype.hasOwnProperty.call(calls, type)) continue;
    const list = calls[type];
    if (!Array.isArray(list)) throw new Error(`${platform}.calls.${type} must be an array`);
    out[type] = list.map(function (c, i) {
      const where = `${platform}.calls.${type}[${i}]`;
      if (!c || typeof c.url !== 'string' || c.url === '') throw new Error(`${where}: "url" is required`);
      if (!c.name || !/^[a-z0-9_]+$/.test(c.name)) {
        throw new Error(`${where}: "name" is required (lowercase letters, digits, _)`);
      }
      const bad = placeholders(c.url).filter(function (n) { return CALL_PLACEHOLDERS.indexOf(n) === -1; });
      if (bad.length) throw new Error(`${where}: unknown placeholder {${bad[0]}} (allowed: ${CALL_PLACEHOLDERS.join(', ')})`);
      if (!/^(\/|https?:\/\/|\{api_base\}|\{base_url\})/.test(c.url)) {
        throw new Error(`${where}: url must start with "/", http(s)://, {api_base} or {base_url}`);
      }
      const headers = {};
      if (c.headers !== undefined) {
        if (!c.headers || typeof c.headers !== 'object' || Array.isArray(c.headers)) {
          throw new Error(`${where}: "headers" must be an object of name: value`);
        }
        for (const h in c.headers) {
          if (!Object.prototype.hasOwnProperty.call(c.headers, h)) continue;
          if (typeof c.headers[h] !== 'string') throw new Error(`${where}: header "${h}" must be a string`);
          headers[h] = c.headers[h];
        }
      }
      return { name: c.name, url: c.url, expect: c.expect ? String(c.expect) : '', headers: headers };
    });
  }
  return out;
}

/** Calls for a page type: the "*" list, then the type's own list. */
export function callsFor(callMap, type) {
  if (!callMap) return [];
  return (callMap['*'] || []).concat(callMap[type] || []);
}

/** True if any call (of any type) uses the given placeholder. */
export function callsUse(callMap, name) {
  for (const type in callMap) {
    if (!Object.prototype.hasOwnProperty.call(callMap, type)) continue;
    for (let i = 0; i < callMap[type].length; i++) {
      if (placeholders(callMap[type][i].url).indexOf(name) !== -1) return true;
    }
  }
  return false;
}
