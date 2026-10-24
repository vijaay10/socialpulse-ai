/**
 * Rule-based topic assignment. A topic is assigned when a hashtag or a word in
 * the text matches one of its keywords. Records may also provide topics directly.
 */
export const TOPIC_KEYWORDS: Record<string, string[]> = {
  technology: ["ai", "genai", "chatgpt", "coding", "startup", "tech", "iphone", "android", "smartphone", "gadgets", "software", "5g", "robotics", "machinelearning"],
  sports: ["cricket", "ipl", "ipl2026", "football", "worldcup", "indvsaus", "csk", "rcb", "kabaddi", "olympics", "match"],
  entertainment: ["bollywood", "kollywood", "movie", "movies", "netflix", "music", "concert", "trailer", "album", "webseries", "ott"],
  education: ["campusfest", "exams", "placements", "internship", "university", "college", "students", "hackathon", "vit"],
  food: ["biryani", "streetfood", "foodie", "chennaifood", "recipe", "restaurant", "fooddelivery", "filtercoffee"],
  travel: ["travel", "goa", "wanderlust", "trip", "flight", "roadtrip", "himalayas"],
  finance: ["stockmarket", "sensex", "nifty", "crypto", "budget2026", "investing", "upi", "fintech"],
  environment: ["climatechange", "heatwave", "chennairains", "monsoon", "sustainability", "pollution", "flood", "cyclone"],
  shopping: ["festivesale", "ecommerce", "deals", "unboxing", "customerservice", "delivery", "refund"],
  events: ["campusfest", "concert", "festival", "diwali", "pongal", "meetup", "conference"],
};

const keywordToTopics = new Map<string, string[]>();
for (const [topic, words] of Object.entries(TOPIC_KEYWORDS)) {
  for (const w of words) keywordToTopics.set(w, [...(keywordToTopics.get(w) ?? []), topic]);
}

export function deriveTopics(hashtags: string[], text: string): string[] {
  const topics = new Set<string>();
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of [...hashtags, ...words]) {
    for (const t of keywordToTopics.get(token) ?? []) topics.add(t);
  }
  return [...topics].sort();
}
