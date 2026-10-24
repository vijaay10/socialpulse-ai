/**
 * Deterministic SYNTHETIC social-media dataset generator.
 *
 * Every record produced here is artificial: ids start with "syn_", the record
 * carries `synthetic: true`, and it is stored with source.synthetic = true.
 * Distributions are hand-tuned to look plausible (log-normal follower counts,
 * platform-specific engagement rates, hashtags that rise and fade over time),
 * not fitted to any real platform data.
 */
import { PLATFORMS, type Platform } from "../models/constants.js";

type Tone = "positive" | "neutral" | "negative";

interface ThemeDef {
  tags: string[];
  /** probability of positive / negative tone; remainder is neutral */
  tone: [number, number];
  phrases: Record<Tone, string[]>;
}

const THEMES: Record<string, ThemeDef> = {
  technology: {
    tags: ["ai", "genai", "startup", "coding", "smartphone", "5g", "gadgets"],
    tone: [0.5, 0.2],
    phrases: {
      positive: ["This new AI tool is brilliant and saves me hours every day", "Loved the demo at the startup meetup, super impressive work", "Finally a phone update that makes the battery last longer, great job", "Our hackathon prototype actually works, so happy right now"],
      neutral: ["New smartphone launch scheduled for next week in Bengaluru", "Reading about how large language models are trained", "Comparing two laptops for college, specs listed below", "The 5G rollout reached three more cities this month"],
      negative: ["The app keeps crashing after the update, really frustrating", "Terrible battery life on this phone, very disappointed", "Another startup layoff announcement today, worrying times", "AI generated spam is getting worse and it is annoying"],
    },
  },
  sports: {
    tags: ["cricket", "ipl2026", "csk", "rcb", "football", "kabaddi", "indvsaus"],
    tone: [0.5, 0.25],
    phrases: {
      positive: ["What a finish! Absolutely incredible match tonight", "Brilliant century, best innings I have seen this season", "So proud of the team, they played amazing football", "Chepauk crowd was electric, loved every minute"],
      neutral: ["Toss at 7 pm, playing XI announced shortly", "Match preview and key stats for tonight's game", "Ticket sales for the weekend fixture open tomorrow", "Rain delay expected at the stadium this evening"],
      negative: ["Awful umpiring decision ruined the game", "Worst batting collapse ever, so disappointed with the team", "Terrible scheduling, players look exhausted and injured", "Ticket prices are ridiculous this season"],
    },
  },
  entertainment: {
    tags: ["kollywood", "bollywood", "music", "concert", "netflix", "webseries", "trailer"],
    tone: [0.55, 0.2],
    phrases: {
      positive: ["The trailer looks stunning, cannot wait for the release", "Amazing concert last night, the crowd was fantastic", "This web series is so good, binge watched the whole thing", "Beautiful soundtrack, been on repeat all day"],
      neutral: ["Release date for the sequel announced for December", "Streaming this weekend: list of new arrivals", "Box office numbers for the first week are out", "Concert lineup will be revealed on Friday"],
      negative: ["Boring plot and awful dialogues, waste of money", "The sound at the concert was terrible, very disappointing", "Too many ads on the streaming app now, annoying", "The finale was a huge letdown"],
    },
  },
  education: {
    tags: ["campusfest", "placements", "internship", "exams", "hackathon", "students"],
    tone: [0.5, 0.25],
    phrases: {
      positive: ["The campus fest lineup looks incredible", "Got my internship offer today, super excited", "Great workshop on databases, learned a lot", "Our team won the hackathon, best weekend ever"],
      neutral: ["Exam timetable has been published on the portal", "Placement registration closes on Friday", "Guest lecture on NoSQL systems at 3 pm in the auditorium", "Library hours extended during the exam week"],
      negative: ["Exam results delayed again, really stressful", "The portal crashed during registration, so frustrating", "Placement season is brutal this year, feeling anxious", "Hostel wifi is terrible during exams"],
    },
  },
  food: {
    tags: ["biryani", "streetfood", "chennaifood", "foodie", "filtercoffee"],
    tone: [0.6, 0.15],
    phrases: {
      positive: ["Best biryani in town, absolutely delicious", "This street food stall is amazing and so cheap", "Perfect filter coffee to start the morning, love it", "Lovely new restaurant near the beach, great service"],
      neutral: ["Trying a new recipe for dinner tonight", "Food festival at the city grounds this weekend", "Menu prices updated at the campus canteen", "Listing the top places for breakfast in Chennai"],
      negative: ["Food was cold and the service was rude", "Overpriced and tasteless, would not recommend", "Found a hair in my order, disgusting", "Waited an hour for a table, terrible experience"],
    },
  },
  environment: {
    tags: ["chennairains", "heatwave", "climatechange", "monsoon", "sustainability", "cyclone"],
    tone: [0.2, 0.5],
    phrases: {
      positive: ["Great to see volunteers cleaning the beach this morning", "Rainwater harvesting in our area is working brilliantly", "Lovely cool weather after the rains, finally some relief", "Proud of our college for going plastic free"],
      neutral: ["IMD issues rain forecast for the next three days", "Temperature expected to touch 39 degrees today", "Cyclone update: landfall expected near the coast tomorrow", "Report on monsoon rainfall released"],
      negative: ["Streets flooded again, the drainage is a disaster", "This heatwave is unbearable, no power since morning", "Traffic is horrible because of waterlogging everywhere", "Pollution levels are scary, terrible air today"],
    },
  },
  finance: {
    tags: ["stockmarket", "sensex", "nifty", "budget2026", "upi", "investing"],
    tone: [0.35, 0.35],
    phrases: {
      positive: ["Markets rally to a record high, great day for investors", "UPI payments are so convenient, love how fast it is", "Good budget announcements for startups this year", "My SIP returns look excellent this quarter"],
      neutral: ["Sensex closes flat ahead of the policy meeting", "Budget session begins on Monday", "Quarterly results scheduled for this week", "Explainer on how index funds work"],
      negative: ["Markets crash, terrible day for my portfolio", "UPI outage again, payment failed twice", "Fuel prices up again, this is painful", "Budget ignored the middle class, very disappointing"],
    },
  },
  shopping: {
    tags: ["festivesale", "ecommerce", "unboxing", "customerservice", "fooddelivery"],
    tone: [0.3, 0.45],
    phrases: {
      positive: ["Got an amazing deal in the festive sale, so happy", "Delivery came a day early, excellent service", "Unboxing my new headphones, sound quality is great", "Customer support resolved my issue quickly, thank you"],
      neutral: ["Festive sale starts at midnight on Friday", "Order shipped, tracking number received", "Comparing prices across three shopping apps", "Return window for electronics is seven days"],
      negative: ["Worst customer service ever, still no refund", "Delivery delayed for the third time, really annoyed", "Received a damaged product and support is useless", "Fake discounts everywhere, total scam"],
    },
  },
};

