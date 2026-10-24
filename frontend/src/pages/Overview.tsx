import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "../components/ChartTooltip";
import { FilterBar } from "../components/FilterBar";
import { PageHeader } from "../components/Layout";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { RangeNote } from "../components/RangeNote";
import { SentimentBar } from "../components/SentimentBar";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "../lib/colors";
import { useFilters } from "../lib/filters";
import { fmtNum, fmtPct, fmtScore } from "../lib/format";
import { useApi } from "../lib/useApi";
import { filterParams } from "../lib/useFilterParams";
import type { Engagement, Overview, Rising, Sentiment } from "../lib/types";
import { SentimentOverTime } from "./Sentiment";
import { EngagementOverTime } from "./Engagement";
import { TrendList } from "./Trends";

export function OverviewPage() {
  const { filters, setFilter, reset } = useFilters();
  const params = filterParams(filters);
  const overview = useApi<Overview>("/api/analytics/overview", params);
  const rising = useApi<Rising>("/api/analytics/trends/rising", { ...params, window: filters.window === "24h" ? "24h" : "7d", limit: 6, minCount: 3 });
  const sentiment = useApi<Sentiment>("/api/analytics/sentiment", params);
  const engagement = useApi<Engagement>("/api/analytics/engagement", params);
  const o = overview.data?.data;

  return (
    <>
      <PageHeader title="Overview" description="Trend, sentiment and engagement analytics computed with MongoDB aggregation pipelines and cached in Redis.">
        <FilterBar filters={filters} setFilter={setFilter} reset={reset} />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <RangeNote range={o?.range} />
        {o && o.totals.syntheticPosts > 0 && (
          <p className="rounded-md bg-warn px-2 py-1 text-xs text-ink">
            {fmtNum(o.totals.syntheticPosts)} of {fmtNum(o.totals.posts)} posts in view are SYNTHETIC sample data
          </p>
        )}
      </div>

      {overview.isError ? (
        <Panel title="Overview" query={overview}>
          {null}
        </Panel>
      ) : o && o.totals.posts === 0 ? (
        <Panel title="No data yet">
          <p className="text-sm text-ink-2">
            No posts match these filters. <Link className="text-accent underline" to="/data">Load the sample dataset or upload a file</Link>, or widen the time window.
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Posts" value={o ? fmtNum(o.totals.posts) : "…"} delta={o?.previousPeriod?.postsChangePct} hint={o && `${fmtNum(o.totals.uniqueUsers)} authors`} />
          <MetricCard label="Interactions" value={o ? fmtNum(o.totals.interactions) : "…"} delta={o?.previousPeriod?.interactionsChangePct} hint="likes + shares + comments" />
          <MetricCard label="Reach" value={o ? fmtNum(o.totals.reach) : "…"} />
          <MetricCard label="Engagement rate" value={o ? fmtPct(o.totals.aggregateEngagementRate, 2) : "…"} hint={o && `avg per post ${fmtPct(o.totals.avgEngagementRate, 2)}`} />
          <MetricCard label="Avg sentiment" value={o ? fmtScore(o.totals.avgSentiment) : "…"} hint="VADER compound, −1…+1" />
          <MetricCard label="Hashtags" value={o ? fmtNum(o.totals.uniqueHashtags) : "…"} hint={o && `${fmtNum(o.totals.storedComments)} comments stored`} />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Sentiment split" query={overview} isEmpty={(d) => d.totals.posts === 0}>
          {(d) => (
            <div className="space-y-4">
              <SentimentBar positivePct={d.sentiment.percentages.positive} neutralPct={d.sentiment.percentages.neutral} negativePct={d.sentiment.percentages.negative} />
              <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                {(["positive", "neutral", "negative"] as const).map((l) => (
                  <div key={l} className="rounded-lg bg-surface-2 p-2">
                    <dt className="capitalize text-muted">{l}</dt>
                    <dd className="text-base font-semibold tabular">{fmtNum(d.sentiment.distribution[l])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Panel>
        <Panel title="Top hashtags" subtitle="Most frequent in the window" query={overview} isEmpty={(d) => d.topHashtags.length === 0}>
          {(d) => (
            <ol className="space-y-2">
              {d.topHashtags.map((h, i) => (
                <li key={h.hashtag} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-muted tabular">{i + 1}</span>
                  <button className="font-medium text-ink hover:underline" onClick={() => setFilter("hashtag", h.hashtag)}>#{h.hashtag}</button>
                  <span className="relative ml-auto h-1.5 w-24 rounded bg-surface-2">
                    <span className="absolute inset-y-0 left-0 rounded bg-[var(--s1)]" style={{ width: `${(h.count / d.topHashtags[0].count) * 100}%` }} />
                  </span>
                  <span className="w-12 text-right text-xs text-ink-2 tabular">{fmtNum(h.count)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Rising now" subtitle={filters.window === "24h" ? "Last 24 hours vs the 24 hours before" : "Last 7 days vs the 7 days before"} query={rising} isEmpty={(d) => d.rising.length === 0} emptyText="No rising hashtags for these filters.">
          {(d) => <TrendList items={d.rising.slice(0, 6)} />}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Sentiment over time" query={sentiment} isEmpty={(d) => d.overTime.length === 0}>
          {(d) => <SentimentOverTime data={d} />}
        </Panel>
        <Panel title="Engagement over time" subtitle="Interactions per bucket" query={engagement} isEmpty={(d) => d.overTime.length === 0}>
          {(d) => <EngagementOverTime data={d} metric="interactions" />}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Posts by platform" query={overview} isEmpty={(d) => d.platforms.length === 0}>
          {(d) => <PlatformBars rows={d.platforms.map((p) => ({ platform: p.platform, value: p.posts }))} format={fmtNum} name="Posts" />}
        </Panel>
        <Panel title="Engagement rate by platform" subtitle="Σ interactions ÷ Σ reach × 100" query={overview} isEmpty={(d) => d.platforms.length === 0}>
          {(d) => <PlatformBars rows={d.platforms.map((p) => ({ platform: p.platform, value: p.engagementRate ?? 0 }))} format={(v) => fmtPct(v, 2)} name="Engagement rate" />}
        </Panel>
      </div>
    </>
  );
}

export function PlatformBars({ rows, format, name }: { rows: { platform: string; value: number }[]; format: (v: number) => string; name: string }) {
  const data = [...rows].sort((a, b) => b.value - a.value).map((r) => ({ ...r, label: PLATFORM_LABEL[r.platform] ?? r.platform }));
  return (
    <div style={{ height: Math.max(160, data.length * 38) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 48 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} strokeDasharray="0" />
          <XAxis type="number" tickFormatter={(v) => format(Number(v))} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={90} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip valueFormatter={(v) => format(Number(v))} />} />
          <Bar dataKey="value" name={name} radius={[0, 4, 4, 0]} label={{ position: "right", formatter: (v: unknown) => format(Number(v)), fill: "var(--ink-2)", fontSize: 12 }}>
            {data.map((d) => (
              <Cell key={d.platform} fill={PLATFORM_COLOR[d.platform] ?? "var(--s8)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
