import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export interface Filters {
  window: string;
  platform?: string;
  hashtag?: string;
  sentiment?: string;
  language?: string;
}

const KEYS = ["window", "platform", "hashtag", "sentiment", "language"] as const;

/** Filters live in the URL so views are shareable and survive reloads. */
export function useFilters(defaultWindow = "30d") {
  const [sp, setSp] = useSearchParams();
  const filters = useMemo<Filters>(() => {
    const f: Filters = { window: sp.get("window") ?? defaultWindow };
    for (const k of KEYS) if (k !== "window" && sp.get(k)) f[k] = sp.get(k)!;
    return f;
  }, [sp, defaultWindow]);
  const setFilter = useCallback(
    (key: keyof Filters, value: string | undefined) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          next.delete("page");
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );
  const reset = useCallback(() => setSp(new URLSearchParams(), { replace: true }), [setSp]);
  return { filters, setFilter, reset };
}
