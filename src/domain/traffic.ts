/**
 * Where a website visit came from. UTM tags win (they are set by us on our own links); otherwise the referrer;
 * otherwise the in-app browser's user agent (Instagram, Threads and Facebook often send no referrer, but their
 * in-app browsers name themselves). Anything else with no referrer is "direct".
 */
export const AI_SOURCES = ["chatgpt", "perplexity", "gemini", "claude", "copilot", "deepseek", "grok", "ai_other"] as const;
export const SOURCES = [
  "instagram", "threads", "youtube", "facebook", "tiktok", "x", "telegram", "whatsapp", "linkedin", "pinterest", "snapchat", "reddit",
  "google", "bing", "duckduckgo", "yandex", ...AI_SOURCES, "app_store", "email", "other", "direct",
] as const;
export const isAiSource = (s: string) => (AI_SOURCES as readonly string[]).includes(s);
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  instagram: "Instagram", threads: "Threads", youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", x: "X / Twitter",
  telegram: "Telegram", whatsapp: "WhatsApp", linkedin: "LinkedIn", pinterest: "Pinterest", snapchat: "Snapchat", reddit: "Reddit",
  google: "Google search", bing: "Bing", duckduckgo: "DuckDuckGo", yandex: "Yandex",
  chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude", copilot: "Microsoft Copilot", deepseek: "DeepSeek", grok: "Grok", ai_other: "Other AI assistants",
  app_store: "App Store", email: "Email", other: "Other sites", direct: "Direct / unknown",
};

const UTM_ALIASES: Array<[RegExp, Source]> = [
  [/^(ig|insta|instagram)/, "instagram"], [/^threads/, "threads"], [/^(yt|youtube)/, "youtube"], [/^(fb|facebook|meta)/, "facebook"],
  [/^tiktok/, "tiktok"], [/^(x|twitter)$/, "x"], [/^(tg|telegram)/, "telegram"], [/^reddit/, "reddit"], [/^google/, "google"],
  [/^bing/, "bing"], [/^(email|newsletter|mail)/, "email"], [/^(wa|whatsapp)/, "whatsapp"], [/^linkedin/, "linkedin"], [/^pinterest/, "pinterest"],
  // AI assistants tag the links they show: ChatGPT adds utm_source=chatgpt.com, others do similar.
  [/^(chatgpt|openai)/, "chatgpt"], [/^perplexity/, "perplexity"], [/^gemini/, "gemini"], [/^claude/, "claude"], [/^copilot/, "copilot"],
  [/^deepseek/, "deepseek"], [/^grok/, "grok"], [/^(you\.com|phind|mistral|meta\.ai)/, "ai_other"],
];

const HOSTS: Array<[RegExp, Source]> = [
  [/^com\.google\.android\.gm$/, "email"], // Gmail on Android (android-app:// referrer)
  [/(^|\.)instagram\.com$/, "instagram"], [/(^|\.)threads\.(net|com)$/, "threads"], [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"], [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
  [/(^|\.)(t\.me|telegram\.org|web\.telegram\.org)$/, "telegram"], [/(^|\.)reddit\.com$/, "reddit"],
  [/^gemini\.google\.com$|^bard\.google\.com$/, "gemini"], [/(^|\.)google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/, "google"],
  [/(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$/, "chatgpt"], [/(^|\.)perplexity\.ai$/, "perplexity"],
  [/(^|\.)claude\.ai$/, "claude"], [/^copilot\.microsoft\.com$/, "copilot"], [/(^|\.)deepseek\.com$/, "deepseek"], [/(^|\.)(grok\.com|x\.ai)$/, "grok"],
  [/(^|\.)(you\.com|phind\.com|chat\.mistral\.ai|meta\.ai|poe\.com|kagi\.com)$/, "ai_other"],
  [/(^|\.)bing\.com$/, "bing"], [/(^|\.)duckduckgo\.com$/, "duckduckgo"], [/(^|\.)(yandex\.[a-z]+|ya\.ru)$/, "yandex"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"], [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, "pinterest"], [/(^|\.)snapchat\.com$/, "snapchat"],
  [/(^|\.)(whatsapp\.com|wa\.me)$|^com\.whatsapp$/, "whatsapp"], [/^org\.telegram\.messenger$/, "telegram"],
  [/(^|\.)apps\.apple\.com$/, "app_store"], [/(mail\.|outlook\.|gmail)/, "email"],
];

// In-app browsers that send no referrer but name themselves in the user agent.
const AGENTS: Array<[RegExp, Source]> = [
  [/Barcelona/i, "threads"], [/Instagram/i, "instagram"], [/FBAN|FBAV|FB_IAB/i, "facebook"], [/musical_ly|BytedanceWebview|TikTok/i, "tiktok"],
  [/LinkedInApp/i, "linkedin"], [/Pinterest/i, "pinterest"], [/Snapchat/i, "snapchat"], [/Twitter/i, "x"], [/Telegram/i, "telegram"], [/WhatsApp/i, "whatsapp"],
];

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
