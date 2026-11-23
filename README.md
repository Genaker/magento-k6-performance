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

One script, `magento.js`, three modes:

| Mode | Turn it on with | What it does |
|---|---|---|
| **Test plan** (recommended) | `-e PLAN=plans/sample-data.yml -e SITE=flux` | One YAML file: sites, load, thresholds, the requests each storefront's browser makes after a page, and the page mix. See [Test plans](#test-plans-yaml). |
| **Page mix** | `-e CSV=scenarios.csv` | Picks pages by traffic share; for every request decides cache hit vs forced miss from that page's hit ratio. |
| **Single page** | `-e URL=https://site/page.html` | Hits one URL. `FPC=OFF` (default) busts the Full Page Cache on every request; `FPC=ON` lets the cache serve it. |

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

# Test plans (YAML)

A plan describes a whole load test in one file. [`plans/sample-data.yml`](plans/sample-data.yml) is a ready-made plan for any store with **Magento sample data**: the same 40 pages on a **Luma**, **Hyvä** or **Flux** (headless Next.js) storefront.

```bash
# 1. check every page returns data on your site (one request each, no load)
npm run validate -- --plan plans/sample-data.yml --site flux

# 2. run the load test
k6 run magento.js -e PLAN=plans/sample-data.yml -e SITE=flux
```

```yaml
name: Magento sample data mix

sites:                          # pick one with -e SITE=<name>
  luma: { base_url: https://luma.example.com, platform: luma }
  flux:
    base_url: https://flux.example.com
    api_base: https://flux-api.example.com   # GraphQL host the browser calls ({api_base})
    platform: flux              # which "platforms" section applies (defaults to the site name)

load:       { mode: rps, rps: 20, duration: 5m, sleep: 0 }      # same as MODE, RPS, ... below
thresholds: { t_p95: 3000, t_hit: 800, t_miss: 4000, max_error_rate: 0.01, max_api_error_rate: 0.01 }
options:    { debug_header: true }                              # method, bust_key, fresh_session, verbose
search_terms_file: ../scenarios/search-terms.txt                # or: search_terms: [bag, yoga mat]

platforms:                      # requests the browser makes AFTER the page, per page type
  luma:
    calls:
      search:                   # a page type, or "*" for every page type
        - name: search_terms_log
          url: /catalogsearch/searchTermsLog/save/?q={term}&_={ts}
          headers: { X-Requested-With: XMLHttpRequest }
  flux:
    calls:
      search:
        - { name: gql_search_products, url: "{api_base}/graphql?query=...{term}...", expect: '"items":[{' }

pages:
  - { name: home, type: home, url: /, cache_hit: 95, traffic: 10, expect: { luma: Hero Hoodie, flux: Tiberius Gym Tank } }
  - { name: pdp_hero_hoodie, type: product, url: /hero-hoodie.html, cache_hit: 80, traffic: 2, expect: Hero Hoodie }
  - name: search
    type: search
    url: { default: "/catalogsearch/result/?q={term}", flux: "/catalog/product_search?search={term}" }
    cache_hit: 60
    traffic: 20
    expect: { default: price-box price-final_price, flux: Search results for }
```

### Page fields

| Field | Meaning |
|---|---|
| `name` | Unique label; every metric is tagged with it. |
| `type` | Page type (`home`, `category`, `product`, `search`, `cms`, `cart`, `checkout`, ...). Picks the platform's sub-requests and tags metrics, so results can be split per page type. |
| `url` | Path (joined with the site's `base_url`) or absolute URL. Text, or a mapping `{ default: ..., <platform>: ... }` when a storefront uses a different route. `"-"` skips the page on that platform. May use `{term}`. |
| `cache_hit` | 0–100: share of requests sent as the bare URL (cache hit); the rest are busted (forced miss). Use `0` for pages that are never cached (cart, checkout, customer pages). |
| `traffic` | Relative share of all traffic (normalized; `0` switches the page off). |
| `expect` | Text the response must contain (text or per-platform mapping, may use `{term}`). A 200 without it counts as an **error**: catches error pages, empty listings and maintenance pages that still return 200. |

### Sub-requests (`platforms`)

A real page view is more than the HTML. Each storefront's browser calls the backend again after the page loads, and that load is very different per platform. `platforms.<name>.calls.<page type>` lists those requests (`"*"` = every type). They run right after the page, in parallel like browser XHRs (`http.batch`), and are reported separately (`api_*` metrics). Placeholders: `{term}`, `{page_url}` (the page URL actually requested), `{ts}` (timestamp, like jQuery's `_=`), `{api_base}`, `{base_url}`. Each call can have `headers` and an `expect`.

