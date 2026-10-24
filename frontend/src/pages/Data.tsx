import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Sprout, Trash2, Upload } from "lucide-react";
import { PageHeader } from "../components/Layout";
import { ErrorState, Panel } from "../components/Panel";
import { api, ApiError } from "../lib/api";
import { fmtDateTime, fmtFull } from "../lib/format";
import { useAdminKey } from "../lib/useAdminKey";
import { useApi } from "../lib/useApi";

interface IngestReport {
  batchId: string; received: number; processed: number; imported: number; skipped: number; failed: number; commentsImported: number;
  sentiment: Record<string, number>; errors: { index: number; post_id?: string; reason: string }[]; errorsTruncated: boolean;
  cache: { invalidatedKeys: number }; trendsMaterialized: number; durationMs: number; synthetic?: boolean;
}
interface Batch { batch_id: string; kind: string; file_name?: string; synthetic: boolean; status: string; received: number; processed: number; imported: number; skipped: number; failed: number; cache_keys_invalidated: number; duration_ms: number; started_at: string }

const btn = "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50";

export function ReportView({ r }: { r: IngestReport }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3 text-sm" role="status">
      <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-good" /> Batch {r.batchId} finished in {fmtFull(r.durationMs)} ms</p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
        {([["Received", r.received], ["Processed", r.processed], ["Imported", r.imported], ["Skipped (dup)", r.skipped], ["Failed", r.failed], ["Comments", r.commentsImported]] as const).map(([k, v]) => (
          <div key={k} className="rounded bg-surface p-2"><dt className="text-[11px] text-muted">{k}</dt><dd className="font-semibold tabular">{fmtFull(v)}</dd></div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-2">
        Sentiment: {r.sentiment.positive} positive, {r.sentiment.neutral} neutral, {r.sentiment.negative} negative · {r.cache.invalidatedKeys} Redis keys invalidated · {r.trendsMaterialized} trend rows materialised
      </p>
      {r.errors.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-bad">{r.failed} failed record(s){r.errorsTruncated ? " (first 100 shown)" : ""}</summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
            {r.errors.map((e, i) => <li key={i}>row {e.index}{e.post_id ? ` (${e.post_id})` : ""}: {e.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function DataPage() {
  const [adminKey, setAdminKey] = useAdminKey();
  const [keyDraft, setKeyDraft] = useState(adminKey);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState(3000);
  const [seed, setSeed] = useState(42);
  const [resetData, setResetData] = useState(false);
  const batches = useApi<Batch[]>("/api/ingestion/batches", { limit: 15 });
  const onDone = () => qc.invalidateQueries();

  const upload = useMutation({ mutationFn: (f: File) => api.upload<IngestReport>("/api/ingestion/upload", f, adminKey), onSuccess: onDone });
  const seedMut = useMutation({ mutationFn: () => api.post<IngestReport>("/api/ingestion/seed", { count, seed, reset: resetData }, adminKey), onSuccess: onDone });
  const wipe = useMutation({ mutationFn: () => api.del<{ deleted: Record<string, number> }>("/api/ingestion/data", adminKey), onSuccess: onDone });
  const authError = [upload.error, seedMut.error, wipe.error].some((e) => e instanceof ApiError && e.status === 401);

  return (
    <>
      <PageHeader title="Data ingestion" description="Upload CSV/JSON or generate a synthetic dataset. Records are validated, de-duplicated, scored by the Python NLP service, stored in MongoDB, and affected Redis cache entries are invalidated." />
      <Panel title="Admin key" subtitle="Ingestion and cache administration require the X-API-Key header (ADMIN_API_KEY in .env). Kept only for this browser tab.">
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setAdminKey(keyDraft.trim()); }}>
          <KeyRound className="h-4 w-4 text-muted" />
          <input type="password" aria-label="Admin API key" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="ADMIN_API_KEY" className="h-9 w-72 rounded-md border border-line bg-surface px-2 text-sm" />
          <button className={`${btn} border border-line hover:bg-surface-2`}>Save</button>
          <span className="text-xs text-ink-2">{adminKey ? "Key set for this session" : "No key set"}</span>
          {authError && <span className="text-xs text-bad">The server rejected the key.</span>}
        </form>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Upload a file" subtitle="CSV, JSON (array or {posts: [...]}) or NDJSON, up to 10 MB. Samples in sample-data/.">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0] ?? null); }}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line p-6 text-center text-sm text-ink-2"
          >
            <Upload className="h-6 w-6 text-muted" />
            <p>{file ? <span className="font-medium text-ink">{file.name} ({fmtFull(Math.round(file.size / 1024))} KB)</span> : "Drop a file here or choose one"}</p>
            <input ref={fileRef} type="file" accept=".csv,.json,.ndjson,.jsonl" aria-label="Choose file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} className={`${btn} border border-line hover:bg-surface-2`}>Choose file</button>
          </div>
          <button disabled={!file || !adminKey || upload.isPending} onClick={() => file && upload.mutate(file)} className={`${btn} mt-3 bg-accent text-white`}>
            <Upload className="h-4 w-4" /> {upload.isPending ? "Importing…" : "Import file"}
          </button>
          {!adminKey && <p className="mt-2 text-xs text-muted">Set the admin key first.</p>}
          {upload.isError && <ErrorState message={(upload.error as Error).message} />}
          {upload.data && <ReportView r={upload.data.data} />}
        </Panel>

        <Panel title="Generate sample dataset" subtitle="SYNTHETIC posts across 6 platforms and 30 days, with rising and fading hashtags. Clearly flagged as synthetic in MongoDB.">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-ink-2">Posts
              <input type="number" min={1} max={50000} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-sm" />
            </label>
            <label className="text-xs text-ink-2">Random seed
              <input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-sm" />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={resetData} onChange={(e) => setResetData(e.target.checked)} /> Delete existing data first
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={!adminKey || seedMut.isPending} onClick={() => seedMut.mutate()} className={`${btn} bg-accent text-white`}>
              <Sprout className="h-4 w-4" /> {seedMut.isPending ? "Generating…" : "Generate & ingest"}
            </button>
            <button
              disabled={!adminKey || wipe.isPending}
              onClick={() => window.confirm("Delete all posts, users, hashtags, comments, metrics, sentiment results and trends?") && wipe.mutate()}
              className={`${btn} border border-line text-bad hover:bg-surface-2`}
            >
              <Trash2 className="h-4 w-4" /> Delete all data
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Re-running with the same seed and count shows duplicate prevention: every record is skipped.</p>
          {seedMut.isError && <ErrorState message={(seedMut.error as Error).message} />}
          {seedMut.data && <ReportView r={seedMut.data.data} />}
          {wipe.data && <p className="mt-2 text-xs text-ink-2">Deleted: {Object.entries(wipe.data.data.deleted).map(([k, v]) => `${k} ${v}`).join(", ")}</p>}
        </Panel>
      </div>

      <Panel className="mt-4" title="Ingestion history" subtitle="ingestion_batches collection" query={batches} isEmpty={(d) => d.length === 0} emptyText="No ingestion batches yet.">
        {(d) => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1.5 pr-2 font-medium">Started</th><th className="pr-2 font-medium">Source</th><th className="pr-2 text-right font-medium">Received</th><th className="pr-2 text-right font-medium">Imported</th><th className="pr-2 text-right font-medium">Skipped</th><th className="pr-2 text-right font-medium">Failed</th><th className="pr-2 text-right font-medium">Keys invalidated</th><th className="text-right font-medium">ms</th></tr>
              </thead>
              <tbody>
                {d.map((b) => (
                  <tr key={b.batch_id} className="border-t border-line">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDateTime(b.started_at)}</td>
                    <td className="pr-2">{b.kind}{b.file_name ? ` · ${b.file_name}` : ""}{b.synthetic && <span className="ml-1 rounded bg-warn px-1 text-xs">synthetic</span>}</td>
                    <td className="pr-2 text-right">{fmtFull(b.received)}</td>
                    <td className="pr-2 text-right">{fmtFull(b.imported)}</td>
                    <td className="pr-2 text-right">{fmtFull(b.skipped)}</td>
                    <td className={`pr-2 text-right ${b.failed ? "text-bad" : ""}`}>{fmtFull(b.failed)}</td>
                    <td className="pr-2 text-right">{fmtFull(b.cache_keys_invalidated)}</td>
                    <td className="text-right">{fmtFull(b.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
