import type { ReactNode } from "react";

export function MetricCard({ label, value, hint, delta }: { label: string; value: ReactNode; hint?: ReactNode; delta?: number | null }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
        {delta !== undefined && delta !== null && (
          <span className={delta >= 0 ? "text-good" : "text-bad"} title="Change vs previous period of equal length">
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint}
      </div>
    </div>
  );
}