**A planned cache miss busts the page and its sub-requests**, so a cold page view is cold end to end.

### Settings and precedence

`load`, `thresholds` and `options` use the same names as the `-e` options below (lowercase). Anything passed with `-e` wins over the plan, e.g. `-e RPS=50` or `-e BASE_URL=https://staging.example.com`.

Keep private hosts out of the shared plan with a sites file:

```yaml
# plans/local/my-sites.yml  (plans/local/ is git-ignored)
sites:
  flux: { base_url: https://flux-test.mycompany.com, api_base: https://flux-api-test.mycompany.com, platform: flux }
```
```bash
k6 run magento.js -e PLAN=plans/sample-data.yml -e SITES=plans/local/my-sites.yml -e SITE=flux
```

Unknown keys stop the run with a clear message (a typo like `cache_hits:` is never silently ignored). JSON plans work too.

## Validate before you load test

`npm run validate` sends each page **once as a cache hit and once busted**, plus that platform's sub-requests, and checks every status and `expect` text, using the same code k6 uses (no k6 needed). Run it after editing a plan or before pointing a test at a new environment:

```bash
npm run validate -- --plan plans/sample-data.yml --site luma                  # every page, hit + miss
npm run validate -- --plan plans/sample-data.yml --site flux --all-terms      # + every search term
npm run validate -- --plan plans/sample-data.yml --sites plans/local/my-sites.yml --site hyva
```
```
  ok   pdp_hero_hoodie hit       200 446ms  +1 call(s) ok
  FAIL home hit                  200 1175ms  +1 call(s) FAILED: banner_ajax 400 425ms
80/80 page views ok
```

## Comparing Luma, Hyvä and Flux

What a guest browser requests per page view on Magento sample data (captured in a fresh incognito session), and what `plans/sample-data.yml` sends:

| Storefront | After every page | After a search page |
|---|---|---|
| **Luma** (Magento Commerce) | `GET /banner/ajax/load/` (Magento_Banner dynamic blocks; uncached PHP; answers **400** without `X-Requested-With: XMLHttpRequest`). **Left out of the plan** (commented out in `platforms.luma`, uncomment to include it) | `GET /catalogsearch/searchTermsLog/save/?q=` |
| **Hyvä** | nothing | nothing |
| **Flux** (Next.js) | nothing: the page is server-rendered | Search results are **not** in the HTML. The browser fetches them from Magento GraphQL (`GET`, cacheable), **twice**: `getProductsList` sorted `position ASC`, then `DESC` |

Notes for reading results:
- Luma without the banner call is lighter than a real Luma visit on Adobe Commerce: every real page view adds one uncached PHP request. It's left out because it's a Magento_Banner design choice you may not want to compare against. If your store keeps the module enabled, uncomment it for a realistic Luma number.
- On Flux, category, product and CMS pages carry their data in the server-rendered HTML, so k6 loads the backend the same way a browser does. Search is the exception, which is why the plan adds the GraphQL calls. Without them, Flux search would look much cheaper than it is.
- The double Flux search request comes from Flux's `SearchProductsProvider`. Its fetch effect runs with the default sort, then the "new search term" effect switches to the search sort and triggers a second fetch. The first result is thrown away. Fixing it in Flux halves search GraphQL load; then remove `gql_search_products_resort` from the plan.
- `cache_hit` on Flux: Flux pages come back with `Cache-Control: private, no-store` and no full-page cache in front, so Next.js renders every page request anyway and `?fpc=` changes nothing for pages. It only busts the GraphQL search calls (Varnish keys on the full URL). Flux sends no cache-debug header either, so `cache_actual_hit` stays at 0 there. Compare Flux by response times, not by the hit-ratio metrics.

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