const CITY_TAGS = ["chennai", "bengaluru", "mumbai", "delhi", "hyderabad", "vellore"];

/** Time profile: multiplier on a tag's base frequency given the post's age in days. */
const TAG_PROFILES: Record<string, (ageDays: number) => number> = {
  chennairains: (a) => (a < 3 ? 8 : a < 6 ? 2 : 0.4), // breaking now
  ipl2026: (a) => (a < 7 ? 4 : a < 14 ? 1.5 : 0.5), // rising this week
  genai: (a) => 1 + Math.max(0, 30 - a) / 10, // steady growth
  festivesale: (a) => (a < 4 ? 5 : 0.6), // sale this week
  budget2026: (a) => (a > 14 && a < 20 ? 6 : 0.3), // peaked two weeks ago
  heatwave: (a) => (a > 18 ? 3 : 0.5), // faded
  campusfest: (a) => (a < 10 ? 3 : 1),
};

const PLATFORM_WEIGHTS: [Platform, number][] = [["twitter", 0.32], ["instagram", 0.24], ["facebook", 0.14], ["reddit", 0.12], ["youtube", 0.1], ["linkedin", 0.08]];
const PLATFORM_RATE: Record<Platform, number> = { twitter: 0.018, instagram: 0.045, facebook: 0.012, reddit: 0.035, youtube: 0.03, linkedin: 0.022 };
const PLATFORM_PREFIX: Record<Platform, string> = { twitter: "tw", instagram: "ig", facebook: "fb", reddit: "rd", youtube: "yt", linkedin: "li" };

const NON_ENGLISH: { lang: string; texts: Record<Tone, string> }[] = [
  { lang: "hi", texts: { positive: "आज का मैच शानदार था", neutral: "कल सुबह बारिश की संभावना है", negative: "बहुत खराब सेवा, निराश हूँ" } },
  { lang: "ta", texts: { positive: "இன்றைய நிகழ்ச்சி அருமை", neutral: "நாளை மழை பெய்ய வாய்ப்பு", negative: "மிகவும் மோசமான அனுபவம்" } },
];

const REPLIES: Record<Tone, string[]> = {
  positive: ["Totally agree, love this!", "So good, thanks for sharing", "Amazing, congrats!"],
  neutral: ["Any update on this?", "Where is this?", "Noted, thanks"],
  negative: ["This is so bad", "Same problem here, really annoying", "Terrible, hope they fix it"],
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  count: number;
  seed?: number;
  days?: number;
  /** End of the generated time range (defaults to now). */
  end?: Date;
  idPrefix?: string;
}

