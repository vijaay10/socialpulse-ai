import { NavLink, Outlet } from "react-router-dom";
import { Activity, BarChart3, Database, Gauge, Hash, MessageSquareText, Smile, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../lib/api";

const NAV = [
  { to: "/", label: "Overview", icon: BarChart3 },
  { to: "/trends", label: "Trends", icon: TrendingUp },
  { to: "/sentiment", label: "Sentiment", icon: Smile },
  { to: "/engagement", label: "Engagement", icon: Activity },
  { to: "/posts", label: "Posts", icon: MessageSquareText },
  { to: "/data", label: "Data ingestion", icon: Database },
  { to: "/cache", label: "Redis & performance", icon: Gauge },
];

interface Health {
  status: string;
  services: Record<string, { status: string; latencyMs?: number }>;
}

function HealthDots() {
  // /api/health answers 503 with per-service details when MongoDB is down, so read the body whatever the status.
  const q = useQuery<Health>({
    queryKey: ["/api/health"],
    queryFn: async () => (await fetch(`${API_BASE}/api/health`)).json(),
    refetchInterval: 15000,
  });
  const services = q.data?.services;
  const items = [
    { key: "mongodb", label: "MongoDB" },
    { key: "redis", label: "Redis" },
    { key: "nlp", label: "NLP" },
  ];
  return (
    <ul className="space-y-1 text-xs text-ink-2" aria-label="Service health">
      {items.map((i) => {
        const s = services?.[i.key]?.status ?? (q.isError ? "down" : "…");
        return (
          <li key={i.key} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: s === "up" ? "#0ca30c" : s === "down" ? "#d03b3b" : "var(--muted)" }} aria-hidden />
            {i.label}
            <span className="ml-auto text-muted">{s === "up" ? `${services?.[i.key]?.latencyMs ?? ""} ms` : s}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
            <Hash className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">SocialPulse AI</p>
            <p className="text-[11px] text-muted">MongoDB + Redis analytics</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-4 pt-6 lg:block">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Services</p>
          <HealthDots />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {children}
    </div>
  );
}
