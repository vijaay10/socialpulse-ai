const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "–" : Math.abs(n) >= 10000 ? compact.format(n) : full.format(Math.round(n * 100) / 100));
export const fmtFull = (n: number | null | undefined) => (n === null || n === undefined ? "–" : full.format(n));
export const fmtPct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "–" : `${n.toFixed(digits)}%`);
export const fmtScore = (n: number | null | undefined) => (n === null || n === undefined ? "–" : (n > 0 ? "+" : "") + n.toFixed(3));
export const fmtMs = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n < 1 ? `${n.toFixed(2)} ms` : n < 100 ? `${n.toFixed(1)} ms` : `${Math.round(n)} ms`);
export const fmtDate = (s: string | Date | null | undefined) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "–");
export const fmtDateTime = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
export const fmtBucket = (s: string, interval: string) =>
  interval === "hour" ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit" }) : fmtDate(s);
