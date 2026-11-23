// `{placeholder}` templates for URLs and expected text. Runtime-agnostic.
//
// Placeholders are lowercase words in braces: {term}, {page_url}, {ts},
// {api_base}. A brace followed by anything else (e.g. JSON like {"a":1}) is
// left alone, so expect strings may contain literal JSON.

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/** Names of the placeholders used in a template, in order of appearance. */
export function placeholders(template) {
  const out = [];
  String(template).replace(PLACEHOLDER, function (m, name) {
    if (out.indexOf(name) === -1) out.push(name);
    return m;
  });
  return out;
}

/** Replace every {name} with vars[name]. Throws on an unknown placeholder. */
export function fillTemplate(template, vars) {
  return String(template).replace(PLACEHOLDER, function (m, name) {
    if (!Object.prototype.hasOwnProperty.call(vars, name) || vars[name] === undefined) {
      throw new Error(`Unknown or unset placeholder {${name}} in "${template}"`);
    }
    return String(vars[name]);
  });
}

/**
 * Encode a search term for a URL the way a browser search form does
 * (spaces as '+'), so k6 hits the same cache keys as real visitors.
 */
export function encodeTerm(term) {
  return encodeURIComponent(term).replace(/%20/g, '+');
}

/** Search terms file: one term per line; blank lines and # comments ignored. */
export function parseTerms(text) {
  const terms = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || t.charAt(0) === '#') continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9 '-]*$/.test(t)) {
      throw new Error(`Search terms line ${i + 1}: only letters, digits, spaces, ' and - are allowed (got "${t}")`);
    }
    terms.push(t);
  }
  return terms;
}
