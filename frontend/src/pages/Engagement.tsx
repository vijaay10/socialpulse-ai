import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "../components/ChartTooltip";
import { FilterBar } from "../components/FilterBar";
import { PageHeader } from "../components/Layout";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { RangeNote } from "../components/RangeNote";
import { PLATFORM_COLOR, PLATFORM_LABEL, SENTIMENT_COLOR } from "../lib/colors";
import { useFilters } from "../lib/filters";
import { fmtBucket, fmtDate, fmtNum, fmtPct } from "../lib/format";
import { useApi } from "../lib/useApi";
import { filterParams } from "../lib/useFilterParams";
import type { Engagement } from "../lib/types";
import { PlatformBars } from "./Overview";

export function EngagementOverTime({ data, metric }: { data: Engagement; metric: "interactions" | "avgEngagementRate" }) {
  const fmt = metric === "interactions" ? (v: number) => fmtNum(v) : (v: number) => fmtPct(v, 2);
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data.overTime} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={(v) => fmtBucket(v, data.interval)} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v) => fmt(Number(v))} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<ChartTooltip labelFormatter={(l) => fmtBucket(String(l), data.interval)} valueFormatter={(v) => fmt(Number(v))} />} />
          <Line dataKey={metric} name={metric === "interactions" ? "Interactions" : "Avg engagement rate"} stroke="var(--s1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} type="monotone" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function corrLabel(r: number | null) {
  if (r === null) return "n/a";
  const a = Math.abs(r);
  return a < 0.1 ? "negligible" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : "strong";
}

