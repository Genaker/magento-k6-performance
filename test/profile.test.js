import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadProfile, buildThresholds, buildOptions, parseStages } from '../lib/profile.js';

test('no MODE => no scenarios, CLI flags control the load (original behavior)', () => {
  assert.equal(buildLoadProfile({}), null);
  const o = buildOptions({});
  assert.equal(o.vus, 1);
  assert.equal(o.scenarios, undefined);
});

test('MODE and vus are never both set (k6 config conflict)', () => {
  for (const MODE of ['vus', 'rps', 'iterations']) {
    const o = buildOptions({ MODE });
    assert.ok(o.scenarios, MODE);
    assert.equal(o.vus, undefined, MODE);
  }
});

test('MODE=vus builds ramping-vus with defaults and overrides', () => {
  const d = buildLoadProfile({ MODE: 'vus' }).load;
  assert.equal(d.executor, 'ramping-vus');
  assert.deepEqual(d.stages.map((s) => s.target), [50, 50, 0]);
  const o = buildLoadProfile({ MODE: 'VUS', VUS: '200', RAMP: '1m', DURATION: '10m', RAMPDOWN: '30s' }).load;
  assert.deepEqual(o.stages, [
    { duration: '1m', target: 200 },
    { duration: '10m', target: 200 },
    { duration: '30s', target: 0 },
  ]);
});

test('MODE=rps builds constant-arrival-rate', () => {
  const p = buildLoadProfile({ MODE: 'rps', RPS: '200', DURATION: '2m' }).load;
  assert.equal(p.executor, 'constant-arrival-rate');
  assert.equal(p.rate, 200);
  assert.equal(p.timeUnit, '1s');
  assert.equal(p.duration, '2m');
  assert.equal(p.preAllocatedVUs, 200);
  assert.equal(p.maxVUs, 800);
});

test('MODE=iterations builds shared-iterations', () => {
  const p = buildLoadProfile({ MODE: 'iterations', VUS: '20', ITERATIONS: '3000' }).load;
  assert.equal(p.executor, 'shared-iterations');
  assert.equal(p.vus, 20);
  assert.equal(p.iterations, 3000);
});

test('unknown MODE is an error', () => {
  assert.throws(() => buildLoadProfile({ MODE: 'spike' }), /MODE must be/);
});

test('default thresholds are the original single one', () => {
  assert.deepEqual(buildThresholds({}), { response_times: ['p(95)<10000'] });
  assert.deepEqual(buildThresholds({ T_P95: '3000' }), { response_times: ['p(95)<3000'] });
});

test('optional thresholds', () => {
  const t = buildThresholds({ T_HIT: '500', T_MISS: '3000', MAX_ERROR_RATE: '0.01', MAX_MISMATCH: '0', MAX_API_ERROR_RATE: '0.02' });
  assert.deepEqual(t.api_errors, ['rate<=0.02']);
  assert.deepEqual(t['response_times{cache:hit}'], ['p(95)<500']);
  assert.deepEqual(t['response_times{cache:miss}'], ['p(95)<3000']);
  assert.deepEqual(t.errors, ['rate<=0.01']);
  assert.deepEqual(t.cache_expectation_mismatch, ['rate<=0']);
});

test('rate thresholds are validated', () => {
  assert.throws(() => buildThresholds({ MAX_ERROR_RATE: '5' }), /MAX_ERROR_RATE/);
  assert.throws(() => buildThresholds({ MAX_MISMATCH: 'low' }), /MAX_MISMATCH/);
});

test('options keep the original safe defaults', () => {
  const o = buildOptions({});
  assert.equal(o.discardResponseBodies, true);
  assert.equal(o.insecureSkipTLSVerify, true);
  assert.ok(o.summaryTrendStats.includes('p(95)'));
});

test('parseStages reads duration:target pairs', () => {
  assert.deepEqual(parseStages('1m:10, 2m:10,30s:25.5,1h:0'), [
    { duration: '1m', target: 10 }, { duration: '2m', target: 10 }, { duration: '30s', target: 25.5 }, { duration: '1h', target: 0 },
  ]);
  for (const bad of ['', '2m', '2:40', '2m:-5', '2m:x', 'fast:10']) assert.throws(() => parseStages(bad), /STAGES/, bad);
});

test('MODE=ramp-rps builds ramping-arrival-rate sized for the peak', () => {
  const p = buildLoadProfile({ MODE: 'ramp-rps', STAGES: '1m:10,2m:40,1m:0' }).load;
  assert.equal(p.executor, 'ramping-arrival-rate');
  assert.equal(p.timeUnit, '1s');
  assert.equal(p.startRate, 0);
  assert.equal(p.preAllocatedVUs, 40);
  assert.equal(p.maxVUs, 160);
  assert.deepEqual(p.stages.map((s) => s.target), [10, 40, 0]);
  assert.equal(buildLoadProfile({ MODE: 'ramp-rps', STAGES: '1m:5', MAX_VUS: '7', START_RPS: '2' }).load.maxVUs, 7);
});

test('ABORT_ON_FAIL turns error thresholds into abort rules', () => {
  const t = buildThresholds({ MAX_ERROR_RATE: '0.05', MAX_API_ERROR_RATE: '0.1', ABORT_ON_FAIL: 'true' });
  assert.deepEqual(t.errors, [{ threshold: 'rate<=0.05', abortOnFail: true, delayAbortEval: '30s' }]);
  assert.deepEqual(t.api_errors, [{ threshold: 'rate<=0.1', abortOnFail: true, delayAbortEval: '30s' }]);
  assert.deepEqual(buildThresholds({ MAX_ERROR_RATE: '0.05' }).errors, ['rate<=0.05']);
});
