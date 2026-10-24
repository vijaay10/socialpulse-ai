#!/usr/bin/env bash
# End-to-end acceptance check against a running stack.
# Usage: scripts/smoke-test.sh [base_url]   (default http://localhost:8080, use :4000 for the API directly)
set -euo pipefail
BASE="${1:-http://localhost:8080}"
KEY="$(grep -E '^ADMIN_API_KEY=' "$(dirname "$0")/../.env" | cut -d= -f2-)"
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "SocialPulse smoke test against $BASE"
health="$(curl -fsS "$BASE/api/health")"
[ "$(echo "$health" | json "d['services']['mongodb']['status']")" = up ] && pass "MongoDB connected" || fail "MongoDB"
[ "$(echo "$health" | json "d['services']['redis']['status']")" = up ] && pass "Redis connected" || fail "Redis"
[ "$(echo "$health" | json "d['services']['nlp']['status']")" = up ] && pass "NLP service up" || fail "NLP"

before="$(curl -fsS "$BASE/api/analytics/overview?window=all" | json "d['data']['totals']['posts']")"
seed="$(curl -fsS -X POST "$BASE/api/ingestion/seed" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d "{\"count\":200,\"seed\":$RANDOM}")"
imported="$(echo "$seed" | json "d['data']['imported']")"
[ "$imported" -gt 0 ] && pass "Seeded $imported synthetic posts (stored with sentiment)" || fail "seed"

q="$BASE/api/analytics/trends?window=7d&platform=instagram&limit=5"
c1="$(curl -fsS -o /dev/null -w '%header{x-cache}' "$q")"
c2="$(curl -fsS -o /dev/null -w '%header{x-cache}' "$q")"
[ "$c1" = MISS ] && [ "$c2" = HIT ] && pass "First request MISS, identical second request HIT" || fail "cache miss/hit ($c1, $c2)"

after="$(curl -fsS "$BASE/api/analytics/overview?window=all" | json "d['data']['totals']['posts']")"
[ "$after" -eq $((before + imported)) ] && pass "Analytics reflect new records ($before -> $after posts)" || fail "post count $before + $imported != $after"

curl -fsS -X POST "$BASE/api/ingestion/upload" -H "X-API-Key: $KEY" -F "file=@$(dirname "$0")/../sample-data/invalid-posts.json" | json "d['data']['failed']" | grep -q '^[1-9]' && pass "Invalid upload reports failed records" || fail "invalid upload"
tmp="$(mktemp -t socialpulse).json"
printf '[{"post_id":"smoke_%s","platform":"instagram","text":"Smoke test post, loving it #smoketest","created_at":"%s","user_id":"smoke_user","likes":5,"reach":100}]' "$RANDOM$RANDOM" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp"
curl -fsS -X POST "$BASE/api/ingestion/upload" -H "X-API-Key: $KEY" -F "file=@$tmp" | json "d['data']['imported']" | grep -q '^1$' && pass "JSON upload imported 1 record" || fail "upload"
rm -f "$tmp"
c3="$(curl -fsS -o /dev/null -w '%header{x-cache}' "$q")"
[ "$c3" = MISS ] && pass "Ingestion invalidated cached trends" || fail "invalidation ($c3)"

code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/analytics/overview?platform=myspace")"
[ "$code" = 400 ] && pass "Invalid request rejected with 400" || fail "validation ($code)"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ingestion/seed")"
[ "$code" = 401 ] && pass "Admin endpoint requires X-API-Key" || fail "auth ($code)"

ratio="$(curl -fsS "$BASE/api/cache/stats" | json "d['data']['totals']['hitRatio']")"
pass "Cache stats available (hit ratio $ratio)"
echo "All checks passed."
