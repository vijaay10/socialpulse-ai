import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Play, RefreshCw, Trash2, Zap } from "lucide-react";
import { CacheBadge } from "../components/CacheBadge";
import { ChartTooltip, Legend } from "../components/ChartTooltip";
import { PageHeader } from "../components/Layout";
import { MetricCard } from "../components/MetricCard";
import { ErrorState, Panel } from "../components/Panel";
import { api, type ApiResult } from "../lib/api";
import { fmtDateTime, fmtFull, fmtMs, fmtPct } from "../lib/format";
import { useAdminKey } from "../lib/useAdminKey";
import { useApi } from "../lib/useApi";

interface Lat { count: number; avgMs: number | null; p50Ms: number | null; p95Ms: number | null; maxMs: number | null }
interface CacheStats {
  redis: { status: string; latencyMs?: number; error?: string };
  prefix: string;
  totals: { hits: number; misses: number; requests: number; hitRatio: number | null; cachedKeys: number; invalidations: number; invalidatedKeys: number } | null;
  namespaces: { namespace: string; hits: number; misses: number; hitRatio: number | null }[];
  timeline: { minute: string; hits: number; misses: number }[];
  invalidations: { at: string; reason: string; deleted: number; patterns: string[] }[];
  server: { version: string; uptimeSeconds: number; usedMemory: string; maxMemory: string; evictionPolicy: string; connectedClients: number; keyspaceHits: number; keyspaceMisses: number; evictedKeys: number; totalKeys: number } | null;
  local: { bypasses: number; errors: number; lastError: { message: string; at: string } | null; latency: { hit: Lat; miss: Lat; redisLookup: Lat } };
  ttlSeconds: Record<string, number>;
}
interface LStats { runs: number; avgMs: number; medianMs: number; p95Ms: number; minMs: number; maxMs: number }
interface QB { name: string; mongo: LStats; cacheMiss: LStats; cacheHit: LStats; hitRatio: number; speedupMedian: number | null }
interface Dataset {
  posts: number;
  ingest?: { imported: number; durationMs: number };
  queries: QB[];
  indexEffect?: { name: string; allIndexesMedianMs: number; onlyCreatedAtIndexMedianMs: number; noSecondaryIndexesMedianMs: number }[];
  explain?: { indexed: { stages: string[]; totalKeysExamined: number; totalDocsExamined: number }; unindexed?: { stages: string[]; totalKeysExamined: number; totalDocsExamined: number } } | { stages: string[]; totalKeysExamined: number; totalDocsExamined: number; query: string };
  workload?: { requests: number; hits: number; misses: number; hitRatio: number; latency: LStats; note: string } | null;
}
interface BenchRun { run_id: string; source: "cli" | "api"; created_at: string; conditions: Record<string, unknown>; results: { datasets: Dataset[] } }

const btn = "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";

