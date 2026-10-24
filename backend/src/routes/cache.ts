import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { requireAdmin } from "../middleware/auth.js";

const NAMESPACES = ["analytics:overview", "analytics:trends", "analytics:sentiment", "analytics:engagement", "posts:"] as const;

export function cacheRouter(ctx: AppContext) {
  const r = Router();
  const admin = requireAdmin(ctx.config.ADMIN_API_KEY);

  r.get("/stats", async (_req, res) => {
    res.json({ data: { ...(await ctx.cache.stats()), ttlSeconds: ctx.config.cacheTtl } });
  });

  r.post("/invalidate", admin, async (req, res) => {
    const body = z.object({ namespaces: z.array(z.enum(NAMESPACES)).max(10).optional() }).parse(req.body ?? {});
    const result = await ctx.cache.invalidate(body.namespaces ?? [], "manual (API)");
    res.json({ data: result });
  });

  r.post("/stats/reset", admin, async (_req, res) => {
    await ctx.cache.resetStats();
    res.json({ data: { reset: true } });
  });
  return r;
}
