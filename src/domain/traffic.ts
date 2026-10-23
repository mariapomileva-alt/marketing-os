/**
 * Where a website visit came from. UTM tags win (they are set by us on our own links); otherwise the referrer;
 * otherwise the in-app browser's user agent (Instagram, Threads and Facebook often send no referrer, but their
 * in-app browsers name themselves). Anything else with no referrer is "direct".
 */
export const SOURCES = ["instagram", "threads", "youtube", "facebook", "tiktok", "x", "telegram", "reddit", "google", "bing", "app_store", "email", "other", "direct"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  instagram: "Instagram", threads: "Threads", youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", x: "X / Twitter",
  telegram: "Telegram", reddit: "Reddit", google: "Google search", bing: "Bing", app_store: "App Store", email: "Email", other: "Other sites", direct: "Direct / unknown",
};

const UTM_ALIASES: Array<[RegExp, Source]> = [
  [/^(ig|insta|instagram)/, "instagram"], [/^threads/, "threads"], [/^(yt|youtube)/, "youtube"], [/^(fb|facebook|meta)/, "facebook"],
  [/^tiktok/, "tiktok"], [/^(x|twitter)$/, "x"], [/^(tg|telegram)/, "telegram"], [/^reddit/, "reddit"], [/^google/, "google"],
  [/^bing/, "bing"], [/^(email|newsletter|mail)/, "email"],
];

const HOSTS: Array<[RegExp, Source]> = [
  [/(^|\.)instagram\.com$/, "instagram"], [/(^|\.)threads\.(net|com)$/, "threads"], [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"], [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
  [/(^|\.)(t\.me|telegram\.org|web\.telegram\.org)$/, "telegram"], [/(^|\.)reddit\.com$/, "reddit"], [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "bing"], [/(^|\.)apps\.apple\.com$/, "app_store"], [/(mail\.|outlook\.|gmail)/, "email"],
];

const AGENTS: Array<[RegExp, Source]> = [[/Barcelona/i, "threads"], [/Instagram/i, "instagram"], [/FBAN|FBAV|FB_IAB/i, "facebook"], [/musical_ly|BytedanceWebview|TikTok/i, "tiktok"]];

export function classifySource(input: { utmSource?: string | null; referrer?: string | null; userAgent?: string | null; ownHost?: string | null }): { source: Source; referrerHost: string | null } {
  let referrerHost: string | null = null;
  try {
    referrerHost = input.referrer ? new URL(input.referrer).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    referrerHost = null;
  }
  if (referrerHost && input.ownHost && referrerHost === input.ownHost.replace(/^www\./, "")) referrerHost = null; // moving between our own pages
  const utm = (input.utmSource ?? "").trim().toLowerCase();
  if (utm) {
    const hit = UTM_ALIASES.find(([re]) => re.test(utm));
    return { source: hit ? hit[1] : "other", referrerHost };
  }
  const ua = input.userAgent ?? "";
  const byAgent = AGENTS.find(([re]) => re.test(ua));
  if (byAgent) return { source: byAgent[1], referrerHost };
  if (referrerHost) {
    const hit = HOSTS.find(([re]) => re.test(referrerHost!));
    return { source: hit ? hit[1] : "other", referrerHost };
  }
  return { source: "direct", referrerHost };
}

export function deviceOf(userAgent: string | null | undefined): "mobile" | "desktop" {
  return /Mobi|iPhone|iPad|Android/i.test(userAgent ?? "") ? "mobile" : "desktop";
}

export const isBot = (ua: string | null | undefined) => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom/i.test(ua);

/** Tags to put on our own links, so the source is known even when the app sends no referrer. */
export const LINK_PLACEMENTS = [
  { key: "instagram_bio", label: "Instagram bio", source: "instagram", medium: "bio" },
  { key: "instagram_story", label: "Instagram stories (link sticker)", source: "instagram", medium: "story" },
  { key: "youtube_channel", label: "YouTube channel description and links", source: "youtube", medium: "channel" },
  { key: "youtube_video", label: "YouTube video description", source: "youtube", medium: "video" },
  { key: "threads_bio", label: "Threads bio", source: "threads", medium: "bio" },
  { key: "threads_post", label: "Threads post", source: "threads", medium: "post" },
] as const;

export function taggedUrl(base: string, p: { source: string; medium: string; key: string }) {
  const u = new URL(base);
  u.searchParams.set("utm_source", p.source);
  u.searchParams.set("utm_medium", p.medium);
  u.searchParams.set("utm_campaign", p.key);
  return u.toString();
}

/** App Store campaign link: installs per campaign appear in App Store Connect → Analytics → Sources. */
export function appStoreCampaignUrl(appStoreUrl: string, providerToken: string, campaign: string) {
  const u = new URL(appStoreUrl);
  u.searchParams.set("pt", providerToken);
  u.searchParams.set("ct", campaign.slice(0, 40));
  u.searchParams.set("mt", "8");
  return u.toString();
}
