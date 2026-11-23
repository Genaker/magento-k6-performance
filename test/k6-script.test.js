// Static checks on the k6 entry script. k6 cannot run under Node, so these
// catch broken import paths and runtime-incompatible lib code before a k6 run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const importsOf = (src) => [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const K6_MODULES = /^k6(\/[a-z-]+)*$/;

test('magento.js only imports k6 built-ins and existing ./lib files', () => {
  const src = readFileSync(path.join(root, 'magento.js'), 'utf8');
  const imports = importsOf(src);
  assert.ok(imports.length > 0);
  for (const spec of imports) {
    if (K6_MODULES.test(spec)) continue;
    assert.ok(spec.startsWith('./lib/'), `unexpected import "${spec}" (no remote/npm deps)`);
    assert.ok(existsSync(path.join(root, spec)), `missing file for import "${spec}"`);
  }
});

// lib/*.js and lib/sources/*.js (lib/vendor is third-party code)
const LIB_DIRS = ['lib', 'lib/sources'];
const libFiles = () => LIB_DIRS.flatMap((d) => readdirSync(path.join(root, d))
  .filter((x) => x.endsWith('.js'))
  .map((x) => path.join(d, x)));

test('lib/ is runtime-agnostic: no k6 or node imports, relative imports resolve inside lib', () => {
  const lib = path.join(root, 'lib');
  for (const f of libFiles()) {
    const src = readFileSync(path.join(root, f), 'utf8');
    for (const spec of importsOf(src)) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${f} imports "${spec}" - lib must not depend on k6 or node`);
      const target = path.resolve(root, path.dirname(f), spec);
      assert.ok(target.startsWith(lib + path.sep), `${f}: "${spec}" points outside lib/`);
      assert.ok(existsSync(target), `${f}: missing "${spec}"`);
    }
  }
});

test('lib/ avoids syntax older k6 runtimes may not support', () => {
  for (const f of libFiles()) {
    const code = readFileSync(path.join(root, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\?\?|\?\.|\|\|=|Object\.fromEntries|\.at\(/, f);
  }
});

test('magento.js exports the k6 lifecycle functions', () => {
  const src = readFileSync(path.join(root, 'magento.js'), 'utf8');
  assert.match(src, /export const options\b/);
  assert.match(src, /export default function/);
  assert.match(src, /export function setup\b/);
  assert.match(src, /export function teardown\b/);
});

test('every lib export is used by magento.js or covered by a unit test', () => {
  const used = readFileSync(path.join(root, 'magento.js'), 'utf8');
  const tests = readdirSync(path.join(root, 'test'))
    .filter((x) => x.endsWith('.test.js'))
    .map((x) => readFileSync(path.join(root, 'test', x), 'utf8'))
    .join('\n');
  for (const f of libFiles()) {
    const src = readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/export (?:function|const) (\w+)/g)) {
      assert.ok(used.includes(m[1]) || tests.includes(m[1]), `${f}: ${m[1]} is dead code`);
    }
  }
});
