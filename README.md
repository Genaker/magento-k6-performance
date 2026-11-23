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

```
k6 run magento.js -e url=https://example.com -u 200 -i 6000 --include-system-env-vars=false
```
Where:

magento.js - script name  
-e url= site URL to test as env variable  
-e sleep=0.2 etc. add sleep after HTTP response
-u virtual users / concurrency / threads  
-i number of iteration  
--include-system-env-vars=false - don't include OS/system env variables  

# Mixed-traffic FPC test (CSV scenarios) — `magento-load.js`

`magento.js` hits one URL. Real traffic is a mix: many pages, each with its own
share of visitors and its own cache hit ratio. `magento-load.js` drives the whole
run from a CSV where every row is a page with two independent weights:

- **`cache_hit_pct`** — share of requests to that page that should be **FPC hits**.
  The rest get a unique `?fpc=<token>` query param appended, so Varnish / Magento
  Full Page Cache sees a new cache key → forced **MISS** (full PHP render).
- **`traffic_pct`** — the page's share of total traffic (relative; normalized,
  so the column does not have to sum to 100).

It also **verifies** the real cache result of every response
(`X-Magento-Cache-Debug`, `X-Cache`, or `Age > 0`) and reports expected vs actual
hit ratio, with every metric tagged by page and by hit/miss.

## CSV format (`scenarios.csv`)

```csv
name,url,cache_hit_pct,traffic_pct
home,https://example.com/,95,35
category_women,https://example.com/women.html,90,20
product_sample,https://example.com/sample-product.html,80,15
search_shirt,https://example.com/catalogsearch/result/?q=shirt,20,8
cart,https://example.com/checkout/cart/,0,3
```

- `name` — label used to tag metrics (defaults to the URL if blank).
- `cache_hit_pct` — 0–100. `0` = always bust FPC, `100` = never bust.
- `traffic_pct` — relative weight; rows with `traffic_pct <= 0` are skipped.
- URLs that already have a `?query` are handled (`&fpc=` is appended instead).

## Run

```bash
# ramping VUs (default): 0 -> VUS over RAMP, hold DURATION, ramp down
k6 run magento-load.js -e CSV=scenarios.csv -e VUS=100 -e DURATION=3m

# fixed request rate (open model) instead of VUs
k6 run magento-load.js -e MODE=rps -e RPS=200 -e DURATION=2m

# JSON + HTML report
k6 run magento-load.js -e VUS=100 --out json=results.json
npx k6-html-reporter -i results.json -o report.html
```

## Options

| Variable | Default | Meaning |
|---|---|---|
| `CSV` | `./scenarios.csv` | path to the scenario CSV |
| `MODE` | `vus` | `vus` (ramping-vus) or `rps` (constant-arrival-rate) |
| `VUS` | `50` | peak VUs (preallocated VUs in `rps` mode) |
| `RPS` | `50` | requests/sec when `MODE=rps` |
| `MAX_VUS` | `RPS*4` | VU ceiling in `rps` mode |
| `DURATION` | `3m` (`1m` in rps) | steady-state duration |
| `RAMP` / `RAMPDOWN` | `30s` / `10s` | ramp up / down (vus mode) |
| `SLEEP` | `0.5` | think time (s) between iterations |
| `BUST_KEY` | `fpc` | query key used to bust the cache |
| `DEBUG_HEADER` | `true` | send `X-Magento-Debug: 1` so the edge echoes cache debug |
| `FRESH_SESSION` | `false` | clear cookies each iteration (new-visitor behavior) |
| `T_HIT` / `T_MISS` | `800` / `4000` | p95 threshold (ms) for hits / misses |
| `SUMMARY_JSON` | `true` | also write `summary.json` |

## Metrics

All tagged by `page` and `cache` (`hit`/`miss`):

- `resp_time`, `ttfb` — timing trends; thresholds are split hit vs miss.
- `errors`, `http_req_failed` — error rates (network errors count as errors).
- `requests_total` — per-page request counter.
- `cache_actual_hit` — measured hit ratio from the response headers.
- `cache_expectation_mismatch` — the edge disagreed with what was requested
  (e.g. a "hit" request that actually MISSed: cold cache, bypass, or vary cookies).

Filter by tag in the summary or Grafana, e.g.
`resp_time{page:product_sample,cache:miss}`.

> `X-Magento-Cache-Debug` is only emitted when the client IP is in the
> Varnish/Fastly debug ACL. If your edge doesn't echo it, the script falls back
> to the `Age` header (hit ⇒ `Age > 0`).

# Load Testing Guide

## Installation
```bash
# Install k6
sudo apt-get update && sudo apt-get install k6

# Verify installation
k6 version
```

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

## Advanced Scenarios

### 4. Ramp-up Pattern
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --stage 2m:200 --stage 5m:200 --stage 1m:0 \
  magento.js
```

### 5. Spike Testing
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --stage 30s:1000 --stage 1m:1000 --stage 30s:50 \
  magento.js
```

## Configuration Options

### Environment Variables
| Variable    | Description                | Default     |
|-------------|----------------------------|-------------|
| `URL`       | Target endpoint            | Required    |
| `METHOD`    | HTTP Method                | `GET`       |
| `N`         | Iterations per VU          | `1`         |
| `SLEEP`     | Delay between requests (s) | `0`         |
| `FPC`       | Full Page Cache            | `OFF`       |
| `USERNAME`  | Basic Auth username        | -           |
| `PASSWORD`  | Basic Auth password        | -           |

## Example Command with All Options
```bash
k6 run \
  -e URL="http://yoursite.com/product/36" \
  -e METHOD=GET \
  -e N=5 \
  -e SLEEP=0.5 \
  -e FPC=ON \
  -e USERNAME=test -e PASSWORD=test123 \
  --vus 200 \
  --duration 10m \
  --rps 100 \
  --out json=metrics.json \
  magento.js
```

## Results Interpretation

Key metrics to monitor:
- **VUs**: Active virtual users
- **iterations**: Completed requests
- **http_req_duration**: Response times
  - p(95): 95th percentile
  - max: Maximum response time
- **http_req_failed**: Error rate
- **rps**: Requests per second

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
4. Combine with cache busting (FPC=OFF)
5. Test different endpoints simultaneously

## Troubleshooting

**Common Errors**:
- `405 Method Not Allowed`: Ensure correct HTTP method case (UPPERCASE)
- `429 Too Many Requests`: Reduce RPS/VUs
- `500 Errors`: Check application logs

**Debug Command**:
```bash
k6 run -e URL="http://yoursite.com/product/36" \
  --http-debug=full \
  --vus 1 --iterations 1 \
  magento.js
```

# Full K6 documentation

[https://k6.io/docs/](https://k6.io/docs/)

