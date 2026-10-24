import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, Legend } from "../components/ChartTooltip";
import { FilterBar } from "../components/FilterBar";
import { PageHeader } from "../components/Layout";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { RangeNote } from "../components/RangeNote";
import { SentimentBar } from "../components/SentimentBar";
import { PLATFORM_LABEL, SENTIMENT_COLOR } from "../lib/colors";
import { useFilters } from "../lib/filters";
import { fmtBucket, fmtNum, fmtPct, fmtScore } from "../lib/format";
import { useApi } from "../lib/useApi";
import { filterParams } from "../lib/useFilterParams";
import type { LabelStats, Sentiment } from "../lib/types";

const LABELS = ["positive", "neutral", "negative"] as const;
const sentimentLegend = LABELS.map((l) => ({ label: l[0].toUpperCase() + l.slice(1), color: SENTIMENT_COLOR[l] }));

export function SentimentOverTime({ data }: { data: Sentiment }) {
  return (
    <>
      <Legend items={sentimentLegend} />
      <div className="mt-2 h-64">
        <ResponsiveContainer>
          <BarChart data={data.overTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucket" tickFormatter={(v) => fmtBucket(v, data.interval)} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={36} />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip labelFormatter={(l) => fmtBucket(String(l), data.interval)} valueFormatter={(v) => fmtNum(Number(v))} />} />
            {LABELS.map((l, i) => (
              <Bar key={l} dataKey={l} name={sentimentLegend[i].label} stackId="s" fill={SENTIMENT_COLOR[l]} stroke="var(--surface)" strokeWidth={1} radius={i === 2 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function BreakdownTable<R extends LabelStats>({ rows, labelHeader, label }: { rows: R[]; labelHeader: string; label: (r: R) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1.5 pr-2 font-medium">{labelHeader}</th>
            <th className="pr-2 text-right font-medium">Posts</th>
            <th className="w-2/5 pr-2 font-medium">Split</th>
            <th className="pr-2 text-right font-medium">Net</th>
            <th className="text-right font-medium">Avg score</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={label(r)} className="border-t border-line">
              <td className="py-2 pr-2 font-medium">{label(r)}</td>
              <td className="pr-2 text-right">{fmtNum(r.total)}</td>
              <td className="pr-2">
                <SentimentBar positivePct={r.positivePct} neutralPct={r.neutralPct} negativePct={r.negativePct} showLabels={false} />
                <span className="mt-0.5 block text-[11px] text-muted">
                  {fmtPct(r.positivePct, 0)} / {fmtPct(r.neutralPct, 0)} / {fmtPct(r.negativePct, 0)}
                </span>
              </td>
              <td className="pr-2 text-right">{fmtScore(r.netSentiment)}</td>
              <td className="text-right">{fmtScore(r.avgScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SentimentPage() {
  const { filters, setFilter, reset } = useFilters();
  const q = useApi<Sentiment>("/api/analytics/sentiment", { ...filterParams(filters), hashtagLimit: 12 });
  const d = q.data?.data;
  return (
    <>
      <PageHeader title="Sentiment" description="Python NLP service (VADER) labels each post: compound ≥ 0.05 positive, ≤ −0.05 negative, otherwise neutral. VADER is English-only; other languages are flagged as low reliability.">
        <FilterBar filters={filters} setFilter={setFilter} reset={reset} />
      </PageHeader>
      <div className="mb-4">
        <RangeNote range={d?.range} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Posts analysed" value={d ? fmtNum(d.overall.total) : "…"} hint={d?.models.map((m) => m.version).join(", ")} />
        <MetricCard label="Positive" value={d ? fmtPct(d.overall.positivePct) : "…"} hint={d && `${fmtNum(d.overall.positive)} posts`} />
        <MetricCard label="Negative" value={d ? fmtPct(d.overall.negativePct) : "…"} hint={d && `${fmtNum(d.overall.negative)} posts`} />
        <MetricCard label="Net sentiment" value={d ? fmtScore(d.overall.netSentiment) : "…"} hint="(pos − neg) ÷ total" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Sentiment over time" query={q} isEmpty={(x) => x.overTime.length === 0}>
          {(x) => <SentimentOverTime data={x} />}
        </Panel>
        <Panel title="Engagement by sentiment" subtitle="Average engagement rate per post" query={q} isEmpty={(x) => x.engagementBySentiment.length === 0}>
          {(x) => (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={x.engagementBySentiment} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickFormatter={(v) => String(v)[0].toUpperCase() + String(v).slice(1)} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} width={40} />
                  <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip valueFormatter={(v) => fmtPct(Number(v), 2)} />} />
                  <Bar dataKey="avgEngagementRate" name="Avg engagement rate" radius={[4, 4, 0, 0]} label={{ position: "top", formatter: (v: unknown) => fmtPct(Number(v), 2), fill: "var(--ink-2)", fontSize: 12 }}
                    shape={(props: unknown) => {
                      const p = props as { x: number; y: number; width: number; height: number; payload: { label: string } };
                      return <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={4} fill={SENTIMENT_COLOR[p.payload.label]} />;
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="By platform" query={q} isEmpty={(x) => x.byPlatform.length === 0}>
          {(x) => <BreakdownTable rows={x.byPlatform} labelHeader="Platform" label={(r) => PLATFORM_LABEL[r.platform] ?? r.platform} />}
        </Panel>
        <Panel title="By hashtag" subtitle="Most frequent hashtags" query={q} isEmpty={(x) => x.byHashtag.length === 0}>
          {(x) => <BreakdownTable rows={x.byHashtag} labelHeader="Hashtag" label={(r) => `#${r.hashtag}`} />}
        </Panel>
        <Panel title="By topic" query={q} isEmpty={(x) => x.byTopic.length === 0}>
          {(x) => <BreakdownTable rows={x.byTopic} labelHeader="Topic" label={(r) => r.topic} />}
        </Panel>
        <Panel title="By language" subtitle="Non-English scores are low reliability (VADER limitation)" query={q} isEmpty={(x) => x.byLanguage.length === 0}>
          {(x) => <BreakdownTable rows={x.byLanguage} labelHeader="Language" label={(r) => r.language} />}
        </Panel>
      </div>
      <p className="mt-4 text-xs text-muted">Tip: click a hashtag on the Trends page to filter by it. Current hashtag filter: {filters.hashtag ? `#${filters.hashtag}` : "none"}{filters.hashtag && <button className="ml-2 underline" onClick={() => setFilter("hashtag", undefined)}>clear</button>}</p>
    </>
  );
}