export function EngagementPage() {
  const { filters, setFilter, reset } = useFilters();
  const q = useApi<Engagement>("/api/analytics/engagement", { ...filterParams(filters), topLimit: 10 });
  const d = q.data?.data;
  return (
    <>
      <PageHeader title="Engagement" description={`Likes, shares, comments and reach. ${d?.formula ?? "engagement_rate (%) = (likes + shares + comments) / reach × 100"}.`}>
        <FilterBar filters={filters} setFilter={setFilter} reset={reset} />
      </PageHeader>
      <div className="mb-4">
        <RangeNote range={d?.range} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Interactions" value={d ? fmtNum(d.totals.interactions) : "…"} hint={d && `${fmtNum(d.totals.avgInteractions)} per post`} />
        <MetricCard label="Likes" value={d ? fmtNum(d.totals.likes) : "…"} hint={d && `${fmtNum(d.totals.avgLikes)} avg`} />
        <MetricCard label="Shares" value={d ? fmtNum(d.totals.shares) : "…"} hint={d && `${fmtNum(d.totals.avgShares)} avg`} />
        <MetricCard label="Comments" value={d ? fmtNum(d.totals.comments) : "…"} hint={d && `${fmtNum(d.totals.avgComments)} avg`} />
        <MetricCard label="Reach" value={d ? fmtNum(d.totals.reach) : "…"} hint={d && `${fmtNum(d.totals.avgReach)} avg`} />
        <MetricCard label="Engagement rate" value={d ? fmtPct(d.totals.aggregateEngagementRate, 2) : "…"} hint={d && `mean of posts ${fmtPct(d.totals.avgEngagementRate, 2)}`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Interactions over time" query={q} isEmpty={(x) => x.overTime.length === 0}>
          {(x) => <EngagementOverTime data={x} metric="interactions" />}
        </Panel>
        <Panel title="Average engagement rate over time" query={q} isEmpty={(x) => x.overTime.length === 0}>
          {(x) => <EngagementOverTime data={x} metric="avgEngagementRate" />}
        </Panel>
        <Panel title="Engagement rate by platform" subtitle="Σ interactions ÷ Σ reach × 100" query={q} isEmpty={(x) => x.byPlatform.length === 0}>
          {(x) => <PlatformBars rows={x.byPlatform.map((p) => ({ platform: p.platform, value: p.aggregateEngagementRate ?? 0 }))} format={(v) => fmtPct(v, 2)} name="Engagement rate" />}
        </Panel>
        <Panel title="Interactions by platform" query={q} isEmpty={(x) => x.byPlatform.length === 0}>
          {(x) => <PlatformBars rows={x.byPlatform.map((p) => ({ platform: p.platform, value: p.interactions }))} format={fmtNum} name="Interactions" />}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Correlations" subtitle="Pearson r, computed inside the aggregation pipeline" query={q}>
          {(x) => (
            <ul className="space-y-3 text-sm">
              {[
                ["Sentiment score vs engagement rate", x.correlations.sentimentScoreVsEngagementRate],
                ["Sentiment strength |score| vs engagement rate", x.correlations.sentimentStrengthVsEngagementRate],
                ["Author followers vs interactions", x.correlations.followersVsInteractions],
              ].map(([label, c]) => {
                const cc = c as { n: number; r: number | null };
                return (
                  <li key={label as string} className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-2">{label as string}</span>
                    <span className="text-right">
                      <span className="font-semibold tabular">{cc.r === null ? "–" : cc.r.toFixed(3)}</span>
                      <span className="ml-1 text-xs text-muted">{corrLabel(cc.r)}</span>
                    </span>
                  </li>
                );
              })}
              <li className="text-xs text-muted">{x.correlations.note}</li>
            </ul>
          )}
        </Panel>
        <Panel title="By sentiment" subtitle="Average engagement rate" query={q} isEmpty={(x) => x.bySentiment.length === 0}>
          {(x) => (
            <ul className="space-y-2 text-sm">
              {x.bySentiment.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SENTIMENT_COLOR[s.label] }} />
                  <span className="capitalize">{s.label}</span>
                  <span className="ml-auto tabular">{fmtPct(s.avgEngagementRate, 2)}</span>
                  <span className="w-24 text-right text-xs text-muted tabular">{fmtNum(s.posts)} posts</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="By media type" subtitle="Average engagement rate" query={q} isEmpty={(x) => x.byMediaType.length === 0}>
          {(x) => (
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={x.byMediaType} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="mediaType" axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} width={40} />
                  <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip valueFormatter={(v) => fmtPct(Number(v), 2)} />} />
                  <Bar dataKey="avgEngagementRate" name="Avg engagement rate" fill="var(--s1)" radius={[4, 4, 0, 0]} label={{ position: "top", formatter: (v: unknown) => fmtPct(Number(v), 1), fill: "var(--ink-2)", fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-4" title="Top-performing posts" subtitle="By total interactions" query={q} isEmpty={(x) => x.topPosts.length === 0}>
        {(x) => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Post</th>
                  <th className="pr-2 font-medium">Platform</th>
                  <th className="pr-2 text-right font-medium">Likes</th>
                  <th className="pr-2 text-right font-medium">Shares</th>
                  <th className="pr-2 text-right font-medium">Comments</th>
                  <th className="pr-2 text-right font-medium">Reach</th>
                  <th className="pr-2 text-right font-medium">Rate</th>
                  <th className="font-medium">Sentiment</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {x.topPosts.map((p) => (
                  <tr key={p._id} className="border-t border-line align-top">
                    <td className="max-w-md py-2 pr-2">
                      <p className="line-clamp-2">{p.text}</p>
                      <p className="text-xs text-muted">{p.user.handle} · {fmtDate(p.created_at)}</p>
                    </td>
                    <td className="pr-2">
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: PLATFORM_COLOR[p.platform] }} />{PLATFORM_LABEL[p.platform]}</span>
                    </td>
                    <td className="pr-2 text-right">{fmtNum(p.engagement.likes)}</td>
                    <td className="pr-2 text-right">{fmtNum(p.engagement.shares)}</td>
                    <td className="pr-2 text-right">{fmtNum(p.engagement.comments)}</td>
                    <td className="pr-2 text-right">{fmtNum(p.engagement.reach)}</td>
                    <td className="pr-2 text-right">{fmtPct(p.engagement_rate, 2)}</td>
                    <td className="capitalize">{p.sentiment.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel className="mt-4" title="Hashtags with the most interactions" subtitle="Hashtags used in at least 3 posts" query={q} isEmpty={(x) => x.byHashtag.length === 0}>
        {(x) => (
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {x.byHashtag.map((h) => (
              <button key={h.hashtag} onClick={() => setFilter("hashtag", h.hashtag)} className="flex justify-between border-b border-line py-1 text-left hover:bg-surface-2">
                <span>#{h.hashtag}</span>
                <span className="tabular text-ink-2">{fmtNum(h.interactions)} · {fmtPct(h.aggregateEngagementRate, 2)}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
