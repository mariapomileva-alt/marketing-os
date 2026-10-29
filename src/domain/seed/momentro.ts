import type { GuardrailRule } from "../guardrails";
import type { MarketingBrief } from "../brief";

/**
 * Momentro (momentro.me): a desktop app that turns family and travel clips into one finished film. Facts are taken from
 * the team's own site and llms.txt (Oct 2026); the owner reviews them in Product & rules.
 */
export const MOMENTRO = {
  slug: "momentro",
  name: "Momentro",
  short_description: "A desktop app (Windows and Mac) that turns selected family and travel clips into one film you can review and export, without becoming a video editor.",
  category: "Desktop app · personal video (family and travel films)",
  website_url: "https://momentro.me",
  legal_restrictions:
    "Media is processed on the user's computer and is not uploaded for editing, but licensing, update checks and optional map lookups use the network: never call Momentro entirely offline. Analysis and export take real time that depends on the files and the computer: never promise instant results or a fixed time. Prices: first export free with a watermark; €9.99 per project or €39/year PRO, bought inside the app only.",
  tone_of_voice:
    "Warm, nostalgic without being sentimental, practical. Speaks to busy parents and travellers with thousands of clips they never watch. Concrete moments (the beach day, the first steps, the road trip), plain words, no editing jargon, no hype.",
  prohibited_topics: ["Other people's children shown without consent", "Comparisons that mock other editors or apps by name"],
  pain_points: [
    "Thousands of clips across phones, cameras, cards and folders that nobody watches",
    "No time or skill to edit a film",
    "Big video files that are slow to upload or share",
    "Worry about uploading family videos to the cloud",
  ],
  triggers: ["Back from a holiday", "End of the year", "A child's birthday or milestone", "Phone storage full", "A family gathering coming up"],
  desired_emotional_states: ["Relief that the film is finally done", "Joy of rewatching together", "Pride in sharing it with family"],
  customer_vocabulary: ["camera roll", "holiday video", "family film", "year in review", "too many clips", "never get round to editing"],
  advantages: [
    "Automatic first cut from selected clips, with music and titles",
    "Handles big files locally on Windows and Mac",
    "Personal media is not uploaded to create a project",
    "First export free (with a watermark)",
  ],
};

export const MOMENTRO_CLAIMS: Array<{ kind: "approved_fact" | "prohibited_claim"; statement: string; rationale: string }> = [
  { kind: "approved_fact", statement: "Momentro is a desktop app for Windows and Mac.", rationale: "momentro.me downloads" },
  { kind: "approved_fact", statement: "Momentro turns selected clips into a draft film with music and titles that you review and export.", rationale: "momentro.me home and llms.txt" },
  { kind: "approved_fact", statement: "Momentro processes selected media on your computer; personal source media does not need to be uploaded to create a project.", rationale: "llms.txt" },
  { kind: "approved_fact", statement: "The first full export is free and has a small watermark.", rationale: "momentro.me/pricing" },
  { kind: "approved_fact", statement: "Unlocking costs €9.99 for one project or €39 per year for PRO, paid inside the app.", rationale: "momentro.me/pricing" },
  { kind: "approved_fact", statement: "Exports go up to 4K.", rationale: "momentro.me/pricing" },
  { kind: "prohibited_claim", statement: "Momentro works entirely offline.", rationale: "llms.txt: licensing, updates and map lookups use the network" },
  { kind: "prohibited_claim", statement: "Momentro makes your film instantly or in a fixed number of minutes.", rationale: "llms.txt: analysis and export take real time" },
  { kind: "prohibited_claim", statement: "Momentro is free forever / unlimited for free.", rationale: "Only the first export is free, with a watermark" },
  { kind: "prohibited_claim", statement: "Momentro works on phones or in the browser.", rationale: "Desktop app only (Windows, Mac)" },
];

export const MOMENTRO_GUARDRAILS: GuardrailRule[] = [
  {
    code: "momentro.not_fully_offline",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Licensing, update checks and optional map lookups use the network.",
    patterns: ["\\b(fully|entirely|completely|100%) offline\\b", "\\bno internet (needed|required)\\b", "\\bnothing (ever )?leaves your (device|computer)\\b"],
  },
  {
    code: "momentro.no_instant_promise",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "Analysis and export take real time that depends on the files and the computer.",
    patterns: ["\\b(instant(ly)?|in seconds|in one click)\\b.{0,30}\\b(film|video|movie)\\b", "\\bin (\\d+|a few) (seconds|minutes)\\b"],
  },
  {
    code: "momentro.no_free_forever",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Only the first export is free, with a watermark.",
    patterns: ["\\bfree forever\\b", "\\bunlimited (free|for free)\\b", "\\bcompletely free\\b"],
  },
  {
    code: "momentro.no_fake_proof",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "No invented reviews, user counts or results.",
    patterns: ["\\b(thousands|millions) of (happy )?(users|families|customers)\\b", "\\b\\d+[,.]?\\d*k? (users|families|customers) (love|use|trust)\\b"],
  },
];

export const MOMENTRO_BRIEF: Partial<MarketingBrief> = {
  name: "Momentro",
  what: "a desktop app (Windows and Mac) that turns family and travel clips into one finished film",
  audience: "parents and travellers with thousands of clips on phones, cameras and drives that never get watched; they are busy, not video editors, and want a film the family will actually rewatch",
  niche: "family videos, travel videos and keeping memories",
  mention: "I'm on the team that makes Momentro, and…",
  product_moment: "drop in the clips, step away while the computer works, come back to a first cut with music and titles; files stay on your computer",
  never: "\"fully offline\", instant or fixed-time promises, \"free forever\", invented user numbers or reviews, sales words (download now, best app, check out, link in bio), mocking other editors",
  never_claim: "being a customer, or that you made a film of your own family with it",
  skip_topics: "grief or loss, a sick or missing child, tragedies, politics, posts by minors",
  sensitive: false,
  voice_good: [
    "The bit where you film the same sunset from three angles and then never open any of them is painfully accurate.",
    "Honestly the hardest part is choosing, not editing. Picking ten clips that feel like the day gets you most of the way.",
    "This is the camera-roll problem exactly. I'm on the team that makes Momentro, and we keep hearing that the clips are there but the film never happens.",
  ],
  voice_bad: "Amazing video!! Check out Momentro, the best app to edit your memories in seconds!",
  search_phrases: "\"family vacation video\", \"how to make a travel video from phone clips\", \"organize family videos\"",
  hashtags: "#familyvideo #travelvideo #familymemories #vacationvideo",
  hashtag_rule: "no #free or #instant-style promises",
  closing_title: "Momentro",
  closing_text: "Your clips, one film. Desktop app for Windows and Mac. First export free.",
  card_brand: "Momentro",
  card_footer: "Momentro · Windows and Mac",
  card_note: "",
  end_card_title: "Momentro",
  end_card_text: "Your clips, one film. Windows and Mac.",
  end_card_fine: "",
  colors: { dark: "#10233d", light: "#f4f9ef", ink: "#0f223e", muted: "#5a677f", pale: "#d8ffc0", accent: "#89ff2e", accent2: "#5a677f" },
  reels: false,
  brief_tone: "The product helps families turn forgotten clips into films; keep the tone warm and practical.",
};
