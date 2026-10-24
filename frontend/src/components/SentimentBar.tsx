import { SENTIMENT_COLOR } from "../lib/colors";
import { fmtPct } from "../lib/format";

/** 100% stacked bar of positive / neutral / negative with text labels (never color alone). */
export function SentimentBar({ positivePct, neutralPct, negativePct, showLabels = true }: { positivePct: number; neutralPct: number; negativePct: number; showLabels?: boolean }) {
  const parts = [
    { key: "positive", label: "Positive", pct: positivePct },
    { key: "neutral", label: "Neutral", pct: neutralPct },
    { key: "negative", label: "Negative", pct: negativePct },
  ];
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={parts.map((p) => `${p.label} ${fmtPct(p.pct)}`).join(", ")}>
        {parts.map((p) => (p.pct > 0 ? <div key={p.key} style={{ width: `${p.pct}%`, background: SENTIMENT_COLOR[p.key] }} title={`${p.label} ${fmtPct(p.pct)}`} /> : null))}
      </div>
      {showLabels && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {parts.map((p) => (
            <span key={p.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SENTIMENT_COLOR[p.key] }} aria-hidden />
              {p.label} <span className="font-medium text-ink tabular">{fmtPct(p.pct)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
