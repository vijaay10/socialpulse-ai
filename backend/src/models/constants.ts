export const PLATFORMS = ["twitter", "instagram", "facebook", "reddit", "youtube", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const SENTIMENT_LABELS = ["positive", "neutral", "negative"] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];
export const MEDIA_TYPES = ["image", "video", "gif", "link"] as const;
/** Current version of the posts document shape. Bump when the shape changes. */
export const POST_SCHEMA_VERSION = 2;
