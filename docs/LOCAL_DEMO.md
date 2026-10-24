# Running and inspecting SocialPulse AI on a Mac

A copy-paste guide for running the whole stack locally and inspecting MongoDB and Redis directly. It was verified on an Apple Silicon (M2 Pro) Mac running macOS 15.7, Docker Desktop 28.5 and Compose v2.40.

By default MongoDB and Redis run as **official Docker images** (`mongo:7.0` and `redis:7.4-alpine`, native arm64). They can also be installed natively with Homebrew (section 10), which puts `mongosh` and `redis-cli` directly on the Mac. Without a native install, use them inside the containers with `docker compose exec`.

## 1. Prerequisites

| Tool | Check | If missing |
|---|---|---|
| Docker Desktop | `docker info` | Download from https://www.docker.com/products/docker-desktop/. Choose **Mac with Apple chip** for M1–M4 or **Mac with Intel chip** for Intel Macs; `uname -m` prints `arm64` or `x86_64`. Install it, open it once and accept its licence yourself. |
| Node.js ≥ 20.19 | `node -v` | Only needed to run tests or the dev servers outside Docker (https://nodejs.org) |
| Python ≥ 3.10 | `python3 --version` | Only needed to run the NLP tests outside Docker |

## 2. Configure `.env`

```bash
cp .env.example .env
```

Generate an admin key and paste it as the value of `ADMIN_API_KEY` in `.env`:

```bash
openssl rand -hex 24
```

- `MONGODB_URI=mongodb://localhost:27017/socialpulse` and `REDIS_URL=redis://localhost:6379` are for processes on the Mac (tests, `npm run dev`, the benchmark CLI).
- Inside Docker the backend uses service names instead. `docker-compose.yml` sets `mongodb://mongo:27017/socialpulse`, `redis://redis:6379` and `http://nlp:8000`.
- `.env` is listed in `.gitignore`. Never commit it, and share `.env.example` (which has no secrets) instead.

## 3. Start everything

`--wait` blocks until every health check passes. The first run pulls the images and builds the app containers.

```bash
docker compose up -d --build --wait
```

```bash
docker compose ps
```

| Service | Address on the Mac | Health check |
|---|---|---|
| mongo | `localhost:27017` | `mongosh --eval "db.adminCommand('ping')"` |
| redis | `localhost:6379` | `redis-cli ping` |
| nlp | `localhost:8000` | `GET /health` |
| backend | http://localhost:4000 (Swagger at `/api/docs`) | `GET /api/health/live` |
| frontend | **http://localhost:8080** (dashboard) | nginx `/` |

MongoDB data lives in the named volume `socialpulse_mongo-data` and survives `docker compose down` and restarts. Redis has persistence disabled and an LRU eviction policy (256 MB `allkeys-lru`), because it only holds cache data.

## 4. Load data

Seed 5,000 SYNTHETIC posts, replacing existing social data. You can also use **Data ingestion → Generate & ingest** in the dashboard.

```bash
curl -X POST localhost:4000/api/ingestion/seed -H "X-API-Key: $(grep ^ADMIN_API_KEY .env | cut -d= -f2)" -H "Content-Type: application/json" -d '{"count":5000,"seed":2026,"reset":true}'
```

Upload a file:

```bash
curl -X POST localhost:4000/api/ingestion/upload -H "X-API-Key: $(grep ^ADMIN_API_KEY .env | cut -d= -f2)" -F file=@sample-data/sample-posts.csv
```

## 5. Inspect MongoDB with mongosh

Open an interactive shell inside the container:

```bash
docker compose exec mongo mongosh socialpulse
```

Useful queries inside `mongosh`:

```javascript
show collections
db.posts.countDocuments()
db.posts.findOne({ hashtags: "chennairains" })
db.posts.find({ platform: "instagram", "sentiment.label": "negative" }, { text: 1, engagement: 1, _id: 0 }).sort({ created_at: -1 }).limit(5)
db.sentiment_results.findOne({ target_type: "post" })
db.engagement_metrics.find().limit(3)
db.users.find().sort({ followers: -1 }).limit(3)
db.hashtags.find().sort({ total_count: -1 }).limit(10)
db.trends.find({ kind: "hashtag", window: "7d", platform: "all" }).sort({ rank: 1 }).limit(5)
db.ingestion_batches.find({}, { batch_id: 1, imported: 1, skipped: 1, failed: 1, _id: 0 }).sort({ started_at: -1 }).limit(5)
db.posts.getIndexes()
```

Aggregation: top hashtags in the 7 days up to the newest post. This is the same pipeline the API uses.

```javascript
const to = db.posts.find().sort({ created_at: -1 }).limit(1).next().created_at;
const from = new Date(to - 7 * 86400000);
db.posts.aggregate([
  { $match: { created_at: { $gte: from, $lte: to } } },
  { $unwind: "$hashtags" },
  { $group: { _id: "$hashtags", posts: { $sum: 1 }, interactions: { $sum: "$interactions" } } },
  { $sort: { posts: -1 } },
  { $limit: 5 }
])
```

Aggregation: engagement rate by platform.

```javascript
db.posts.aggregate([
  { $group: { _id: "$platform", i: { $sum: "$interactions" }, r: { $sum: "$engagement.reach" } } },
  { $project: { ratePct: { $round: [{ $multiply: [{ $divide: ["$i", "$r"] }, 100] }, 2] } } },
  { $sort: { ratePct: -1 } }
])
```

Check that a query uses an index. Expect `IXSCAN` on `hashtags_created`:

```javascript
db.posts.find({ hashtags: "ai", created_at: { $gte: from } }).explain("executionStats").executionStats
```

One-off command without opening the shell:

```bash
docker compose exec -T mongo mongosh socialpulse --quiet --eval 'db.posts.countDocuments()'
```

## 6. Inspect Redis with redis-cli

Open an interactive shell inside the container:

```bash
docker compose exec redis redis-cli
```

Useful commands inside `redis-cli`. Use `SCAN` rather than `KEYS` on a busy server.

```
PING
DBSIZE
SCAN 0 MATCH sp:cache:* COUNT 1000
TTL sp:cache:v1:analytics:overview:<hash>
GET sp:cache:v1:analytics:overview:<hash>
STRLEN sp:cache:v1:analytics:overview:<hash>
HGETALL sp:stats:hits
HGETALL sp:stats:misses
LRANGE sp:stats:invalidations 0 4
INFO stats
INFO memory
CONFIG GET maxmemory-policy
```

`MONITOR` streams every Redis command live. Leave it running in a second terminal while you click around the dashboard to see `GET` (lookup), `SET … EX` (store with TTL) and `UNLINK` (invalidation):

```bash
docker compose exec redis redis-cli MONITOR
```

List every cached key with its remaining TTL from the Mac terminal:

```bash
for k in $(docker compose exec -T redis redis-cli --scan --pattern 'sp:cache:v1:*'); do echo "$k TTL=$(docker compose exec -T redis redis-cli TTL $k)"; done
```

## 7. Demonstrate cache miss → hit → invalidation

First request: `X-Cache: MISS`, the MongoDB aggregation runs (about 20 ms):

```bash
curl -s -o /dev/null -w "%header{x-cache} %header{x-response-time-ms}ms\n" "localhost:4000/api/analytics/overview?window=7d&platform=instagram"
```

Run the same command again: `X-Cache: HIT`, served from Redis (under 1 ms).

Ingest new posts. The response reports `invalidatedKeys`, and the next overview request is a MISS with the new totals:

```bash
curl -s -X POST localhost:4000/api/ingestion/seed -H "X-API-Key: $(grep ^ADMIN_API_KEY .env | cut -d= -f2)" -H "Content-Type: application/json" -d '{"count":300,"seed":777,"days":1}'
```

To show the Redis-down fallback, stop Redis. Requests keep returning 200 with `X-Cache: BYPASS`, and `/api/health` reports `degraded`:

```bash
docker compose stop redis
```

```bash
docker compose start redis
```

In the dashboard, the **Redis & performance** page has a **Run demo** button that performs the miss/hit sequence and shows the key and timings.

## 8. Tests

Backend tests need the containers running. They use the `socialpulse_test` database and a random `sp:test:*` Redis namespace, and clean up afterwards.

```bash
cd backend && npm ci && npm test
```

```bash
cd frontend && npm ci && npm test
```

```bash
cd nlp-service && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest
```

End-to-end acceptance check through the dashboard's nginx proxy:

```bash
scripts/smoke-test.sh
```

## 9. Stop or reset

Stop the containers and keep MongoDB data:

```bash
docker compose down
```

Stop the containers and **delete** all MongoDB data:

```bash
docker compose down -v
```

Follow the backend logs:

```bash
docker compose logs -f backend
```

## 10. Native MongoDB and Redis (Homebrew)

These were installed and verified on this Mac (MongoDB Community 7.0.45, mongosh 2.13.0, Redis 8.10.2). The full backend test suite passes against the native servers as well as against Docker.

### Install

```bash
brew install redis
```

```bash
brew tap mongodb/brew
```

Homebrew 6 asks you to trust third-party taps. `mongodb/brew` is MongoDB Inc.'s official tap (github.com/mongodb/homebrew-brew):

```bash
brew trust mongodb/brew
```

```bash
brew install mongodb/brew/mongodb-community@7.0
```

- The MongoDB formula pulls in Homebrew's `node` as a dependency of `mongosh`. If you already use another Node.js (for example 22.x from nodejs.org), restore it as the default with `brew unlink node`. `mongosh` keeps working because it calls Homebrew's Node by absolute path.
- Config files: `/opt/homebrew/etc/mongod.conf` and `/opt/homebrew/etc/redis.conf`. MongoDB data lives in `/opt/homebrew/var/mongodb`.

### Using the host tools with the Docker containers

The installed CLIs connect to the Docker containers on the default ports. No `docker exec` is needed:

```bash
mongosh "mongodb://localhost:27017/socialpulse"
```

```bash
redis-cli -p 6379
```

### Running SocialPulse on the native servers instead of Docker

Only one server can own each port, so stop the Docker containers for MongoDB and Redis first. Their data stays in the Docker volume.

```bash
docker compose stop mongo redis
```

Start the native servers as background services. This also starts them at login; use `brew services stop …` to undo.

```bash
brew services start mongodb/brew/mongodb-community@7.0
```

```bash
brew services start redis
```

Alternatively, start them only for the current terminal session, without login services:

```bash
mongod --config /opt/homebrew/etc/mongod.conf
```

```bash
redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save "" --appendonly no
```

Then run the app on the Mac. `.env` already points at `localhost:27017` and `localhost:6379`, and the NLP service can stay in Docker (`docker compose up -d nlp`).

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm run dev
```

The dashboard is then at http://localhost:5173. The native MongoDB starts empty (separate data directory from Docker), so seed it from the Data ingestion page.

Switch back to Docker:

```bash
brew services stop redis && brew services stop mongodb/brew/mongodb-community@7.0 && docker compose up -d --wait
```

## 11. Show MongoDB and Redis individually

`scripts/demo-roles.sh` runs the project with both databases, then with each one alone, and narrates what happens. It stops and starts the Docker containers itself and pauses before each step. Use `--auto` to run straight through.

```bash
scripts/demo-roles.sh
```

| Step | What it does | What it proves |
|---|---|---|
| 0. Both running | Same overview request twice | MISS (MongoDB aggregation, ~60 ms), then HIT (Redis, ~4 ms) |
| 1. MongoDB on its own | `docker compose stop redis`, repeat requests, ingest 100 posts, count with mongosh | Everything works and is stored permanently; every request is `BYPASS` at aggregation speed; health `degraded` |
| 2. Redis restarts | `docker compose start redis`, `DBSIZE`, count posts | Redis comes back **empty** (temporary data only); MongoDB still has every post |
| 3. Redis on its own | Cache two requests, `docker compose stop mongo`, request again plus new queries, try to ingest, list keys and TTLs | Cached answers are still served (`HIT`); new questions and ingestion fail fast with 503 ("MongoDB is unavailable…"); health `down`; Redis holds only expiring copies |
| 4. Both again | `docker compose start mongo` | Automatic reconnect; MISS, then HIT |

To show this in the **dashboard** instead: open http://localhost:8080 so the Overview panels get cached, run `docker compose stop mongo`, and reload. The sidebar shows MongoDB down and Redis up, the Overview panels still render with "Redis HIT" badges, and the Trends page (24 hours, not cached) shows "MongoDB is unavailable". Run `docker compose start mongo` to recover. With `docker compose stop redis`, every page works and the badges read `BYPASS`.

## 12. Visual tools: MongoDB Compass and Redis Insight

Both are free official GUIs, installed on this Mac with Homebrew casks:

```bash
brew install --cask mongodb-compass redis-insight
```

| | MongoDB Compass | Redis Insight |
|---|---|---|
| Connect to | `mongodb://localhost:27017/socialpulse` | `redis://localhost:6379` |
| Open pre-connected | `open -a "MongoDB Compass" --args "mongodb://localhost:27017/socialpulse"` | `open "redisinsight://databases/connect?redisUrl=redis://localhost:6379&databaseAlias=SocialPulse"` |
| Where to look | **socialpulse** database → `posts` (Documents, Schema, Indexes, Aggregations, Explain Plan) | **Browser**: `sp:cache:v1:*` keys with type, size and live TTL; `sp:stats:*` hashes; **Workbench** for commands |
| What it shows | Permanent documents that stay until deleted | Cached copies that count down and vanish when their TTL ends, or immediately after an import |

On first launch each app asks you to accept its terms and privacy settings. The Redis cache only holds recently requested results, so reload a dashboard page before browsing it.
