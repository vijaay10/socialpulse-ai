import { parse } from "csv-parse/sync";

export class ParseError extends Error {
  status = 400;
}

export type UploadFormat = "csv" | "json" | "ndjson";

export function detectFormat(fileName: string, mimeType?: string): UploadFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || mimeType === "text/csv") return "csv";
  if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) return "ndjson";
  if (lower.endsWith(".json") || mimeType === "application/json") return "json";
  return null;
}

/**
 * CSV columns map directly onto record fields. Nested values may be given as
 * JSON strings (e.g. a `media` column) and hashtags as a space/comma list.
 */
export function parseCsv(content: string): Record<string, unknown>[] {
  let rows: Record<string, string>[];
  try {
    rows = parse(content, { columns: (h: string[]) => h.map((c) => c.trim()), skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } catch (err) {
    throw new ParseError(`Invalid CSV: ${(err as Error).message}`);
  }
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === "") continue;
      if ((k === "media" || k === "replies" || k === "user" || k === "engagement") && /^[[{]/.test(v)) {
        try {
          out[k] = JSON.parse(v);
          continue;
        } catch {
          /* keep as string; validation will report it */
        }
      }
      out[k] = v;
    }
    return out;
  });
}

export function parseJson(content: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new ParseError(`Invalid JSON: ${(err as Error).message}`);
  }
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["posts", "data", "records", "items"]) if (Array.isArray(obj[key])) return obj[key] as unknown[];
    return [data];
  }
  throw new ParseError("JSON must be an array of records or an object with a 'posts' array");
}

export function parseNdjson(content: string): unknown[] {
  const out: unknown[] = [];
  content.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push({ __parse_error: `line ${i + 1} is not valid JSON` });
    }
  });
  return out;
}

export function parseUpload(content: string, format: UploadFormat): unknown[] {
  if (format === "csv") return parseCsv(content);
  if (format === "ndjson") return parseNdjson(content);
  return parseJson(content);
}