function DemoPanel() {
  const [runs, setRuns] = useState<{ label: string; r: ApiResult<unknown> }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      // A unique window anchor makes a fresh cache key, so the first call is guaranteed to miss.
      const to = new Date().toISOString();
      const params = { window: "30d", to };
      const a = await api.get("/api/analytics/engagement", params);
      const b = await api.get("/api/analytics/engagement", params);
      const c = await api.get("/api/analytics/engagement", params);
      setRuns([{ label: "Request 1", r: a }, { label: "Request 2 (identical)", r: b }, { label: "Request 3 (identical)", r: c }]);
      qc.invalidateQueries({ queryKey: ["/api/cache/stats"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Live cache-aside demo" subtitle="Sends the same engagement-analytics request three times with a new cache key." actions={<button onClick={run} disabled={busy} className={`${btn} bg-accent text-white`}><Zap className="h-4 w-4" />{busy ? "Running…" : "Run demo"}</button>}>
      {error && <ErrorState message={error} />}
      {runs.length === 0 ? (
        <p className="text-sm text-ink-2">Expected: request 1 misses Redis and runs the MongoDB aggregation, then stores the result with a TTL; requests 2 and 3 are Redis hits.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {runs.map(({ label, r }) => (
            <li key={label} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
              <span className="w-40 font-medium">{label}</span>
              <CacheBadge cache={r.cache} />
              <span className="text-xs text-ink-2 tabular">server {fmtMs(r.cache?.totalMs)} · browser round trip {fmtMs(r.clientMs)}</span>
            </li>
          ))}
          <li className="break-all text-xs text-muted">key: {runs[0].r.cache?.key}</li>
        </ul>
      )}
    </Panel>
  );
}

function BenchmarkSection() {
  const [adminKey] = useAdminKey();
  const qc = useQueryClient();
  const results = useApi<BenchRun[]>("/api/benchmark/results", { limit: 10 });
  const [selected, setSelected] = useState<string | null>(null);
  const runMut = useMutation({
    mutationFn: () => api.post<BenchRun>("/api/benchmark/run", { iterations: 30, warmup: 5, workloadRequests: 200 }, adminKey),
    onSuccess: (r) => {
      setSelected(r.data.run_id);
      qc.invalidateQueries({ queryKey: ["/api/benchmark/results"] });
    },
  });
  const runs = results.data?.data ?? [];
  const run = runs.find((r) => r.run_id === selected) ?? runs[0];

  return (
    <Panel
      className="mt-4"
      title="Benchmark: MongoDB aggregation vs Redis cache hit"
      subtitle="Measured on this machine. Warm-up runs are discarded; numbers are not estimates."
      query={results}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {runs.length > 0 && (
            <select aria-label="Benchmark run" value={run?.run_id} onChange={(e) => setSelected(e.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-sm">
              {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.source.toUpperCase()} · {fmtDateTime(r.created_at)}</option>)}
            </select>
          )}
          <button disabled={!adminKey || runMut.isPending} onClick={() => runMut.mutate()} className={`${btn} bg-accent text-white`} title={adminKey ? "" : "Set the admin key on the Data page"}>
            <Play className="h-4 w-4" />{runMut.isPending ? "Benchmarking…" : "Run quick benchmark"}
          </button>
        </div>
      }
    >
      {() => (
        <>
          {runMut.isError && <ErrorState message={(runMut.error as Error).message} />}
          {!run ? (
            <p className="text-sm text-ink-2">No benchmark runs yet. Click “Run quick benchmark” (needs the admin key) or run <code className="rounded bg-surface-2 px-1">npm run benchmark</code> in backend/ for dataset sizes and index effects.</p>
          ) : (
            <BenchmarkRunView run={run} />
          )}
        </>
      )}
    </Panel>
  );
}

function BenchmarkRunView({ run }: { run: BenchRun }) {
  const c = run.conditions as Record<string, string | number>;
  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-2">
        {String(c.cpu ?? "")} · {String(c.cpus ?? "")} cores · Node {String(c.node ?? "")} · MongoDB {String(c.mongodbVersion ?? "")} · {String(c.warmupRuns)} warm-up + {String(c.measuredRuns)} measured runs per mode · {String(c.timing ?? "")}
      </p>
      {run.results.datasets.map((d) => {
        const chart = d.queries.map((q) => ({ name: q.name, mongo: q.mongo.medianMs, hit: q.cacheHit.medianMs }));
        return (
          <div key={d.posts}>
            <h3 className="mb-2 text-sm font-semibold">{fmtFull(d.posts)} posts{d.ingest ? ` · ingested in ${fmtFull(d.ingest.durationMs)} ms` : ""}</h3>
            <Legend items={[{ label: "MongoDB aggregation (median)", color: "var(--s1)" }, { label: "Redis cache hit (median)", color: "var(--s2)" }]} />
            <div className="mt-2 h-64">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: "var(--axis)" }} interval={0} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => `${v} ms`} axisLine={false} tickLine={false} width={56} />
                  <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip valueFormatter={(v) => fmtMs(Number(v))} />} />
                  <Bar dataKey="mongo" name="MongoDB median" fill="var(--s1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="hit" name="Redis hit median" fill="var(--s2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs tabular">
                <thead className="text-left text-muted">
                  <tr><th className="py-1 pr-2 font-medium">Query</th><th className="pr-2 text-right font-medium">Mongo avg</th><th className="pr-2 text-right font-medium">Mongo p50</th><th className="pr-2 text-right font-medium">Mongo p95</th><th className="pr-2 text-right font-medium">Miss p50</th><th className="pr-2 text-right font-medium">Hit avg</th><th className="pr-2 text-right font-medium">Hit p50</th><th className="pr-2 text-right font-medium">Hit p95</th><th className="pr-2 text-right font-medium">Hit ratio</th><th className="text-right font-medium">Speed-up p50</th></tr>
                </thead>
                <tbody>
                  {d.queries.map((q) => (
                    <tr key={q.name} className="border-t border-line">
                      <td className="py-1 pr-2 font-medium">{q.name}</td>
                      <td className="pr-2 text-right">{fmtMs(q.mongo.avgMs)}</td><td className="pr-2 text-right">{fmtMs(q.mongo.medianMs)}</td><td className="pr-2 text-right">{fmtMs(q.mongo.p95Ms)}</td>
                      <td className="pr-2 text-right">{fmtMs(q.cacheMiss.medianMs)}</td>
                      <td className="pr-2 text-right">{fmtMs(q.cacheHit.avgMs)}</td><td className="pr-2 text-right">{fmtMs(q.cacheHit.medianMs)}</td><td className="pr-2 text-right">{fmtMs(q.cacheHit.p95Ms)}</td>
                      <td className="pr-2 text-right">{fmtPct(q.hitRatio * 100, 0)}</td>
                      <td className="text-right font-semibold">{q.speedupMedian ? `${q.speedupMedian}×` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.indexEffect && (
              <div className="mt-3 overflow-x-auto">
                <p className="mb-1 text-xs font-medium">Index effect (MongoDB median)</p>
                <table className="w-full text-xs tabular">
                  <thead className="text-left text-muted"><tr><th className="py-1 pr-2 font-medium">Query</th><th className="pr-2 text-right font-medium">All indexes</th><th className="pr-2 text-right font-medium">Only created_at index</th><th className="text-right font-medium">No secondary indexes</th></tr></thead>
                  <tbody>
                    {d.indexEffect.map((i) => (
                      <tr key={i.name} className="border-t border-line"><td className="py-1 pr-2">{i.name}</td><td className="pr-2 text-right">{fmtMs(i.allIndexesMedianMs)}</td><td className="pr-2 text-right">{fmtMs(i.onlyCreatedAtIndexMedianMs)}</td><td className="text-right">{fmtMs(i.noSecondaryIndexesMedianMs)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.explain && "indexed" in d.explain && (
              <p className="mt-2 text-xs text-ink-2">
                Query plan for posts.find(hashtag + 7-day window): with indexes {d.explain.indexed.stages.join(" ← ")} ({fmtFull(d.explain.indexed.totalDocsExamined)} docs examined)
                {d.explain.unindexed && <>; without: {d.explain.unindexed.stages.join(" ← ")} ({fmtFull(d.explain.unindexed.totalDocsExamined)} docs examined)</>}.
              </p>
            )}
            {d.workload && (
              <p className="mt-2 text-xs text-ink-2">
                Mixed workload: {fmtFull(d.workload.requests)} requests ({d.workload.note}) → hit ratio {fmtPct(d.workload.hitRatio * 100)}, p50 {fmtMs(d.workload.latency.medianMs)}, p95 {fmtMs(d.workload.latency.p95Ms)}.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CachePage() {
  const stats = useApi<CacheStats>("/api/cache/stats", undefined, { refetchInterval: 5000 });
  const [adminKey] = useAdminKey();
  const qc = useQueryClient();
  const invalidate = useMutation({
    mutationFn: (namespaces?: string[]) => api.post<{ deleted: number }>("/api/cache/invalidate", { namespaces }, adminKey),
    onSuccess: () => qc.invalidateQueries(),
  });
  const resetStats = useMutation({ mutationFn: () => api.post("/api/cache/stats/reset", {}, adminKey), onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/cache/stats"] }) });
  const s = stats.data?.data;
  const up = s?.redis.status === "up";

  return (
    <>
      <PageHeader title="Redis & performance" description="Redis is a cache only (cache-aside). MongoDB stays the source of truth; when Redis is down, requests bypass the cache and are served from MongoDB." />
      {s && !up && (
        <div className="mb-4 rounded-lg bg-warn p-3 text-sm" role="alert">
          Redis is unavailable ({s.redis.error}). Analytics are still served from MongoDB (X-Cache: BYPASS). Bypassed requests so far: {s.local.bypasses}.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Redis" value={s ? (up ? "Connected" : "Down") : "…"} hint={s && (up ? `PING ${fmtMs(s.redis.latencyMs)} · v${s.server?.version}` : s.redis.error)} />
        <MetricCard label="Hit ratio" value={s?.totals ? fmtPct(s.totals.hitRatio === null ? null : s.totals.hitRatio * 100) : "…"} hint={s?.totals && `${fmtFull(s.totals.hits)} hits / ${fmtFull(s.totals.misses)} misses`} />
        <MetricCard label="Hit latency p50" value={s ? fmtMs(s.local.latency.hit.p50Ms) : "…"} hint={s && `p95 ${fmtMs(s.local.latency.hit.p95Ms)}`} />
        <MetricCard label="Miss latency p50" value={s ? fmtMs(s.local.latency.miss.p50Ms) : "…"} hint={s && `p95 ${fmtMs(s.local.latency.miss.p95Ms)} (MongoDB)`} />
        <MetricCard label="Cached keys" value={s?.totals ? fmtFull(s.totals.cachedKeys) : "…"} hint={s?.server && `memory ${s.server.usedMemory} / ${s.server.maxMemory === "0B" ? "∞" : s.server.maxMemory}`} />
        <MetricCard label="Invalidations" value={s?.totals ? fmtFull(s.totals.invalidations) : "…"} hint={s?.totals && `${fmtFull(s.totals.invalidatedKeys)} keys removed`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <DemoPanel />
        <Panel
          title="Hits and misses per minute"
          subtitle="Last 30 minutes (Redis-backed counters)"
          query={stats}
          isEmpty={(d) => !d.timeline.length}
          emptyText="Redis is down; no counters available."
          actions={<button onClick={() => stats.refetch()} className="rounded p-1 hover:bg-surface-2" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>}
        >
          {(d) => (
            <>
              <Legend items={[{ label: "Hits", color: "var(--s1)" }, { label: "Misses", color: "var(--s2)" }]} />
              <div className="mt-2 h-56">
                <ResponsiveContainer>
                  <BarChart data={d.timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="minute" tickFormatter={(v) => new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={30} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={32} />
                    <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip labelFormatter={(l) => new Date(String(l)).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} />} />
                    <Bar dataKey="hits" name="Hits" stackId="c" fill="var(--s1)" stroke="var(--surface)" strokeWidth={1} />
                    <Bar dataKey="misses" name="Misses" stackId="c" fill="var(--s2)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="By namespace" subtitle="Cache key: <prefix>:cache:v1:<namespace>:sha1(normalised params)" query={stats} isEmpty={(d) => d.namespaces.length === 0} emptyText="No cached requests yet: open the dashboards.">
          {(d) => (
            <table className="w-full text-sm tabular">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 pr-2 font-medium">Namespace</th><th className="pr-2 text-right font-medium">Hits</th><th className="pr-2 text-right font-medium">Misses</th><th className="pr-2 text-right font-medium">Hit ratio</th><th className="text-right font-medium">TTL</th></tr></thead>
              <tbody>
                {d.namespaces.map((n) => {
                  const group = n.namespace.split(":")[1] ?? n.namespace;
                  const ttl = d.ttlSeconds[n.namespace.startsWith("posts") ? "posts" : group.startsWith("trends") ? "trends" : group];
                  return (
                    <tr key={n.namespace} className="border-t border-line">
                      <td className="py-1.5 pr-2 font-mono text-xs">{n.namespace}</td>
                      <td className="pr-2 text-right">{fmtFull(n.hits)}</td>
                      <td className="pr-2 text-right">{fmtFull(n.misses)}</td>
                      <td className="pr-2 text-right">{n.hitRatio === null ? "–" : fmtPct(n.hitRatio * 100)}</td>
                      <td className="text-right">{ttl ? `${ttl}s` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Administration" subtitle={adminKey ? "Using the admin key from the Data page" : "Set the admin key on the Data page"}>
          <div className="flex flex-col gap-2">
            <button disabled={!adminKey || invalidate.isPending} onClick={() => invalidate.mutate(undefined)} className={`${btn} border border-line hover:bg-surface-2`}><Trash2 className="h-4 w-4" /> Invalidate all cached analytics</button>
            <button disabled={!adminKey || invalidate.isPending} onClick={() => invalidate.mutate(["analytics:trends"])} className={`${btn} border border-line hover:bg-surface-2`}><Trash2 className="h-4 w-4" /> Invalidate trends only</button>
            <button disabled={!adminKey || resetStats.isPending} onClick={() => resetStats.mutate()} className={`${btn} border border-line hover:bg-surface-2`}><RefreshCw className="h-4 w-4" /> Reset hit/miss counters</button>
            {invalidate.data && <p className="text-xs text-ink-2">Deleted {invalidate.data.data.deleted} keys.</p>}
            {(invalidate.isError || resetStats.isError) && <p className="text-xs text-bad">{((invalidate.error ?? resetStats.error) as Error).message}</p>}
          </div>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Recent invalidations</h3>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-ink-2">
            {(s?.invalidations ?? []).length === 0 && <li className="text-muted">None yet.</li>}
            {s?.invalidations.map((i, idx) => <li key={idx}>{fmtDateTime(i.at)} · {i.reason} · {i.deleted} keys</li>)}
          </ul>
          {s?.server && (
            <p className="mt-4 text-xs text-muted">Eviction {s.server.evictionPolicy} · {s.server.connectedClients} clients · server keyspace hits {fmtFull(s.server.keyspaceHits)} / misses {fmtFull(s.server.keyspaceMisses)} · evicted {fmtFull(s.server.evictedKeys)}</p>
          )}
        </Panel>
      </div>

      <BenchmarkSection />
    </>
  );
}
