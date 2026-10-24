import { logger } from "../logger.js";

export interface NlpItem {
  id: string;
  text: string;
  language?: string;
}

export interface NlpResult {
  id: string;
  label: "positive" | "neutral" | "negative";
  score: number;
  confidence: number;
  positive: number;
  neutral: number;
  negative: number;
  clean_text: string;
  model: string;
  model_version: string;
  warnings?: string[] | null;
  error?: string | null;
}

export interface SentimentAnalyzer {
  analyzeBatch(items: NlpItem[]): Promise<NlpResult[]>;
  health(): Promise<{ status: "up" | "down"; latencyMs?: number; model?: string; modelVersion?: string; error?: string }>;
}

export class NlpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NlpUnavailableError";
  }
}

/** HTTP client for the Python NLP service, with timeouts and retry with backoff. */
export class NlpClient implements SentimentAnalyzer {
  constructor(
    private readonly baseUrl: string,
    private readonly opts: { timeoutMs?: number; retries?: number; batchSize?: number } = {},
  ) {}

  async analyzeBatch(items: NlpItem[]): Promise<NlpResult[]> {
    const batchSize = this.opts.batchSize ?? 500;
    const results: NlpResult[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const body = await this.request<{ results: NlpResult[] }>("/analyze/batch", { items: chunk });
      results.push(...body.results);
    }
    return results;
  }

  async health() {
    const t0 = performance.now();
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      const body = (await res.json()) as { status: string; model: string; model_version: string };
      return {
        status: res.ok && body.status === "ok" ? ("up" as const) : ("down" as const),
        latencyMs: Math.round((performance.now() - t0) * 100) / 100,
        model: body.model,
        modelVersion: body.model_version,
      };
    } catch (err) {
      return { status: "down" as const, error: (err as Error).message };
    }
  }

  private async request<T>(path: string, payload: unknown): Promise<T> {
    const retries = this.opts.retries ?? 3;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
        });
        if (res.status >= 400 && res.status < 500) {
          throw Object.assign(new Error(`NLP service rejected request: ${await res.text()}`), { permanent: true });
        }
        if (!res.ok) throw new Error(`NLP service responded ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        lastError = err as Error;
        if ((err as { permanent?: boolean }).permanent) throw err;
        if (attempt < retries) {
          const delay = 200 * 3 ** attempt;
          logger.warn({ attempt: attempt + 1, delay, err: lastError.message }, "NLP request failed, retrying");
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw new NlpUnavailableError(`NLP service unavailable: ${lastError?.message}`);
  }
}
