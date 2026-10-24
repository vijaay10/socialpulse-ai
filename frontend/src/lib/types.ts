export interface Range {
  from: string | null;
  to: string;
  window: string;
  anchor: string;
}

export interface Overview {
  range: Range;
  totals: {
    posts: number; uniqueUsers: number; uniqueHashtags: number; storedComments: number; likes: number; shares: number; comments: number; reach: number;
    interactions: number; avgEngagementRate: number | null; aggregateEngagementRate: number | null; avgSentiment: number | null; syntheticPosts: number;
  };
  previousPeriod: { postsChangePct: number | null; interactionsChangePct: number | null; avgSentiment: number | null } | null;
  sentiment: { distribution: Record<string, number>; percentages: Record<string, number> };
  platforms: { platform: string; posts: number; interactions: number; reach: number; engagementRate: number | null; avgSentiment: number | null }[];
  topHashtags: { hashtag: string; count: number }[];
  topTopics: { topic: string; count: number }[];
}

export interface TrendItem {
  rank: number; key: string; count: number; previousCount: number; changePct: number | null; status: string; interactions: number;
  engagementRate: number | null; avgSentiment: number | null; positivePct: number; negativePct: number; platforms: string[];
}

export interface Trends {
  kind: string; range: Range; previousRange: { from: string; to: string } | null; interval: string; items: TrendItem[];
  byPlatform: { platform: string; total: number; items: { rank: number; key: string; count: number; interactions: number }[] }[];
  series: { keys: string[]; points: Record<string, number | string>[] };
}

export interface Rising { kind: string; range: Range; previousRange: { from: string; to: string }; minCount: number; growthFormula: string; rising: TrendItem[]; falling: TrendItem[] }

export interface LabelStats { total: number; positive: number; neutral: number; negative: number; positivePct: number; neutralPct: number; negativePct: number; avgScore: number | null; netSentiment: number | null }

export interface Sentiment {
  range: Range; interval: string; overall: LabelStats;
  overTime: (LabelStats & { bucket: string })[];
  byPlatform: (LabelStats & { platform: string })[];
  byLanguage: (LabelStats & { language: string })[];
  byHashtag: (LabelStats & { hashtag: string })[];
  byTopic: (LabelStats & { topic: string })[];
  engagementBySentiment: { label: string; posts: number; avgEngagementRate: number; aggregateEngagementRate: number | null; avgInteractions: number; avgLikes: number; avgShares: number; avgComments: number }[];
  models: { model: string; version: string; posts: number }[];
}

export interface EngStats { posts: number; likes: number; shares: number; comments: number; reach: number; interactions: number; avgInteractions: number | null; avgEngagementRate: number | null; aggregateEngagementRate: number | null }

export interface Post {
  _id: string; post_id: string; platform: string; text: string; hashtags: string[]; topics: string[]; language: string; created_at: string;
  user: { user_id: string; handle: string; followers: number; verified: boolean };
  engagement: { likes: number; shares: number; comments: number; reach: number }; engagement_rate: number; interactions: number;
  media?: { type: string; url?: string }[];
  sentiment: { label: string; score: number; confidence?: number; model: string; model_version: string };
  source?: { kind: string; batch_id: string; synthetic: boolean; file_name?: string };
  schema_version: number;
}

export interface Engagement {
  range: Range; interval: string; formula: string;
  totals: EngStats & { avgLikes: number | null; avgShares: number | null; avgComments: number | null; avgReach: number | null };
  overTime: (EngStats & { bucket: string })[];
  byPlatform: (EngStats & { platform: string })[];
  byMediaType: (EngStats & { mediaType: string })[];
  bySentiment: (EngStats & { label: string })[];
  byHashtag: (EngStats & { hashtag: string })[];
  topPosts: Post[];
  correlations: { note: string; sentimentScoreVsEngagementRate: { n: number; r: number | null }; sentimentStrengthVsEngagementRate: { n: number; r: number | null }; followersVsInteractions: { n: number; r: number | null } };
}
