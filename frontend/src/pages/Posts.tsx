import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { CacheBadge } from "../components/CacheBadge";
import { FilterBar } from "../components/FilterBar";
import { PageHeader } from "../components/Layout";
import { ErrorState, LoadingState, Panel } from "../components/Panel";
import { PLATFORM_COLOR, PLATFORM_LABEL, SENTIMENT_COLOR } from "../lib/colors";
import { useFilters } from "../lib/filters";
import { fmtDateTime, fmtFull, fmtNum, fmtPct, fmtScore } from "../lib/format";
import { useApi } from "../lib/useApi";
import type { Post } from "../lib/types";

interface PostList {
  items: Post[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean };
}

interface PostDetail {
  post: Post;
  comments: { _id: string; comment_id: string; text: string; user: { handle: string }; created_at: string; sentiment: { label: string; score: number } }[];
  sentimentHistory: { model: string; model_version: string; label: string; score: number; positive: number; neutral: number; negative: number; clean_text: string; warnings?: string[]; processed_at: string }[];
  engagementHistory: { bucket: string; likes: number; shares: number; comments: number; reach: number }[];
  author: { handle: string; followers: number; post_count: number; first_seen: string; last_seen: string } | null;
}

export function SentimentChip({ label, score }: { label: string; score?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs capitalize">
      <span className="h-2 w-2 rounded-full" style={{ background: SENTIMENT_COLOR[label] }} aria-hidden />
      {label}
      {score !== undefined && <span className="text-muted tabular">{fmtScore(score)}</span>}
    </span>
  );
}

