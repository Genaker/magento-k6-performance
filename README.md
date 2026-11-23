# Magento 2 K6-performance toolkit

k6 Magento 2 is a modern performance under load-testing tool when more than one user hits your page, built on years of experience in the Magento 2 performance and testing industries. It's built to be powerful, extensible, and full-featured. The key design goal is to provide the best developer experience.

![New Project (17)](https://github.com/Genaker/magento-k6-performance/assets/9213670/73f0334f-ea2f-40fe-9ae9-5c3e6bd285cd)

## Installation

```
# Download ARM binary
wget https://github.com/grafana/k6/releases/download/v0.50.0/k6-v0.50.0-linux-arm64.tar.gz

# Extract
tar -xvzf k6-v0.50.0-linux-arm64.tar.gz
sudo mv k6-v0.50.0-linux-arm64/k6 /usr/local/bin/

# Verify
k6 version
```

## Linux
## Debian/Ubuntu
```
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

If you are behind a firewall or proxy
There have been reports of users being unable to download the key from Ubuntu's key-server using apt-key command due to firewalls or proxies blocking their requests. If you experience this issue, you may try this alternative approach instead:
```
wget -q -O - https://bintray.com/user/downloadSubjectPublicKey?username=bintray | sudo apt-key add -
```
or just install script
```
bash install-ubuntu.sh
```
## Red Hat/CentOS
```
wget https://bintray.com/loadimpact/rpm/rpm -O bintray-loadimpact-rpm.repo
sudo mv bintray-loadimpact-rpm.repo /etc/yum.repos.d/
sudo yum install k6
```
## Mac (brew)

## Brew
```
brew install k6
```
## Docker
```
docker pull loadimpact/k6
```

# Usage with Magento

One script, `magento.js`, two modes:

| Mode | Turn it on with | What it does |
|---|---|---|
| **Single page** | `-e URL=https://site/page.html` | Hits one URL. `FPC=OFF` (default) busts the Full Page Cache on every request; `FPC=ON` lets the cache serve it. |
| **Page mix** | `-e CSV=scenarios.csv` | Picks pages by traffic share; for every request decides cache hit vs forced miss from that page's hit ratio. |

```
k6 run magento.js -e URL=https://example.com -u 200 -i 6000 --include-system-env-vars=false
```
Where:

magento.js - script name  
-e URL= site URL to test as env variable (lowercase `-e url=` works too)  
-e SLEEP=0.2 etc. add sleep after each HTTP response  
-u virtual users / concurrency / threads  
-i number of iterations  
--include-system-env-vars=false - don't include OS/system env variables  

Load is controlled by the usual k6 CLI flags (`-u`, `-i`, `--duration`, `--stage`, `--rps`), exactly as before. Optionally, `-e MODE=vus|rps|iterations` makes the script build the executor itself (see [Options](#options)).

## How cache busting works

For a request that should **miss** the cache, the script appends a unique `?fpc=<vu>-<iter>-<seq>-<time>-<rand>` (or `&fpc=` if the URL already has a query; a `#fragment` stays at the end). Varnish and Magento FPC key on the full URL, so every busted request renders fresh in PHP. A request that should **hit** uses the bare URL.

Every response is also checked for whether it **really** came from cache: `X-Magento-Cache-Debug` → `X-Cache` (Fastly/CDN) → `CF-Cache-Status` (Cloudflare) → fallback `Age > 0`. The script sends `X-Magento-Debug: 1` so Varnish echoes `X-Magento-Cache-Debug`; that only works when your load generator's IP is in the Varnish debug ACL. Without it, the `Age` fallback undercounts hits in the first second after a page is cached (Varnish reports `Age: 0` then).

> Busting fills Varnish with one-off objects. On long runs against production, watch Varnish memory / `n_lru_nuked`, or use a lower miss share.

# Page mix from a CSV

`scenarios.csv` — one row per page:

```csv
name,url,cache_hit_pct,traffic_pct
home,https://example.com/,95,35
category_women,https://example.com/women.html,90,20
product_sample,https://example.com/sample-product.html,80,15
search_shirt,https://example.com/catalogsearch/result/?q=shirt,20,8
cart,https://example.com/checkout/cart/,0,3
```

| Column | Meaning |
|---|---|
| `name` | Label for metric tags. Must be unique; defaults to the URL. |
| `url` | Absolute `https://…`, or a path like `/women.html` combined with `-e BASE_URL=https://example.com` (one CSV for staging and production). |
| `cache_hit_pct` | 0–100. Share of this page's requests sent as the bare URL (cache hit). The rest are busted. `0` = always miss, `100` = never bust. |
| `traffic_pct` | Relative share of all traffic. Doesn't need to sum to 100 (it is normalized). `0` switches the row off. |

Lines starting with `#` are comments. A bad row stops the run with its line number (non-numeric value, `cache_hit_pct` outside 0–100, duplicate `name`, relative URL without `BASE_URL`, ...).

```bash
# page mix, load from CLI flags
k6 run magento.js -e CSV=scenarios.csv -u 100 --duration 5m

# same CSV against staging using relative URLs
k6 run magento.js -e CSV=scenarios.csv -e BASE_URL=https://staging.example.com -u 50 --duration 2m

# fixed request rate, built-in executor
k6 run magento.js -e CSV=scenarios.csv -e MODE=rps -e RPS=200 -e DURATION=5m
```

`N` and `SLEEP` apply per request in both modes; in CSV mode each of the `N` requests picks its own page.

# Load Testing Guide

## Basic Test Scenarios

### 1. Quick Smoke Test
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --vus 10 --duration 30s \
  magento.js
```

### 2. Average Load Simulation
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --vus 100 --duration 5m \
  magento.js
```

### 3. Peak Load Stress Test
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --vus 500 --duration 10m \
  --rps 200 \
  magento.js
```

### 4. Realistic traffic mix
```bash
k6 run -e CSV=scenarios.csv --vus 200 --duration 10m magento.js
```

## Advanced Scenarios

### 5. Ramp-up Pattern
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --stage 2m:200 --stage 5m:200 --stage 1m:0 \
  magento.js
```

### 6. Spike Testing
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --stage 30s:1000 --stage 1m:1000 --stage 30s:50 \
  magento.js
```

## Options

All are `-e NAME=value`; names are case-insensitive (`-e url=` = `-e URL=`).

### Target and requests
| Variable | Description | Default |
|---|---|---|
| `URL` | Single-page mode: target URL | – |
| `CSV` | Page-mix mode: path to the scenario CSV | – |
| `BASE_URL` | Prefix for relative CSV urls (`/women.html`) | – |
| `METHOD` | HTTP method | `GET` |
| `N` | Requests per VU iteration | `1` |
| `SLEEP` | Pause after each request (s) | `0` |
| `FPC` | Single-page mode: `ON` = use the cache, `OFF` = bust every request | `OFF` |
| `BUST_KEY` | Query param used for busting | `fpc` |
| `DEBUG_HEADER` | Send `X-Magento-Debug: 1` | `true` |
| `FRESH_SESSION` | Clear cookies before each request (new-visitor behavior) | `false` |
| `VERBOSE` | Log every request (slows k6 down at high load) | `false` |
| `USERNAME` / `PASSWORD` | HTTP Basic Auth (e.g. staging behind htpasswd) | – |

### Load shape (optional — CLI flags are used when `MODE` is not set)
| Variable | Description | Default |
|---|---|---|
| `MODE` | `vus` (ramping-vus), `rps` (constant-arrival-rate), `iterations` (shared-iterations) | – |
| `VUS` | Peak VUs (`vus`), VUs (`iterations`), pre-allocated VUs (`rps`) | `50` / `10` / `RPS` |
| `RPS` | Requests per second (`rps`) | `50` |
| `MAX_VUS` | VU ceiling (`rps`) | `RPS × 4` |
| `DURATION` | Steady-state duration (`vus`, `rps`) | `3m` / `1m` |
| `RAMP` / `RAMPDOWN` | Ramp up / down (`vus`) | `30s` / `10s` |
| `ITERATIONS` | Total iterations (`iterations`) | `1000` |

### Thresholds (non-zero exit code when broken)
| Variable | Description | Default |
|---|---|---|
| `T_P95` | p95 of all `response_times` (ms) | `10000` |
| `T_HIT` / `T_MISS` | p95 for cache hits / misses (ms) | off |
| `MAX_ERROR_RATE` | Max share of failed requests (0–1) | off |
| `MAX_MISMATCH` | Max share of requests where the real cache result differed from the plan (0–1) | off |

## Example Command with All Options
```bash
k6 run \
  -e URL="http://yoursite.com/product/36" \
  -e METHOD=GET \
  -e N=5 \
  -e SLEEP=0.5 \
  -e FPC=ON \
  -e USERNAME=test -e PASSWORD=test123 \
  -e T_P95=3000 -e MAX_ERROR_RATE=0.01 \
  --vus 200 \
  --duration 10m \
  --rps 100 \
  --out json=metrics.json \
  magento.js
```

## Results Interpretation

Key metrics to monitor:
- **VUs**: Active virtual users
- **iterations**: Completed iterations
- **response_times** / **http_req_duration**: Response times
  - p(95): 95th percentile
  - max: Maximum response time
- **ttfb**: Time to first byte (server time)
- **errors** / **http_req_failed**: Error rate (network errors and HTTP 4xx/5xx; 2xx/3xx are fine)
- **cache_actual_hit**: Share of responses really served from cache
- **cache_expectation_mismatch**: Share where the cache did something other than planned (cold cache, a cookie that bypasses FPC, page not cacheable)
- **requests_total**: Requests sent

Every metric is tagged with `page` and `cache` (`hit`/`miss`), so you can filter, e.g. `response_times{page:product_sample,cache:miss}` in Grafana or the JSON output. Busted URLs are grouped under their page (`name` tag), so unique `?fpc=` values don't explode k6's metric series.

## Generating Reports

1. JSON output:
```bash
k6 run --out json=results.json magento.js
```

2. HTML report (requires k6-html-reporter):
```bash
k6 run --out json=results.json magento.js
npx k6-html-reporter -i results.json -o report.html
```

## Best Practices

1. Start with low VUs and gradually increase
2. Monitor application metrics during tests
3. Run tests from different locations
4. Test cold rendering with cache busting (`FPC=OFF`, or a low `cache_hit_pct`)
5. Test a realistic page mix with a CSV instead of one URL

## Troubleshooting

**Common Errors**:
- `405 Method Not Allowed`: check `METHOD` (it is uppercased for you)
- `429 Too Many Requests`: Reduce RPS/VUs
- `500 Errors`: Check application logs
- `cache_expectation_mismatch` high on "hit" requests: cache is cold, a cookie (e.g. `X-Magento-Vary`) bypasses FPC, or the page is not cacheable
- `CSV line N: ...`: fix that row of the CSV; the message names the column

**Debug Command**:
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  -e VERBOSE=true \
  --http-debug=full \
  --vus 1 --iterations 1 \
  magento.js
```

# Testing

The toolkit has two test layers. Both run in GitHub Actions on every push and pull request (`.github/workflows/test.yml`).

## Unit tests (Node, no k6 needed)

All logic lives in `lib/` as plain JavaScript that runs in both k6 and Node: config parsing, CSV parsing, page weighting, cache-hit decisions, cache busting, cache detection, load profiles and thresholds. `magento.js` only wires it to k6.

```bash
npm test            # = node --test test/*.test.js  (Node >= 20, no npm install needed)
```

| File | Covers |
|---|---|
| `test/config.test.js` | URL/CSV modes, lowercase env names, validation of `N`, `SLEEP`, `FPC`, `BUST_KEY` |
| `test/csv.test.js` | CSV quoting, CRLF/BOM, comments, errors; the shipped CSVs are valid |
| `test/scenarios.test.js` | traffic weights, CSV validation with line numbers, `BASE_URL`, traffic and hit-ratio distribution (seeded RNG, 200k draws) |
| `test/url.test.js` | `?`/`&`/`#fragment` handling, unique tokens |
| `test/cache.test.js` | Magento / Fastly / Cloudflare / `Age` detection, error statuses |
| `test/profile.test.js` | `MODE` executors, thresholds, CLI-compatible defaults |
| `test/k6-script.test.js` | `magento.js` imports resolve, `lib/` has no k6/Node deps or too-new syntax, no dead code |

## Smoke load test (k6 + mock Magento)

Runs the real `magento.js` under k6 against `smoke/mock-magento.js`, a local stand-in for Magento + Varnish (full-URL cache keys, `X-Magento-Cache-Debug`, `Age`, uncacheable `/checkout/`, slower misses). Afterwards `smoke/verify.js` reads what the mock actually received and checks it against the plan.

```bash
npm run test:smoke  # = bash smoke/run.sh  (needs k6, Node >= 20, curl)
```

It runs three tests:
1. **Page mix**: `smoke/scenarios.smoke.csv`, 3000 iterations. Checks each page's traffic share and busted share against the CSV, unique buster tokens, a single cold miss per cacheable page, no stray URLs, and the k6 thresholds (no errors, ≤1% cache mismatch, p95 per hit/miss).
2. **Single URL, `FPC=OFF`, `N=2`** with CLI flags (`-u 5 -i 200`): 400 requests, all busted, all unique, no hits.
3. **Single URL, `FPC=ON`**: one cold miss, every other request a hit.

Useful on its own too: `npm run mock` starts the mock on `http://127.0.0.1:18080` (`PORT` to change) to try options without touching a real store; `GET /__stats` shows what it received, `POST /__reset` clears it.

# Full K6 documentation

[https://k6.io/docs/](https://k6.io/docs/)
