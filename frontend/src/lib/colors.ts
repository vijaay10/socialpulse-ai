export const PLATFORMS = ["twitter", "instagram", "facebook", "reddit", "youtube", "linkedin"] as const;

/** Color follows the entity: each platform owns a fixed categorical slot. */
export const PLATFORM_COLOR: Record<string, string> = {
  twitter: "var(--s1)",
  instagram: "var(--s2)",
  facebook: "var(--s3)",
  reddit: "var(--s4)",
  youtube: "var(--s5)",
  linkedin: "var(--s6)",
};
export const PLATFORM_LABEL: Record<string, string> = { twitter: "X / Twitter", instagram: "Instagram", facebook: "Facebook", reddit: "Reddit", youtube: "YouTube", linkedin: "LinkedIn" };

/** Sentiment is polarity: diverging blue <-> red with a gray neutral midpoint. */
export const SENTIMENT_COLOR: Record<string, string> = { positive: "var(--pos)", neutral: "var(--neu)", negative: "var(--neg)" };
export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
