import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, Legend } from "../components/ChartTooltip";
import { FilterBar } from "../components/FilterBar";
import { PageHeader } from "../components/Layout";
import { Panel } from "../components/Panel";
import { RangeNote } from "../components/RangeNote";
import { PLATFORM_COLOR, PLATFORM_LABEL, SERIES } from "../lib/colors";
import { useFilters } from "../lib/filters";
import { fmtBucket, fmtNum, fmtPct, fmtScore } from "../lib/format";
import { useApi } from "../lib/useApi";
import { filterParams } from "../lib/useFilterParams";
import type { Rising, TrendItem, Trends } from "../lib/types";

const prefix = (kind: string) => (kind === "hashtag" ? "#" : "");

export function TrendList({ items, kind = "hashtag" }: { items: TrendItem[]; kind?: string }) {
  return (
    <ol className="space-y-2">
      {items.map((t) => (
        <li key={t.key} className="flex items-center gap-2 text-sm">
          <span className="w-5 text-xs text-muted tabular">{t.rank}</span>
          <span className="font-medium">{prefix(kind)}{t.key}</span>
          <ChangePill item={t} />
          <span className="ml-auto text-xs text-ink-2 tabular" title="current vs previous window">
            {fmtNum(t.count)} <span className="text-muted">vs {fmtNum(t.previousCount)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ChangePill({ item }: { item: TrendItem }) {
  if (item.status === "new") return <span className="rounded bg-[color-mix(in_srgb,var(--s7)_15%,transparent)] px-1.5 text-[11px] font-medium">NEW</span>;
  if (item.changePct === null) return null;
  const up = item.changePct >= 0;
  return <span className={`text-xs font-medium tabular ${up ? "text-good" : "text-bad"}`}>{up ? "▲" : "▼"} {Math.abs(item.changePct).toFixed(0)}%</span>;
}

export function TrendsPage() {
  const { filters, setFilter, reset } = useFilters("7d");
  const [kind, setKind] = useState<"hashtag" | "topic">("hashtag");
  const params = { ...filterParams(filters), kind };
  const trends = useApi<Trends>("/api/analytics/trends", { ...params, limit: 15 });
  const rising = useApi<Rising>("/api/analytics/trends/rising", { ...params, window: filters.window === "all" ? "7d" : filters.window, limit: 10, minCount: 3 });

  return (
    <>
      <PageHeader title="Trends" description="Top and rising hashtags/topics. Counts come from $unwind + $group over the time window; growth compares with the previous window of equal length.">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-line p-0.5" role="tablist" aria-label="Trend kind">
            {(["hashtag", "topic"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded px-3 py-1 text-sm capitalize ${kind === k ? "bg-surface-2 font-medium" : "text-ink-2"}`}>
                {k}s
              </button>
            ))}
          </div>
          <FilterBar filters={filters} setFilter={setFilter} reset={reset} />
        </div>
      </PageHeader>
      <div className="mb-4">
        <RangeNote range={trends.data?.data.range} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={`Top ${kind}s`} subtitle="Ranked by frequency in the current window" query={trends} isEmpty={(d) => d.items.length === 0}>
          {(d) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">#</th>
                    <th className="pr-2 font-medium">{kind}</th>
                    <th className="pr-2 text-right font-medium">Posts</th>
                    <th className="pr-2 text-right font-medium">Previous</th>
                    <th className="pr-2 text-right font-medium">Change</th>
                    <th className="pr-2 text-right font-medium">Interactions</th>
                    <th className="pr-2 text-right font-medium">Eng. rate</th>
                    <th className="pr-2 text-right font-medium">Sentiment</th>
                    <th className="font-medium">Platforms</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {d.items.map((t) => (
                    <tr key={t.key} className="border-t border-line">
                      <td className="py-1.5 pr-2 text-muted">{t.rank}</td>
                      <td className="pr-2 font-medium">
                        {kind === "hashtag" ? (
                          <button className="hover:underline" onClick={() => setFilter("hashtag", t.key)}>#{t.key}</button>
                        ) : (
                          t.key
                        )}
                      </td>
                      <td className="pr-2 text-right">{fmtNum(t.count)}</td>
                      <td className="pr-2 text-right text-ink-2">{fmtNum(t.previousCount)}</td>
                      <td className="pr-2 text-right"><ChangePill item={t} /></td>
                      <td className="pr-2 text-right">{fmtNum(t.interactions)}</td>
                      <td className="pr-2 text-right">{fmtPct(t.engagementRate, 2)}</td>
                      <td className="pr-2 text-right">{fmtScore(t.avgSentiment)}</td>
                      <td>
                        <span className="flex gap-1">
                          {t.platforms.map((p) => (
                            <span key={p} title={PLATFORM_LABEL[p]} className="h-2.5 w-2.5 rounded-sm" style={{ background: PLATFORM_COLOR[p] }} />
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Rising" subtitle="Biggest growth vs previous window" query={rising} isEmpty={(d) => d.rising.length === 0}>
            {(d) => <TrendList items={d.rising} kind={kind} />}
          </Panel>
          <Panel title="Falling" query={rising} isEmpty={(d) => d.falling.length === 0} emptyText="Nothing is declining.">
            {(d) => <TrendList items={d.falling} kind={kind} />}
          </Panel>
        </div>
      </div>

      <Panel className="mt-4" title={`Top ${kind}s over time`} subtitle="Top 5 of the current ranking" query={trends} isEmpty={(d) => d.series.points.length === 0}>
        {(d) => (
          <>
            <Legend items={d.series.keys.map((k, i) => ({ label: `${prefix(kind)}${k}`, color: SERIES[i] }))} />
            <div className="mt-2 h-72">
              <ResponsiveContainer>
                <LineChart data={d.series.points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucket" tickFormatter={(v) => fmtBucket(v, d.interval)} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => fmtBucket(String(l), d.interval)} />} />
                  {d.series.keys.map((k, i) => (
                    <Line key={k} dataKey={k} name={`${prefix(kind)}${k}`} stroke={SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} type="monotone" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>

      <Panel className="mt-4" title="Platform-specific rankings" subtitle="Top 5 per platform in the current window" query={trends} isEmpty={(d) => d.byPlatform.length === 0}>
        {(d) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.byPlatform.map((p) => (
              <div key={p.platform} className="rounded-lg bg-surface-2 p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PLATFORM_COLOR[p.platform] }} />
                  {PLATFORM_LABEL[p.platform] ?? p.platform}
                  <span className="ml-auto text-xs font-normal text-muted">{fmtNum(p.total)} tag uses</span>
                </p>
                <ol className="space-y-1 text-sm">
                  {p.items.map((it) => (
                    <li key={it.key} className="flex justify-between">
                      <span>{it.rank}. {prefix(kind)}{it.key}</span>
                      <span className="text-ink-2 tabular">{fmtNum(it.count)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
