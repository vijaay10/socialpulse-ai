import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { PLATFORMS, PLATFORM_LABEL } from "../lib/colors";
import type { Filters } from "../lib/filters";

const WINDOWS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const selectCls = "h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink focus:outline-2 focus:outline-accent";

export function FilterBar({ filters, setFilter, reset, hide = [] }: { filters: Filters; setFilter: (k: keyof Filters, v: string | undefined) => void; reset: () => void; hide?: (keyof Filters)[] }) {
  const show = (k: keyof Filters) => !hide.includes(k);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      {show("window") && (
        <select aria-label="Time window" className={selectCls} value={filters.window} onChange={(e) => setFilter("window", e.target.value)}>
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      )}
      {show("platform") && (
        <select aria-label="Platform" className={selectCls} value={filters.platform ?? ""} onChange={(e) => setFilter("platform", e.target.value || undefined)}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
      )}
      {show("sentiment") && (
        <select aria-label="Sentiment" className={selectCls} value={filters.sentiment ?? ""} onChange={(e) => setFilter("sentiment", e.target.value || undefined)}>
          <option value="">All sentiment</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
        </select>
      )}
      {show("language") && (
        <select aria-label="Language" className={selectCls} value={filters.language ?? ""} onChange={(e) => setFilter("language", e.target.value || undefined)}>
          <option value="">All languages</option>
          <option value="en">English</option>
          <option value="hi">Hindi</option>
          <option value="ta">Tamil</option>
        </select>
      )}
      {show("hashtag") && <HashtagInput key={filters.hashtag ?? ""} value={filters.hashtag ?? ""} onCommit={(v) => setFilter("hashtag", v)} />}
      <button onClick={reset} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink-2 hover:bg-surface-2" title="Reset filters">
        <RotateCcw className="h-3.5 w-3.5" /> Reset
      </button>
    </div>
  );
}

/** Keyed by the committed value, so an external filter change resets the draft. */
function HashtagInput({ value, onCommit }: { value: string; onCommit: (v: string | undefined) => void }) {
  const [tag, setTag] = useState(value);
  const commit = () => {
    const next = tag.replace(/^#/, "").trim().toLowerCase() || undefined;
    if (next !== (value || undefined)) onCommit(next);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input aria-label="Hashtag filter" placeholder="#hashtag" value={tag} onChange={(e) => setTag(e.target.value)} onBlur={commit} className={`${selectCls} w-32`} />
    </form>
  );
}