Optional columns (same meaning as the plan fields above): `type`, `expect`, and per-platform overrides `url_<platform>` / `expect_<platform>`, used with `-e PLATFORM=<platform>`. Sub-requests come from `-e PROFILE=<file>.json` (`{"platforms": {...}}`, same shape as a plan's `platforms`), and `{term}` from `-e TERMS=<file>` (one term per line).

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

All are `-e NAME=value`; names are case-insensitive (`-e url=` = `-e URL=`). In a plan, `load` / `thresholds` / `options` take the same names in lowercase; `-e` always wins. File paths are relative to `magento.js` (the repo root); `search_terms_file` inside a plan is relative to the plan.

### Target and requests
| Variable | Description | Default |
|---|---|---|
| `PLAN` | Test-plan mode: path to a YAML (or JSON) plan | – |
| `SITE` | Which of the plan's `sites` to test (optional when it has one) | – |
| `SITES` | Sites file that replaces the plan's `sites` (keep private hosts out of the plan) | – |
| `CSV` | Page-mix mode: path to the scenario CSV | – |
| `URL` | Single-page mode: target URL | – |
| `BASE_URL` | Prefix for relative urls (`/women.html`); overrides the plan site's `base_url` | – |
| `API_BASE` | Value of `{api_base}` in sub-requests (e.g. the GraphQL host); overrides the site's `api_base` | – |
| `PLATFORM` | Platform for `url_<platform>`/`expect_<platform>` columns and `PROFILE` sections (a plan sets it from the site) | – |
| `PROFILE` | CSV mode: JSON with per-platform sub-requests (`{"platforms": {...}}`) | – |
| `TERMS` | Search-terms file for `{term}` (one per line); overrides the plan's terms | – |
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
| `MAX_ERROR_RATE` | Max share of failed page requests, incl. missing `expect` text (0–1) | off |
| `MAX_API_ERROR_RATE` | Max share of failed sub-requests (0–1) | off |
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
- **errors** / **http_req_failed**: Error rate (network errors and HTTP 4xx/5xx; 2xx/3xx are fine). `errors` also counts a 200 that misses its `expect` text
- **content_missing**: Share of checked responses without their `expect` text (tag `kind: page|api`)
- **api_response_times** / **api_errors** / **api_calls_total**: The browser sub-requests from the plan's `platforms` (tag `call`)
- **page_view_time**: Page time + slowest sub-request (they run in parallel): what one page view costs on that storefront
- **cache_actual_hit**: Share of responses really served from cache
- **cache_expectation_mismatch**: Share where the cache did something other than planned (cold cache, a cookie that bypasses FPC, page not cacheable)
- **requests_total**: Requests sent

Every metric is tagged with `page`, `type` (home, category, product, search, ...) and `cache` (`hit`/`miss`), so you can filter, e.g. `response_times{type:search,cache:miss}` or `page_view_time{type:product}` in Grafana or the JSON output. Busted URLs and search terms are grouped under their page (`name` tag), so unique `?fpc=` values don't explode k6's metric series.

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
4. Test cold rendering with cache busting (`FPC=OFF`, or a low `cache_hit`)
5. Test a realistic page mix with a plan or CSV instead of one URL
6. Run `npm run validate` first: a load test against pages that 404 or return empty listings measures the wrong thing

## Troubleshooting

**Common Errors**:
- `405 Method Not Allowed`: check `METHOD` (it is uppercased for you)
- `429 Too Many Requests`: Reduce RPS/VUs
- `500 Errors`: Check application logs
- `cache_expectation_mismatch` high on "hit" requests: cache is cold, a cookie (e.g. `X-Magento-Vary`) bypasses FPC, or the page is not cacheable
- `CSV line N: ...` / `Plan pages[i] (name): ...`: fix that row or page; the message names the field
- `api_errors` with HTTP 400 on Magento AJAX calls: the call needs `headers: { X-Requested-With: XMLHttpRequest }`
- `content_missing` > 0: the page returned 200 without its `expect` text. Run `npm run validate` to see which page

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

All logic lives in `lib/` as plain JavaScript that runs in both k6 and Node: plan and CSV parsing, page weighting, cache-hit decisions, cache busting, sub-request building, cache detection, load profiles and thresholds. `magento.js` only wires it to k6. (`lib/vendor/js-yaml.js` is the vendored YAML parser, MIT.)

```bash
npm test            # = node --test test/*.test.js  (Node >= 20, no npm install needed)
```

| File | Covers |
|---|---|
| `test/plan.test.js` | YAML plans: settings → options, `-e` precedence, sites/`SITE`/`SITES`, per-platform url/expect, typo detection, terms |
| `test/sample-data.test.js` | `plans/sample-data.yml` is valid for every site; 20% search / 32% categories / 32% products; Luma only logs search terms (no banner AJAX), Flux 2 GraphQL calls, Hyvä none |
| `test/pageview.test.js` | page + sub-request URLs, `{placeholders}`, busting a miss end to end, fail-fast validation |
| `test/platform.test.js` | sub-request profiles: `"*"` + per type, headers, validation |
| `test/template.test.js` | placeholders, browser-style term encoding (`yoga+mat`), terms files |
| `test/config.test.js` | PLAN/CSV/URL modes, lowercase env names, validation of `N`, `SLEEP`, `FPC`, `BUST_KEY`, `PLATFORM` |
| `test/csv.test.js` | CSV quoting, CRLF/BOM, comments, real line numbers in errors |
| `test/scenarios.test.js` | traffic weights, `type`, per-platform overrides, `-` rows, traffic and hit-ratio distribution (seeded RNG, 200k draws) |
| `test/url.test.js` | `?`/`&`/`#fragment` handling, unique tokens |
| `test/cache.test.js` | Magento / Fastly / Cloudflare / `Age` detection, error statuses |
| `test/profile.test.js` | `MODE` executors, thresholds, CLI-compatible defaults |
| `test/k6-script.test.js` | `magento.js` imports resolve, `lib/` has no k6/Node deps or too-new syntax, no dead code |

## Smoke load test (k6 + mock Magento)

Runs the real `magento.js` under k6 against `smoke/mock-magento.js`, a local stand-in for Magento + Varnish (full-URL cache keys, `X-Magento-Cache-Debug`, `Age`, uncacheable `/checkout/`, slower misses, a banner AJAX endpoint that answers 400 without `X-Requested-With`, a GraphQL endpoint). Afterwards `smoke/verify.js` reads what the mock actually received and checks it against the plan.

```bash
npm run test:smoke  # = bash smoke/run.sh  (needs k6, Node >= 20, curl)
```

It runs six tests:
1. **CSV page mix** with search terms and `expect` checks, 3000 iterations: each page's traffic share and busted share, search spread over the term pool, unique buster tokens, a single cold miss per cacheable key, no stray URLs, k6 thresholds (no errors, ≤1% cache mismatch, p95 per hit/miss).
2. **Single URL, `FPC=OFF`, `N=2`** with CLI flags (`-u 5 -i 200`): 400 requests, all busted, all unique, no hits.
3. **Single URL, `FPC=ON`**: one cold miss, every other request a hit.
4. **CSV + `PROFILE`, magento platform**: one banner AJAX per page view, all with the XHR header, busted together with their page.
5. **YAML plan, headless site**: the `url` override is used, exactly two GraphQL calls (asc + desc) per search, both busted with a busted search. Load, thresholds and terms come from the plan.
6. **YAML plan, magento site** with `-e ITERATIONS=500` overriding the plan's 1000.

Useful on its own too: `npm run mock` starts the mock on `http://127.0.0.1:18080` (`PORT` to change) to try options without touching a real store; `GET /__stats` shows what it received, `POST /__reset` clears it.

## Validating against a real store

`npm run validate` (see [Validate before you load test](#validate-before-you-load-test)) is the third layer: it checks a plan against a real site with one request per page. `plans/sample-data.yml` passed 80/80 page views on Luma, Hyvä and Flux storefronts of the same sample-data store (all 42 search terms too, with `--all-terms`).

# Full K6 documentation

[https://k6.io/docs/](https://k6.io/docs/)