export function PostsPage() {
  const { filters, setFilter, reset } = useFilters("all");
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get("page") ?? 1);
  const sort = sp.get("sort") ?? "recent";
  const q = sp.get("q") ?? "";
  const [selected, setSelected] = useState<string | null>(null);

  const setParam = (k: string, v: string | undefined) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (v) n.set(k, v);
      else n.delete(k);
      if (k !== "page") n.delete("page");
      return n;
    });

  const list = useApi<PostList>("/api/posts", { ...filters, window: filters.window === "all" ? undefined : filters.window, page, limit: 20, sort, q: q || undefined });
  const d = list.data?.data;

  return (
    <>
      <PageHeader title="Posts" description="Raw documents from the MongoDB posts collection. Search uses the MongoDB text index on text and hashtags.">
        <FilterBar filters={filters} setFilter={setFilter} reset={reset} />
      </PageHeader>
      <Panel
        title="Posts"
        subtitle={d ? `${fmtFull(d.pagination.total)} matching posts` : undefined}
        query={list}
        isEmpty={(x) => x.items.length === 0}
        emptyText="No posts match. Try a different search or filters."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox key={q} value={q} onSearch={(v) => setParam("q", v || undefined)} />
            <select aria-label="Sort" value={sort} onChange={(e) => setParam("sort", e.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-sm">
              <option value="recent">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="engagement">Most interactions</option>
              <option value="rate">Highest engagement rate</option>
              <option value="sentiment">Most positive</option>
            </select>
          </div>
        }
      >
        {(x) => (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Post</th>
                    <th className="pr-2 font-medium">Platform</th>
                    <th className="pr-2 font-medium">Created</th>
                    <th className="pr-2 text-right font-medium">Interactions</th>
                    <th className="pr-2 text-right font-medium">Rate</th>
                    <th className="font-medium">Sentiment</th>
                  </tr>
                </thead>
                <tbody>
                  {x.items.map((p) => (
                    <tr key={p._id} onClick={() => setSelected(p._id)} className="cursor-pointer border-t border-line align-top hover:bg-surface-2">
                      <td className="max-w-lg py-2 pr-2">
                        <p className="line-clamp-2">{p.text}</p>
                        <p className="text-xs text-muted">
                          {p.user.handle} · {p.post_id}
                          {p.source?.synthetic && <span className="ml-1 rounded bg-warn px-1">synthetic</span>}
                        </p>
                      </td>
                      <td className="whitespace-nowrap pr-2">
                        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: PLATFORM_COLOR[p.platform] }} />{PLATFORM_LABEL[p.platform]}</span>
                      </td>
                      <td className="whitespace-nowrap pr-2 text-ink-2">{fmtDateTime(p.created_at)}</td>
                      <td className="pr-2 text-right tabular">{fmtNum(p.interactions)}</td>
                      <td className="pr-2 text-right tabular">{fmtPct(p.engagement_rate, 2)}</td>
                      <td className="whitespace-nowrap"><SentimentChip label={p.sentiment.label} score={p.sentiment.score} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-ink-2">Page {x.pagination.page} of {fmtFull(x.pagination.totalPages)}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setParam("page", String(page - 1))} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" /> Prev
                </button>
                <button disabled={!x.pagination.hasNext} onClick={() => setParam("page", String(page + 1))} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 disabled:opacity-40">
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>
      {selected && <PostDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function PostDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApi<PostDetail>(`/api/posts/${id}`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const d = q.data?.data;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside role="dialog" aria-label="Post details" className="h-full w-full max-w-xl overflow-y-auto bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Post details</h2>
          <div className="flex items-center gap-2">
            {q.data && <CacheBadge cache={q.data.cache} clientMs={q.data.clientMs} />}
            <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {q.isPending && <LoadingState />}
        {q.isError && <ErrorState message={(q.error as Error).message} />}
        {d && (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-base">{d.post.text}</p>
              <p className="mt-2 text-xs text-muted">
                {d.post.user.handle} · {PLATFORM_LABEL[d.post.platform]} · {fmtDateTime(d.post.created_at)} · lang {d.post.language} · schema v{d.post.schema_version}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {d.post.hashtags.map((h) => <span key={h} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">#{h}</span>)}
                {d.post.topics.map((t) => <span key={t} className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">{t}</span>)}
              </div>
            </div>
            <dl className="grid grid-cols-4 gap-2 text-center">
              {(["likes", "shares", "comments", "reach"] as const).map((k) => (
                <div key={k} className="rounded-lg bg-surface-2 p-2">
                  <dt className="text-xs capitalize text-muted">{k}</dt>
                  <dd className="font-semibold tabular">{fmtNum(d.post.engagement[k])}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-ink-2">Engagement rate {fmtPct(d.post.engagement_rate, 2)} = ({fmtFull(d.post.interactions)} interactions ÷ {fmtFull(d.post.engagement.reach)} reach) × 100</p>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sentiment results (sentiment_results)</h3>
              {d.sentimentHistory.map((s) => (
                <div key={s.model_version + s.processed_at} className="rounded-lg border border-line p-2 text-xs">
                  <SentimentChip label={s.label} score={s.score} />
                  <p className="mt-1 text-ink-2">pos {s.positive} · neu {s.neutral} · neg {s.negative} · {s.model_version}</p>
                  <p className="mt-1 text-muted">cleaned: “{s.clean_text}”</p>
                  {s.warnings && <p className="mt-1 text-bad">{s.warnings.join(", ")}</p>}
                </div>
              ))}
            </section>
            {d.engagementHistory.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Engagement snapshots (engagement_metrics)</h3>
                <table className="w-full text-xs tabular">
                  <thead className="text-left text-muted"><tr><th>Bucket</th><th className="text-right">Likes</th><th className="text-right">Shares</th><th className="text-right">Comments</th><th className="text-right">Reach</th></tr></thead>
                  <tbody>{d.engagementHistory.map((e) => <tr key={e.bucket} className="border-t border-line"><td className="py-1">{fmtDateTime(e.bucket)}</td><td className="text-right">{fmtNum(e.likes)}</td><td className="text-right">{fmtNum(e.shares)}</td><td className="text-right">{fmtNum(e.comments)}</td><td className="text-right">{fmtNum(e.reach)}</td></tr>)}</tbody>
                </table>
              </section>
            )}
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Comments ({d.comments.length})</h3>
              {d.comments.length === 0 ? <p className="text-xs text-muted">No comments stored for this post.</p> : (
                <ul className="space-y-2">
                  {d.comments.map((c) => (
                    <li key={c._id} className="rounded-lg bg-surface-2 p-2 text-xs">
                      <p>{c.text}</p>
                      <p className="mt-1 flex items-center gap-2 text-muted">{c.user.handle} · <SentimentChip label={c.sentiment.label} score={c.sentiment.score} /></p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {d.author && (
              <section className="text-xs text-ink-2">
                <h3 className="mb-1 font-semibold uppercase tracking-wide text-muted">Author (users)</h3>
                {d.author.handle} · {fmtNum(d.author.followers)} followers · {d.author.post_count} posts stored
              </section>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function SearchBox({ value, onSearch }: { value: string; onSearch: (v: string) => void }) {
  const [search, setSearch] = useState(value);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(search.trim());
      }}
      className="relative"
    >
      <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted" />
      <input aria-label="Search posts" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search text…" className="h-8 w-48 rounded-md border border-line bg-surface pl-8 pr-2 text-sm" />
    </form>
  );
}
