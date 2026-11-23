import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envGet, isTrue, toNumber } from '../lib/env.js';

test('envGet reads UPPERCASE and lowercase names', () => {
  assert.equal(envGet({ URL: 'a' }, 'URL'), 'a');
  assert.equal(envGet({ url: 'b' }, 'URL'), 'b');
});

test('envGet prefers UPPERCASE when both are set', () => {
  assert.equal(envGet({ URL: 'upper', url: 'lower' }, 'URL'), 'upper');
});

test('envGet treats empty strings as unset', () => {
  assert.equal(envGet({ URL: '' }, 'URL'), undefined);
  assert.equal(envGet({ URL: '', url: 'x' }, 'URL'), 'x');
  assert.equal(envGet({}, 'URL'), undefined);
});

test('isTrue accepts common truthy spellings only', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) assert.equal(isTrue(v), true, v);
  for (const v of ['0', 'false', 'no', 'off', '', 'banana', undefined, null]) assert.equal(isTrue(v), false, String(v));
});

test('toNumber parses numbers and falls back on junk', () => {
  assert.equal(toNumber('42', 1), 42);
  assert.equal(toNumber('0.5', 1), 0.5);
  assert.equal(toNumber('abc', 7), 7);
  assert.equal(toNumber('', 7), 7);
  assert.equal(toNumber(undefined, 7), 7);
  assert.equal(toNumber('Infinity', 7), 7);
});
