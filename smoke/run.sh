#!/usr/bin/env bash
# Smoke load test: runs the real magento.js under k6 against a local mock
# Magento/Varnish (smoke/mock-magento.js), then checks what the mock received.
# Needs: k6, node >= 20, curl.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-18080}"
BASE="http://127.0.0.1:${PORT}"
K6="${K6:-k6}"

PORT="$PORT" node smoke/mock-magento.js &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -sf "$BASE/__stats" >/dev/null && break
  sleep 0.1
done
curl -sf "$BASE/__stats" >/dev/null || { echo "mock server did not start"; exit 1; }

reset() { curl -sf -X POST "$BASE/__reset" >/dev/null; }

echo "=== 1/3 CSV page mix (MODE=iterations, thresholds on) ==="
reset
"$K6" run --quiet magento.js \
  -e CSV=smoke/scenarios.smoke.csv -e BASE_URL="$BASE" \
  -e MODE=iterations -e VUS=20 -e ITERATIONS=3000 \
  -e MAX_ERROR_RATE=0 -e MAX_MISMATCH=0.01 -e T_HIT=500 -e T_MISS=2000
node smoke/verify.js mix "$BASE" smoke/scenarios.smoke.csv 3000

echo "=== 2/3 single URL, FPC=OFF, N=2 (CLI flags, like the original) ==="
reset
"$K6" run --quiet magento.js \
  -e url="$BASE/sample-product.html" -e N=2 -e MAX_ERROR_RATE=0 \
  -u 5 -i 200
node smoke/verify.js bust "$BASE" /sample-product.html 400

echo "=== 3/3 single URL, FPC=ON ==="
reset
"$K6" run --quiet magento.js \
  -e URL="$BASE/sample-product.html" -e FPC=ON -e MAX_ERROR_RATE=0 \
  -u 5 -i 200
node smoke/verify.js cache "$BASE" /sample-product.html 200

echo "=== smoke load test passed ==="
