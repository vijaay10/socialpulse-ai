#!/usr/bin/env bash
# SocialPulse AI: show what MongoDB and Redis each do, by running the project with
# both, with MongoDB only (Redis stopped) and with Redis only (MongoDB stopped).
#
# Usage: scripts/demo-roles.sh          pause before each step (for a live demo)
#        scripts/demo-roles.sh --auto   run straight through
set -uo pipefail
cd "$(dirname "$0")/.."
API="http://localhost:4000"
KEY="$(grep -E '^ADMIN_API_KEY=' .env | cut -d= -f2-)"
AUTO=false; [ "${1:-}" = "--auto" ] && AUTO=true

B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'
title() { printf "\n${B}${C}━━━ %s ━━━${N}\n" "$1"; }
say()   { printf "${Y}» %s${N}\n" "$1"; }
run()   { printf "${B}\$ %s${N}\n" "$1"; }
pause() { $AUTO || read -rp "  [Enter] to continue " _; }

# Use host tools if installed (brew), otherwise run them inside the containers.
mongo_q() { if command -v mongosh >/dev/null; then mongosh "mongodb://localhost:27017/socialpulse" --quiet --eval "$1"; else docker compose exec -T mongo mongosh socialpulse --quiet --eval "$1"; fi; }
rcli()    { if command -v redis-cli >/dev/null; then redis-cli "$@"; else docker compose exec -T redis redis-cli "$@"; fi; }

req() { # req <label> <path>
  curl -s -o /tmp/sp_body -w "%{http_code}|%header{x-cache}|%{time_total}" "$API$2" > /tmp/sp_meta
  IFS='|' read -r code cache secs < /tmp/sp_meta
  local ms; ms=$(python3 -c "print(f'{float(\"$secs\")*1000:.1f}')")
  local colour=$G; [ "$code" -ge 500 ] && colour=$R
  local extra=""
  [ "$code" -ge 400 ] && extra=" → $(python3 -c "import json;print(json.load(open('/tmp/sp_body')).get('message',''))" 2>/dev/null)"
  printf "  %-34s ${colour}HTTP %s${N}  X-Cache=%-6s %7s ms%s\n" "$1" "$code" "${cache:--}" "$ms" "$extra"
}
health() {
  curl -s "$API/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d['services']; print(f\"  health: {d['status'].upper():9} MongoDB={s['mongodb']['status']}  Redis={s['redis']['status']}  NLP={s['nlp']['status']}\")"
}
seed() { curl -s -X POST "$API/api/ingestion/seed" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d "{\"count\":$1,\"seed\":$RANDOM,\"days\":1}" -w " HTTP %{http_code}" | python3 -c "
import json,sys; raw=sys.stdin.read(); body,code=raw.rsplit(' HTTP ',1); d=json.loads(body)
print(f\"  ingestion HTTP {code}: \" + (f\"imported {d['data']['imported']} posts, Redis keys invalidated {d['data']['cache']['invalidatedKeys']}\" if 'data' in d else d.get('message','')))"; }

title "0. Both running: MongoDB stores, Redis caches"
docker compose up -d --wait mongo redis >/dev/null 2>&1
health
say "Clear the cache, then ask the same question twice."
rcli --scan --pattern 'sp:cache:*' | while read -r k; do rcli UNLINK "$k" >/dev/null; done
req "overview (1st request)" "/api/analytics/overview?window=30d"
req "overview (2nd, identical)" "/api/analytics/overview?window=30d"
say "1st = MISS: MongoDB ran the aggregation. 2nd = HIT: Redis returned the stored result."
pause

title "1. MongoDB ON ITS OWN (Redis stopped)"
run "docker compose stop redis"; docker compose stop redis >/dev/null 2>&1; sleep 1
health
say "Every request still works, served by MongoDB (BYPASS). There is no speed-up any more:"
req "overview (1st request)" "/api/analytics/overview?window=30d"
req "overview (2nd, identical)" "/api/analytics/overview?window=30d"
req "engagement analytics" "/api/analytics/engagement?window=30d"
req "posts search 'biryani'" "/api/posts?q=biryani"
say "New data can still be stored, because MongoDB is the permanent store:"
seed 100
run "mongosh: db.posts.countDocuments()"
printf "  posts stored in MongoDB: %s\n" "$(mongo_q 'db.posts.countDocuments()')"
say "Conclusion: MongoDB alone = complete, correct application, just without caching."
pause

title "2. Redis restarts EMPTY: it only holds temporary data"
run "docker compose start redis"; docker compose up -d --wait redis >/dev/null 2>&1; sleep 2
printf "  Redis keys after restart (DBSIZE): %s\n" "$(rcli DBSIZE)"
printf "  posts still in MongoDB:            %s\n" "$(mongo_q 'db.posts.countDocuments()')"
say "Redis has no persistence by design; MongoDB kept everything."
pause

title "3. REDIS ON ITS OWN (MongoDB stopped)"
say "First cache a few dashboard requests while MongoDB is up:"
req "overview 30d (fills cache)" "/api/analytics/overview?window=30d"
req "sentiment 30d (fills cache)" "/api/analytics/sentiment?window=30d"
run "docker compose stop mongo"; docker compose stop mongo >/dev/null 2>&1; sleep 2
health
say "Questions already answered are still served from Redis:"
req "overview 30d (cached)" "/api/analytics/overview?window=30d"
req "sentiment 30d (cached)" "/api/analytics/sentiment?window=30d"
say "A new question cannot be answered, because only MongoDB has the data:"
req "trends 24h (not cached)" "/api/analytics/trends?window=24h"
req "posts list (not cached)" "/api/posts?platform=reddit"
say "And nothing can be stored:"
seed 50
run "redis-cli: what Redis is holding (keys and seconds until they expire)"
rcli --scan --pattern 'sp:cache:v1:*' | while read -r k; do printf "  %-62s TTL %ss\n" "$k" "$(rcli TTL "$k")"; done
say "Conclusion: Redis alone = fast but partial. It holds expiring copies of past answers, never the records."
pause

title "4. Both running again"
run "docker compose start mongo"; docker compose up -d --wait mongo >/dev/null 2>&1; sleep 3
health
req "trends 24h (now works)" "/api/analytics/trends?window=24h"
req "trends 24h (again)" "/api/analytics/trends?window=24h"
rm -f /tmp/sp_body /tmp/sp_meta
printf "\n${B}Summary${N}\n"
printf "  %-22s %-38s %s\n" "" "MongoDB only (Redis down)" "Redis only (MongoDB down)"
printf "  %-22s %-38s %s\n" "Cached analytics" "served from MongoDB (BYPASS)" "served from Redis (HIT)"
printf "  %-22s %-38s %s\n" "New / uncached queries" "work" "fail fast with 503"
printf "  %-22s %-38s %s\n" "Ingestion / storage" "works (permanent)" "rejected with 503"
printf "  %-22s %-38s %s\n" "Speed" "aggregation time on every request" "a few ms, until the TTL expires"
printf "  %-22s %-38s %s\n" "Health" "degraded" "down"
