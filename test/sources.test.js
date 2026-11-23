// Source adapters (lib/sources): each input format has its own adapter, and
// all of them feed the same scenario / sub-request pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSource, SOURCES } from '../lib/sources/index.js';
import { csvSource } from '../lib/sources/csv.js';
import { yamlSource } from '../lib/sources/yaml.js';
import { singleSource } from '../lib/sources/single.js';
import { parseConfig } from '../lib/config.js';

// In-memory files; counts reads so laziness can be checked.
function fakeFs(files) {
  const reads = [];
  const readFile = (p) => {
    reads.push(p);
    if (!(p in files)) throw new Error(`no such file: ${p}`);
    return files[p];
  };
  return { readFile, reads };
}

function open(env, files) {
  const fs = fakeFs(files || {});
  const src = openSource(env, fs.readFile);
  return { src, cfg: parseConfig(src.env), reads: fs.reads };
}

// The same two pages and the same Flux sub-request, once per format.
const CSV = [
  'name,type,url,url_flux,cache_hit_pct,traffic_pct,expect,expect_flux',
  'home,home,/,,90,60,Welcome,Hi',
  'search,search,/catalogsearch/result/?q={term},/search?q={term},50,40,Results,Found',
].join('\n');
const PROFILE = JSON.stringify({
  platforms: { flux: { calls: { search: [{ name: 'gql', url: '{api_base}/graphql?q={term}', expect: 'items' }] } } },
});
const YAML = `
name: Equivalence
load: { vus: 3 }
sites:
  flux: { base_url: https://flux.test, api_base: https://api.test, platform: flux }
search_terms: [bag, jacket]
platforms:
  flux:
    calls:
      search:
        - { name: gql, url: "{api_base}/graphql?q={term}", expect: items }
pages:
  - { name: home, type: home, url: /, cache_hit: 90, traffic: 60, expect: { default: Welcome, flux: Hi } }
  - name: search
    type: search
    url: { default: "/catalogsearch/result/?q={term}", flux: "/search?q={term}" }
    cache_hit: 50
    traffic: 40
    expect: { default: Results, flux: Found }
`;
const FILES = { 'pages.csv': CSV, 'platforms.json': PROFILE, 'plan.yml': YAML, 'terms.txt': 'bag\njacket\n' };

test('every adapter has the same shape', () => {
  assert.deepEqual(SOURCES.map((s) => s.kind).sort(), ['csv', 'single', 'yaml']);
  for (const s of SOURCES) {
    assert.equal(typeof s.claims, 'function', s.kind);
    assert.equal(typeof s.open, 'function', s.kind);
  }
  assert.equal(csvSource.kind, 'csv');
  assert.equal(yamlSource.kind, 'yaml');
  assert.equal(singleSource.kind, 'single');
});

test('the adapter is picked from the env (lowercase names work too)', () => {
  assert.equal(open({ PLAN: 'plan.yml', SITE: 'flux' }, FILES).src.kind, 'yaml');
  assert.equal(open({ csv: 'pages.csv', BASE_URL: 'https://s.test' }, FILES).src.kind, 'csv');
  assert.equal(open({ URL: 'https://s.test/' }).src.kind, 'single');
});

test('no target or two targets: the usual config errors', () => {
  assert.throws(() => openSource({}, fakeFs({}).readFile), /Missing target/);
  assert.throws(() => openSource({ CSV: 'pages.csv', PLAN: 'plan.yml' }, fakeFs(FILES).readFile), /only one of URL/);
});

test('CSV and YAML with the same pages give identical scenarios and sub-requests', () => {
  // default columns (the YAML site sets PLATFORM=flux, so point it at a platform with no overrides)
  const csvDefault = open({ CSV: 'pages.csv', BASE_URL: 'https://flux.test' }, FILES);
  const yamlDefault = open({ PLAN: 'plan.yml', SITE: 'flux', PLATFORM: 'luma' }, FILES);
  assert.deepEqual(yamlDefault.src.scenarios(yamlDefault.cfg), csvDefault.src.scenarios(csvDefault.cfg));

  // flux overrides + flux sub-requests
  const csv = open({ CSV: 'pages.csv', BASE_URL: 'https://flux.test', API_BASE: 'https://api.test', PLATFORM: 'flux', PROFILE: 'platforms.json' }, FILES);
  const yaml = open({ PLAN: 'plan.yml', SITE: 'flux' }, FILES);
  assert.deepEqual(yaml.src.scenarios(yaml.cfg), csv.src.scenarios(csv.cfg));
  assert.deepEqual(yaml.src.calls(yaml.cfg), csv.src.calls(csv.cfg));
  const search = csv.src.scenarios(csv.cfg).find((s) => s.type === 'search');
  assert.equal(search.url, 'https://flux.test/search?q={term}');
  assert.equal(search.expect, 'Found');
  assert.equal(csv.src.calls(csv.cfg).search[0].name, 'gql');
});

test('CSV: PROFILE needs PLATFORM; without PROFILE there are no sub-requests', () => {
  assert.throws(() => openSource({ CSV: 'pages.csv', PROFILE: 'platforms.json' }, fakeFs(FILES).readFile), /PROFILE needs -e PLATFORM/);
  const { src, cfg } = open({ CSV: 'pages.csv', BASE_URL: 'https://s.test', PLATFORM: 'flux' }, FILES);
  assert.equal(src.calls(cfg), null);
  assert.equal(src.scenarios(cfg)[1].url, 'https://s.test/search?q={term}'); // url_flux override still applies
});

