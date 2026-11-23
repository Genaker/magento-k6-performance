// k6 options (load shape + thresholds) built from env. Runtime-agnostic.
import { envGet, toNumber } from './env.js';

function rate(raw, name) {
  const v = Number(raw);
  if (!isFinite(v) || v < 0 || v > 1) throw new Error(`${name} must be between 0 and 1 (got "${raw}")`);
  return v;
}

/**
 * Load shape. Without MODE, returns null and the CLI controls the load
 * (-u/-i/--duration/--stage), exactly like the original magento.js.
 *   MODE=vus         ramping-vus: 0 -> VUS over RAMP, hold DURATION, ramp down
 *   MODE=rps         constant-arrival-rate: RPS req/s for DURATION
 *   MODE=iterations  shared-iterations: ITERATIONS total across VUS
 */
export function buildLoadProfile(env) {
  const modeRaw = envGet(env, 'MODE');
  if (modeRaw === undefined) return null;
  const mode = modeRaw.toLowerCase();

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
  throw new Error(`MODE must be vus, rps or iterations (got "${modeRaw}")`);
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
  const maxErr = envGet(env, 'MAX_ERROR_RATE');
  if (maxErr !== undefined) t.errors = [`rate<=${rate(maxErr, 'MAX_ERROR_RATE')}`];
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
