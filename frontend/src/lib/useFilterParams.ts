import type { Filters } from "./filters";

export const filterParams = (f: Filters) => ({ window: f.window, platform: f.platform, hashtag: f.hashtag, sentiment: f.sentiment, language: f.language });