test('CSV: a broken PROFILE names the file', () => {
  const { src, cfg } = open({ CSV: 'pages.csv', BASE_URL: 'https://s.test', PLATFORM: 'flux', PROFILE: 'bad.json' }, { ...FILES, 'bad.json': '{nope' });
  assert.throws(() => src.calls(cfg), /PROFILE bad\.json: invalid JSON/);
});

test('CSV: search terms come from TERMS only; label names the file', () => {
  const none = open({ CSV: 'pages.csv', BASE_URL: 'https://s.test' }, FILES);
  assert.deepEqual(none.src.terms(none.cfg), []);
  const withTerms = open({ CSV: 'pages.csv', BASE_URL: 'https://s.test', TERMS: 'terms.txt' }, FILES);
  assert.deepEqual(withTerms.src.terms(withTerms.cfg), ['bag', 'jacket']);
  assert.equal(none.src.label(none.cfg, 2), 'pages.csv (2 pages)');
});

test('CSV: files are read lazily (k6 reads them inside SharedArray)', () => {
  const { src, cfg, reads } = open({ CSV: 'pages.csv', BASE_URL: 'https://s.test', PLATFORM: 'flux', PROFILE: 'platforms.json' }, FILES);
  assert.deepEqual(reads, []);
  src.scenarios(cfg);
  src.calls(cfg);
  assert.deepEqual(reads, ['pages.csv', 'platforms.json']);
});

test('YAML: plan settings sit under -e values; site picks base_url, api_base, platform', () => {
  const plain = open({ PLAN: 'plan.yml', SITE: 'flux' }, FILES);
  assert.equal(plain.src.env.VUS, '3');
  assert.equal(plain.cfg.baseUrl, 'https://flux.test');
  assert.equal(plain.cfg.apiBase, 'https://api.test');
  assert.equal(plain.cfg.platform, 'flux');
  assert.equal(open({ PLAN: 'plan.yml', SITE: 'flux', VUS: '5' }, FILES).src.env.VUS, '5');
});

test('YAML: PROFILE is rejected (sub-requests live in the plan)', () => {
  assert.throws(() => openSource({ PLAN: 'plan.yml', PROFILE: 'platforms.json' }, fakeFs(FILES).readFile), /PROFILE is for CSV mode/);
});

test('YAML: SITES swaps in other hosts', () => {
  const files = { ...FILES, 'sites.yml': 'sites:\n  flux: { base_url: https://private.test, platform: flux }\n' };
  const { cfg } = open({ PLAN: 'plan.yml', SITES: 'sites.yml', SITE: 'flux' }, files);
  assert.equal(cfg.baseUrl, 'https://private.test');
});

test('YAML: terms from the plan, a plan-relative file, or TERMS on top', () => {
  const inline = open({ PLAN: 'plan.yml', SITE: 'flux' }, FILES);
  assert.deepEqual(inline.src.terms(inline.cfg), ['bag', 'jacket']);
  const fileFiles = { 'plans/p.yml': YAML.replace('search_terms: [bag, jacket]', 'search_terms_file: ../terms/t.txt'), 'terms/t.txt': 'coat\n' };
  const fromFile = open({ PLAN: 'plans/p.yml', SITE: 'flux' }, fileFiles);
  assert.deepEqual(fromFile.src.terms(fromFile.cfg), ['coat']);
  const override = open({ PLAN: 'plan.yml', SITE: 'flux', TERMS: 'terms.txt' }, { ...FILES, 'terms.txt': 'shoe\n' });
  assert.deepEqual(override.src.terms(override.cfg), ['shoe']);
});

test('YAML: label uses the plan name and site', () => {
  const { src, cfg } = open({ PLAN: 'plan.yml', SITE: 'flux' }, FILES);
  assert.equal(src.label(cfg, 2), 'Equivalence (2 pages, site flux: https://flux.test)');
});

test('single URL: one row, FPC decides hit or bust, no sub-requests, PROFILE rejected', () => {
  const on = open({ URL: 'https://s.test/p', FPC: 'ON' });
  assert.equal(on.src.scenarios(on.cfg)[0].cacheHit, 100);
  assert.equal(on.src.calls(on.cfg), null);
  assert.equal(on.src.label(on.cfg, 1), 'https://s.test/p');
  const off = open({ URL: 'https://s.test/p' });
  assert.equal(off.src.scenarios(off.cfg)[0].cacheHit, 0);
  assert.throws(() => openSource({ URL: 'https://s.test/p', PLATFORM: 'x', PROFILE: 'p.json' }, fakeFs({}).readFile), /PROFILE needs a page mix/);
});

test('CACHE_HIT overrides every page in any format', () => {
  const csv = open({ CSV: 'pages.csv', BASE_URL: 'https://s.test', CACHE_HIT: '0' }, FILES);
  const yaml = open({ PLAN: 'plan.yml', SITE: 'flux', CACHE_HIT: '0' }, FILES);
  for (const s of [...csv.src.scenarios(csv.cfg), ...yaml.src.scenarios(yaml.cfg)]) assert.equal(s.cacheHit, 0);
});