export function generateSyntheticPosts(opts: SyntheticOptions): Record<string, unknown>[] {
  const rand = mulberry32(opts.seed ?? 42);
  const days = opts.days ?? 30;
  const end = opts.end ?? new Date();
  const idPrefix = opts.idPrefix ?? `syn${opts.seed ?? 42}`;
  const pickOne = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const weighted = <T,>(items: [T, number][]): T => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [item, w] of items) if ((r -= w) <= 0) return item;
    return items[items.length - 1][0];
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

  const allTags = Object.entries(THEMES).flatMap(([theme, def]) => def.tags.map((tag) => ({ theme, tag })));
  const userPool = Array.from({ length: Math.max(20, Math.ceil(opts.count / 6)) }, (_, i) => {
    const followers = Math.round(Math.exp(6.7 + 1.6 * normal()));
    return { user_id: `syn_u${i}`, handle: `@syn_user_${i}`, followers: Math.min(followers, 5_000_000), verified: followers > 100_000 && rand() < 0.6 };
  });

  const posts: Record<string, unknown>[] = [];
  for (let i = 0; i < opts.count; i++) {
    // Diurnal pattern: more posts in the evening (IST).
    let ageDays = rand() * days;
    const hourIst = (24 + ((end.getUTCHours() + 5.5 - (ageDays % 1) * 24) % 24)) % 24;
    if (hourIst > 1 && hourIst < 7 && rand() < 0.6) ageDays = rand() * days;
    const createdAt = new Date(end.getTime() - ageDays * 86_400_000);

    const { theme, tag } = weighted(allTags.map((t) => [t, (TAG_PROFILES[t.tag]?.(ageDays) ?? 1) as number] as [typeof t, number]));
    const def = THEMES[theme];
    const toneRoll = rand();
    const tone: Tone = toneRoll < def.tone[0] ? "positive" : toneRoll < def.tone[0] + def.tone[1] ? "negative" : "neutral";
    const platform = weighted(PLATFORM_WEIGHTS);
    const user = pickOne(userPool);

    const tags = new Set([tag]);
    if (rand() < 0.6) tags.add(pickOne(def.tags));
    if (rand() < 0.12) tags.add(pickOne(CITY_TAGS));

    let language = "en";
    let body = pickOne(def.phrases[tone]);
    if (rand() < 0.06) {
      const ne = pickOne(NON_ENGLISH);
      language = ne.lang;
      body = ne.texts[tone];
    }
    const emoji = tone === "positive" && rand() < 0.3 ? " 😍" : tone === "negative" && rand() < 0.3 ? " 😡" : "";
    const text = `${body}${emoji} ${[...tags].map((t) => `#${t}`).join(" ")}`;

    const mediaRoll = rand();
    const media =
      platform === "youtube" || (platform === "instagram" && mediaRoll < 0.4) || mediaRoll < 0.12
        ? [{ type: "video", url: `https://example.invalid/media/${i}.mp4`, width: 1920, height: 1080, duration_s: Math.round(15 + rand() * 600) }]
        : platform === "instagram" || mediaRoll < 0.35
          ? [{ type: "image", url: `https://example.invalid/media/${i}.jpg`, width: 1080, height: 1080 }]
          : undefined;

    const viral = rand() < 0.02 ? 8 + rand() * 20 : 1;
    const reach = Math.max(10, Math.round(user.followers * (0.2 + rand() * 1.3) * viral));
    const toneMul = tone === "positive" ? 1.2 : tone === "negative" ? 1.35 : 0.75;
    const mediaMul = media?.[0].type === "video" ? 1.5 : media ? 1.25 : 1;
    const rate = PLATFORM_RATE[platform] * toneMul * mediaMul * Math.exp(0.35 * normal());
    const likes = Math.round(reach * rate);
    const shares = Math.round(likes * (0.05 + rand() * 0.2));
    const comments = Math.round(likes * (0.03 + rand() * 0.12) * (tone === "negative" ? 1.6 : 1));

    const history = [1, 6, 24]
      .map((h, idx) => ({ at: new Date(createdAt.getTime() + h * 3_600_000), f: [0.35, 0.75, 1][idx] }))
      .filter((s) => s.at <= end)
      .map((s) => ({ at: s.at.toISOString(), likes: Math.round(likes * s.f), shares: Math.round(shares * s.f), comments: Math.round(comments * s.f), reach: Math.round(reach * (0.5 + s.f / 2)) }));

    const replyCount = Math.min(3, Math.floor(rand() * 4));
    const replies = Array.from({ length: replyCount }, (_, r) => {
      const rTone: Tone = rand() < 0.6 ? tone : pickOne(["positive", "neutral", "negative"] as Tone[]);
      const ru = pickOne(userPool);
      return {
        comment_id: `${idPrefix}_c${i}_${r}`,
        user: { user_id: ru.user_id, handle: ru.handle },
        text: pickOne(REPLIES[rTone]),
        created_at: new Date(Math.min(end.getTime(), createdAt.getTime() + (r + 1) * 1_800_000)).toISOString(),
      };
    });

    posts.push({
      post_id: `${idPrefix}_${PLATFORM_PREFIX[platform]}_${String(i).padStart(6, "0")}`,
      platform,
      user,
      text,
      hashtags: [...tags],
      language,
      created_at: createdAt.toISOString(),
      engagement: { likes, shares, comments, reach },
      ...(media ? { media } : {}),
      engagement_history: history,
      replies,
      synthetic: true,
    });
  }
  return posts;
}

export { PLATFORMS };
