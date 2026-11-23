// k6 options (load shape + thresholds) built from env. Runtime-agnostic.
import { envGet, toNumber, isTrue } from './env.js';

function rate(raw, name) {
  const v = Number(raw);
  if (!isFinite(v) || v < 0 || v > 1) throw new Error(`${name} must be between 0 and 1 (got "${raw}")`);
  return v;
}

/**
 * Parse STAGES like "2m:20,2m:40,30s:0" into k6 stages [{duration, target}].
 * In MODE=ramp-rps the target is requests/second; k6 moves linearly from the
 * previous target to the next one over each stage's duration.
 */
export function parseStages(raw) {
  const parts = String(raw).split(',').map(function (p) { return p.trim(); }).filter(function (p) { return p; });
  if (parts.length === 0) throw new Error('STAGES must list at least one "duration:target" pair, e.g. 2m:20,2m:40');
  return parts.map(function (p) {
    const m = /^(\d+(?:\.\d+)?(?:ms|s|m|h))\s*:\s*(\d+(?:\.\d+)?)$/.exec(p);
    if (!m) throw new Error(`STAGES entry "${p}" must look like 2m:40 (duration with ms/s/m/h, then a number)`);
    return { duration: m[1], target: Number(m[2]) };
  });
}

/**
 * Load shape. Without MODE, returns null and the CLI controls the load
 * (-u/-i/--duration/--stage), exactly like the original magento.js.
 *   MODE=vus         ramping-vus: 0 -> VUS over RAMP, hold DURATION, ramp down
 *   MODE=rps         constant-arrival-rate: RPS req/s for DURATION
 *   MODE=ramp-rps    ramping-arrival-rate: req/s follows STAGES (find the limit)
 *   MODE=iterations  shared-iterations: ITERATIONS total across VUS
 */
export function buildLoadProfile(env) {
  const modeRaw = envGet(env, 'MODE');
  if (modeRaw === undefined) return null;
  const mode = modeRaw.toLowerCase();

  if (mode === 'ramp-rps') {
    const stages = parseStages(envGet(env, 'STAGES') || '1m:10,2m:30,2m:60');
    let peak = 1;
    for (let i = 0; i < stages.length; i++) if (stages[i].target > peak) peak = stages[i].target;
    return {
      load: {
        executor: 'ramping-arrival-rate',
        startRate: toNumber(envGet(env, 'START_RPS'), 0),
        timeUnit: '1s',
        preAllocatedVUs: toNumber(envGet(env, 'VUS'), Math.ceil(peak)),
        maxVUs: toNumber(envGet(env, 'MAX_VUS'), Math.ceil(peak) * 4),
        stages: stages,
      },
    };
  }

  if (mode === 'rps') {
    const rps = toNumber(envGet(env, 'RPS'), 50);
    return {
      load: {
        executor: 'constant-arrival-rate',
        rate: rps,
        timeUnit: '1s',
        duration: envGet(env, 'DURATION') || '1m',
        preAllocatedVUs: toNumber(envGet(env, 'VUS'), rps),
        maxVUs: toNumber(envGet(env, 'MAX_VUS'), rps * 4),
      },
    };
  }
  if (mode === 'iterations') {
    return {
      load: {
        executor: 'shared-iterations',
        vus: toNumber(envGet(env, 'VUS'), 10),
        iterations: toNumber(envGet(env, 'ITERATIONS'), 1000),
        maxDuration: envGet(env, 'MAX_DURATION') || '10m',
      },
    };
  }
  if (mode === 'vus') {
    const vus = toNumber(envGet(env, 'VUS'), 50);
    return {
      load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: envGet(env, 'RAMP') || '30s', target: vus },
          { duration: envGet(env, 'DURATION') || '3m', target: vus },
          { duration: envGet(env, 'RAMPDOWN') || '10s', target: 0 },
        ],
        gracefulRampDown: '10s',
      },
    };
  }
  throw new Error(`MODE must be vus, rps, ramp-rps or iterations (got "${modeRaw}")`);
}

/**
 * Thresholds. Default is the original single one (response_times p95 < 10s),
 * so existing runs keep the same exit code. Everything else is opt-in.
 */
export function buildThresholds(env) {
  const t = {
    response_times: [`p(95)<${toNumber(envGet(env, 'T_P95'), 10000)}`],
  };
  const tHit = envGet(env, 'T_HIT');
  if (tHit !== undefined) t['response_times{cache:hit}'] = [`p(95)<${toNumber(tHit, 800)}`];
  const tMiss = envGet(env, 'T_MISS');
  if (tMiss !== undefined) t['response_times{cache:miss}'] = [`p(95)<${toNumber(tMiss, 4000)}`];
  // ABORT_ON_FAIL=true stops the whole test once an error-rate threshold is
  // broken (after 30s of data), so a ramp can't keep hammering a failing site.
  const abort = isTrue(envGet(env, 'ABORT_ON_FAIL'));
  const errRule = function (expr) {
    return abort ? [{ threshold: expr, abortOnFail: true, delayAbortEval: '30s' }] : [expr];
  };
  const maxErr = envGet(env, 'MAX_ERROR_RATE');
  if (maxErr !== undefined) t.errors = errRule(`rate<=${rate(maxErr, 'MAX_ERROR_RATE')}`);
  const maxApiErr = envGet(env, 'MAX_API_ERROR_RATE');
  if (maxApiErr !== undefined) t.api_errors = errRule(`rate<=${rate(maxApiErr, 'MAX_API_ERROR_RATE')}`);
  const maxMismatch = envGet(env, 'MAX_MISMATCH');
  if (maxMismatch !== undefined) {
    t.cache_expectation_mismatch = [`rate<=${rate(maxMismatch, 'MAX_MISMATCH')}`];
  }
  return t;
}

/** Full k6 options object. */
export function buildOptions(env) {
  const options = {
    discardResponseBodies: true,
    insecureSkipTLSVerify: true,
    summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
    thresholds: buildThresholds(env),
  };
  const profile = buildLoadProfile(env);
  // `vus` next to `scenarios` is a k6 config conflict, so set one or the other.
  if (profile) options.scenarios = profile;
  else options.vus = 1;
  return options;
}
