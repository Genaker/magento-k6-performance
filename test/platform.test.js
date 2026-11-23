import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlatformProfile, callsFor, callsUse } from '../lib/platform.js';

const profile = {
  platforms: {
    luma: {
      calls: {
        '*': [{ name: 'banner', url: '/banner/ajax/load/?u={page_url}&_={ts}', headers: { 'X-Requested-With': 'XMLHttpRequest' } }],
        search: [{ name: 'log', url: '/log?q={term}' }],
      },
    },
    hyva: { calls: {} },
    flux: { calls: { search: [{ name: 'gql', url: '{api_base}/graphql?q={term}', expect: '"items":[{' }] } },
  },
};

test('parses a platform section with defaults', () => {
  const luma = parsePlatformProfile(profile, 'luma');
  assert.deepEqual(luma['*'][0], {
    name: 'banner', url: '/banner/ajax/load/?u={page_url}&_={ts}', expect: '', headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  assert.deepEqual(luma.search[0].headers, {});
  assert.deepEqual(parsePlatformProfile(profile, 'hyva'), {});
});

test('callsFor = "*" calls then the type\'s own calls', () => {
  const luma = parsePlatformProfile(profile, 'luma');
  assert.deepEqual(callsFor(luma, 'search').map((c) => c.name), ['banner', 'log']);
  assert.deepEqual(callsFor(luma, 'product').map((c) => c.name), ['banner']);
  assert.deepEqual(callsFor(parsePlatformProfile(profile, 'flux'), 'product'), []);
  assert.deepEqual(callsFor(null, 'search'), []);
});

test('callsUse finds placeholders across all types', () => {
  assert.equal(callsUse(parsePlatformProfile(profile, 'flux'), 'api_base'), true);
  assert.equal(callsUse(parsePlatformProfile(profile, 'luma'), 'api_base'), false);
  assert.equal(callsUse(parsePlatformProfile(profile, 'luma'), 'term'), true);
});

test('unknown platform lists the available ones', () => {
  assert.throws(() => parsePlatformProfile(profile, 'pwa'), /"pwa" not in profile \(have: luma, hyva, flux\)/);
});

test('profile shape is validated', () => {
  assert.throws(() => parsePlatformProfile(null, 'x'), /"platforms"/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': {} } } } }, 'x'), /must be an array/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': [{ name: 'a' }] } } } }, 'x'), /"url" is required/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': [{ url: '/a' }] } } } }, 'x'), /"name" is required/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': [{ name: 'Bad Name', url: '/a' }] } } } }, 'x'), /"name"/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': [{ name: 'a', url: '/a?{nope}' }] } } } }, 'x'), /\{nope\}/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': [{ name: 'a', url: 'relative' }] } } } }, 'x'), /must start with/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': [{ name: 'a', url: '/a', headers: ['x'] }] } } } }, 'x'), /"headers"/);
  assert.throws(() => parsePlatformProfile({ platforms: { x: { calls: { '*': [{ name: 'a', url: '/a', headers: { h: 1 } }] } } } }, 'x'), /header "h"/);
});
