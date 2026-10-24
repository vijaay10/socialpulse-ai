import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./lib/queryClient";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/Panel";
const CachePage = lazy(() => import("./pages/Cache").then((m) => ({ default: m.CachePage })));
const DataPage = lazy(() => import("./pages/Data").then((m) => ({ default: m.DataPage })));
const EngagementPage = lazy(() => import("./pages/Engagement").then((m) => ({ default: m.EngagementPage })));
const OverviewPage = lazy(() => import("./pages/Overview").then((m) => ({ default: m.OverviewPage })));
const PostsPage = lazy(() => import("./pages/Posts").then((m) => ({ default: m.PostsPage })));
const SentimentPage = lazy(() => import("./pages/Sentiment").then((m) => ({ default: m.SentimentPage })));
const TrendsPage = lazy(() => import("./pages/Trends").then((m) => ({ default: m.TrendsPage })));

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState />}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="trends" element={<TrendsPage />} />
        <Route path="sentiment" element={<SentimentPage />} />
        <Route path="engagement" element={<EngagementPage />} />
        <Route path="posts" element={<PostsPage />} />
        <Route path="data" element={<DataPage />} />
        <Route path="cache" element={<CachePage />} />
        <Route path="*" element={<p className="text-sm text-ink-2">Page not found.</p>} />
      </Route>
    </Routes>
    </Suspense>
  );
}

const queryClient = createQueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
