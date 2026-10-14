#!/bin/sh
# ローカル（wrangler dev）の受信APIを curl で確かめる。値は .secrets/local.json（ダミー）から読み、画面には出さない。
# 使い方: npm run dev（別の端末）→ sh scripts/smoke-local.sh
set -eu
cd "$(dirname "$0")/.."
BASE="${BASE:-http://127.0.0.1:8787}"
get() { node -e 'const s=require("./.secrets/local.json");const k=process.argv[1].split(".");let v=s;for(const x of k)v=v[x];process.stdout.write(v)' "$1"; }
TEST_WRITE_URL="$BASE/ingest/v1/vehicle-1/$(get vehicles.vehicle-1.token)"
TEST_DEVICE_ID="$(get vehicles.vehicle-1.deviceId)"
TEST_VIEW_TOKEN="$(get viewToken)"
TEST_TS="$(date +%s)"
code() { curl --silent --output /dev/null --write-out '%{http_code}' "$@"; }

echo "health: $(code "$BASE/health")"
echo "fix (POST form): $(code -X POST "$TEST_WRITE_URL" --data-urlencode "id=$TEST_DEVICE_ID" --data-urlencode "timestamp=$TEST_TS" \
  --data-urlencode "lat=35.6100" --data-urlencode "lon=139.5550" --data-urlencode "speed=10" --data-urlencode "batt=0" --data-urlencode "accuracy=8")"
echo "heartbeat: $(code -X POST "$TEST_WRITE_URL" --data-urlencode "id=$TEST_DEVICE_ID" --data-urlencode "timestamp=$((TEST_TS + 5))" --data-urlencode "batt=55")"
echo "old resend: $(code -X POST "$TEST_WRITE_URL" --data-urlencode "id=$TEST_DEVICE_ID" --data-urlencode "timestamp=$((TEST_TS - 100))" --data-urlencode "lat=35.0" --data-urlencode "lon=139.0")"
echo "wrong device: $(code -X POST "$TEST_WRITE_URL" --data-urlencode "id=other" --data-urlencode "timestamp=$TEST_TS" --data-urlencode "lat=1" --data-urlencode "lon=1")"
echo "view without key: $(code "$BASE/api/v1/vehicles")"
echo "view:"
curl --silent --show-error --fail-with-body -H "Authorization: Bearer $TEST_VIEW_TOKEN" "$BASE/api/v1/vehicles" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const b=JSON.parse(d);for(const v of b.vehicles)console.log(" ",v.vehicleId,v.name,v.position?`lat=${v.position.lat} lon=${v.position.lon} speedKmh=${v.position.speedKmh} acc=${v.position.accuracyM}`:"position=null","batt="+v.batteryPct,"contact="+(v.lastContactAtMs?"yes":"no"))})'
echo "preflight from allowed origin: $(code -X OPTIONS -H 'Origin: http://127.0.0.1:8790' -H 'Access-Control-Request-Method: GET' "$BASE/api/v1/vehicles")"
echo "preflight from other origin: $(code -X OPTIONS -H 'Origin: https://evil.example' "$BASE/api/v1/vehicles")"
