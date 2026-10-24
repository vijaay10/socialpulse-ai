import type { ReactNode } from "react";

interface Item {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/** Shared Recharts tooltip: text in ink colors, a colored swatch carries identity. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (v) => String(v),
}: {
  active?: boolean;
  payload?: Item[];
  label?: ReactNode;
  labelFormatter?: (l: ReactNode) => ReactNode;
  valueFormatter?: (v: number | string, name: string) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-medium text-ink tabular">{valueFormatter(p.value as number, String(p.name))}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
