import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

export function renderWithProviders(ui: ReactElement, route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

type Handler = (url: URL, init?: RequestInit) => { status?: number; body: unknown } | undefined;

/** Route fetch calls by path to canned responses; unknown paths return 404. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const r = handler(url, init);
    return new Response(JSON.stringify(r?.body ?? { error: "NotFound", message: "not found" }), { status: r ? (r.status ?? 200) : 404, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const cacheMeta = (status: "hit" | "miss" | "bypass") => ({ status, key: "sp:cache:v1:x:abc", namespace: "x", ttlSeconds: 60, lookupMs: 0.3, totalMs: status === "hit" ? 0.8 : 40 });
