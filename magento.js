import http from 'k6/http';
import encoding from 'k6/encoding';
import { sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';


const username = __ENV.USERNAME || 'defaultUser';
const password = __ENV.PASSWORD || 'defaultPassword';

const responseTimes = new Trend('response_times');
const errorRate = new Rate('errors');

export let options = {
  vus: 1,
  discardResponseBodies: true,
  insecureSkipTLSVerify: true,
  summaryTrendStats: ['min', 'med', 'avg', 'max', 'p(95)'],
  thresholds: {
    //'errors': ['rate<1'],
    'response_times': ['p(95)<10000']
  }
};

export function setup() {
  if (!__ENV.URL) throw new Error('Missing required URL parameter');
  if (__ENV.N && isNaN(__ENV.N)) throw new Error('Parameter N must be a number');
  
  return {
    url: __ENV.URL,
    method: (__ENV.METHOD || 'GET').toUpperCase(),
    separ: __ENV.URL.includes('?') ? '&' : '?',
    n: parseInt(__ENV.N) || 1,
    sleep: parseFloat(__ENV.SLEEP) || 0,
    fpc: __ENV.FPC ? __ENV.FPC.toUpperCase() !== 'OFF' : true
  };
}

export default function (data) {
  // Initialize headers
  const headers = {
    'User-Agent': 'k6/MagentoLoadTest/1.25'
  };

  // Add auth only if credentials are provided
  if (__ENV.USERNAME && __ENV.PASSWORD) {
    headers.Authorization = `Basic ${encoding.b64encode(`${__ENV.USERNAME}:${__ENV.PASSWORD}`)}`;
  }

  const url = data.fpc ? data.url : `${data.url}${data.separ}fpc=${__VU}_${__ITER}_${Date.now()}`;
  console.log(`Final URL: ${url}`);

  const res = http.request(data.method, url, null, { headers: headers });
  
  // Track metrics
  responseTimes.add(res.timings.duration);
  errorRate.add(res.status !== 200);

  // Detailed logging with URL and method
  console.log(`[${data.method.toUpperCase()}] ${data.url}`);
  console.log(`Response time: ${res.timings.duration} ms | Status: ${res.status} | TTFB: ${res.timings.waiting} ms`);
  console.log('------------------------------------');
  
  // Error logging
  if (res.status !== 200) {
    console.error(`[VU${__VU}] ${data.method.toUpperCase()} ${data.url} - Error ${res.status}`);
  }
  
  sleep(data.sleep);
}

export function teardown(data) {
  console.log(`\nTest Summary:
  URL: ${data.url}
  Method: ${data.method.toUpperCase()}
  Iterations: ${data.n}
  Cache Strategy: ${data.fpc ? 'FPC Enabled' : 'Cache Busted'}
  Avg Sleep: ${data.sleep}s`);
}
