import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ApiResult } from "../lib/api";
import { CacheBadge } from "./CacheBadge";

interface PanelProps<T> {
  title: string;
  subtitle?: ReactNode;
  query?: UseQueryResult<ApiResult<T>>;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode | ((data: T) => ReactNode);
}

export function Panel<T>({ title, subtitle, query, isEmpty, emptyText, actions, className = "", children }: PanelProps<T>) {
  let body: ReactNode;
  if (!query) body = typeof children === "function" ? null : children;
  else if (query.isPending) body = <LoadingState />;
  else if (query.isError) body = <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  else if (isEmpty?.(query.data.data)) body = <EmptyState text={emptyText} />;
  else body = typeof children === "function" ? children(query.data.data) : children;

  return (
    <section className={`rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {query?.data && <CacheBadge cache={query.data.cache} clientMs={query.data.clientMs} />}
          {query?.isFetching && !query.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-label="Refreshing" />}
        </div>
      </header>
      {body}
    </section>
  );
}

export function LoadingState({ height = 180 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted" style={{ minHeight: height }} role="status">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-sm" role="alert">
      <AlertTriangle className="h-5 w-5 text-bad" />
      <p className="text-ink-2">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="rounded-md border border-line px-3 py-1 text-xs hover:bg-surface-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ text = "No data for the selected filters." }: { text?: string }) {
  return (
    <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-sm text-muted">
      <Inbox className="h-5 w-5" />
      <p>{text}</p>
    </div>
  );
}
