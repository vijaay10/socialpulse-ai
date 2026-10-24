import type { Range } from "../lib/types";
import { fmtDateTime } from "../lib/format";

export function RangeNote({ range }: { range?: Range }) {
  if (!range) return null;
  return (
    <p className="text-xs text-muted">
      {range.from ? `${fmtDateTime(range.from)} → ${fmtDateTime(range.to)}` : `All posts up to ${fmtDateTime(range.to)}`}
      {range.anchor === "latest_post" && " · window anchored at the newest post"}
    </p>
  );
}
