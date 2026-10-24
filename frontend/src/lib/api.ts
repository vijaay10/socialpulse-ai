export type CacheStatus = "hit" | "miss" | "bypass";

export interface CacheMeta {
  status: CacheStatus;
  key: string;
  namespace: string;
  ttlSeconds: number;
  lookupMs: number;
  totalMs: number;
  coalesced?: boolean;
  reason?: string;
}

export interface ApiResult<T> {
  data: T;
  cache?: CacheMeta;
  /** Round trip measured in the browser. */
  clientMs: number;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export type Params = Record<string, string | number | boolean | undefined | null>;

export function toQuery(params: Params = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, opts: { params?: Params; body?: unknown; adminKey?: string; form?: FormData } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.adminKey) headers["X-API-Key"] = opts.adminKey;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${toQuery(opts.params)}`, { method, headers, body });
  } catch {
    throw new ApiError(0, "Cannot reach the SocialPulse API. Is the backend running?");
  }
  const clientMs = Math.round((performance.now() - t0) * 10) / 10;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.message ?? `Request failed (${res.status})`, json?.details);
  // Most endpoints wrap results in { data, meta }; /api/health returns its body directly.
  return { data: (json && typeof json === "object" && "data" in json ? json.data : json) as T, cache: json?.meta?.cache, clientMs };
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>("GET", path, { params }),
  post: <T>(path: string, body: unknown, adminKey?: string) => request<T>("POST", path, { body, adminKey }),
  del: <T>(path: string, adminKey?: string) => request<T>("DELETE", path, { adminKey }),
  upload: <T>(path: string, file: File, adminKey?: string) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>("POST", path, { form, adminKey });
  },
};
