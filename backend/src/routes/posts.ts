import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { withMongo } from "../db/mongo.js";
import { filterSchema, limitSchema } from "../analytics/filters.js";
import { getPostDetail, listPosts, POST_SORTS, type PostSort } from "../analytics/posts.js";
import { HttpError } from "../middleware/errors.js";
import { sendCached } from "./cached.js";

export function postsRouter(ctx: AppContext) {
  const r = Router();
  r.get("/", async (req, res) => {
    const f = filterSchema.parse(req.query);
    const opts = z
      .object({
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        limit: limitSchema(20, 100),
        sort: z.enum(Object.keys(POST_SORTS) as [PostSort, ...PostSort[]]).default("recent"),
        q: z.string().trim().max(200).optional().transform((s) => s || undefined),
      })
      .parse(req.query);
    sendCached(res, await ctx.cache.getOrSet("posts:list", { ...f, ...opts }, ctx.config.cacheTtl.posts, withMongo(() => listPosts(f, opts))));
  });

  r.get("/:id", async (req, res) => {
    const id = z.string().trim().min(1).max(200).parse(req.params.id);
    const result = await ctx.cache.getOrSet("posts:detail", { id }, ctx.config.cacheTtl.posts, withMongo(() => getPostDetail(id)));
    if (!result.data) throw new HttpError(404, `Post not found: ${id}`);
    sendCached(res, result);
  });
  return r;
}
