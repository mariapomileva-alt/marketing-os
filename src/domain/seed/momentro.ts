import type { GuardrailRule } from "../guardrails";
import type { MarketingBrief } from "../brief";

/**
 * Momentro (momentro.me): a desktop app that turns family and travel clips into one finished film. Facts are taken from
 * the team's own site and llms.txt (Oct 2026); the owner reviews them in Product & rules.
 */
export const MOMENTRO = {
  slug: "momentro",
  name: "Momentro",
  short_description: "A desktop app that turns a large collection of personal photos and videos into a finished film, without doing all the editing yourself.",
  category: "Desktop app · personal travel and family films",
  website_url: "https://momentro.me",
  legal_restrictions:
    "Momentro analyses and exports on the user's computer and original photos and videos are not uploaded for editing, but licence checks, update checks and optional location-name lookups (OpenStreetMap) use the network: never call it fully offline, 100% private or say nothing ever leaves the computer. Analysis and export take real computer time that depends on the hardware, the number of files and their format: never promise instant, effortless or one-click results. Prices and plans are not confirmed (the site shows €9.99 per project / €39 a year, the in-app FAQ says $, the Project Brain proposes other plans): do not state prices in content. Platforms: the live site offers Windows and Mac downloads, the in-app FAQ still says Windows only; confirm before ads that name a platform. No testimonials, ratings, user counts or performance numbers until they are in the Evidence Library.",
  tone_of_voice:
    "Human, clear, calm, credible. Lead with the finished memory, not the mechanics of editing or the technology. Language of completion (start, bring together, review, finish, watch, keep, share). Relief, never guilt. The user decides; Momentro builds the first version. Plain words: photos and videos, clips, film, trip, journey. Technology stays quiet.",
  prohibited_topics: ["Other people's children or families shown without consent", "Competitor disparagement", "Grief or loss used for reach"],
  pain_points: [
    "A trip folder with hundreds or thousands of photos and videos that never became a film",
    "Clips scattered across phones, cameras, drones and external drives",
    "No time or wish to learn a video editor",
    "Large files that are slow to upload to web editors",
    "Wanting personal media to stay under your own control",
  ],
  triggers: ["Back from a trip", "End of the year", "A family event or holiday", "Phone or drive full", "Wanting to show the trip to family"],
  desired_emotional_states: ["Relief that the film is finally finished", "Reliving the trip together", "Calm: the computer did the long work"],
  customer_vocabulary: ["trip folder", "camera roll", "travel video", "family film", "too many clips", "never got round to editing", "the whole journey"],
  advantages: [
    "Builds a complete first version from a large collection automatically",
    "Works with large collections on your computer instead of uploading them to a web editor",
    "Original photos and videos stay unchanged",
    "The first version stays editable: clips, titles, music, narration",
    "Location information can become place labels for the journey",
  ],
};

export const MOMENTRO_CLAIMS: Array<{ kind: "approved_fact" | "prohibited_claim"; statement: string; rationale: string }> = [
  { kind: "approved_fact", statement: "Momentro analyses the photos and videos you choose and builds a first version of the film automatically; you review it and change what you want.", rationale: "HOW_TO.md (Optimize/Analyze, Build timeline); launch_01 approved facts" },
  { kind: "approved_fact", statement: "Analysis, editing and export happen on your computer; original photos and videos are not uploaded for editing and stay unchanged.", rationale: "FAQ.md; launch_01 approved facts" },
  { kind: "approved_fact", statement: "Momentro exports a finished, standalone video file.", rationale: "HOW_TO.md: Export" },
  { kind: "approved_fact", statement: "Analysing and exporting a large collection takes computer time that depends on the hardware, file count and format; you do not need to stay at the computer while it runs.", rationale: "FAQ.md performance; HOW_TO.md" },
  { kind: "approved_fact", statement: "Photos and videos can come from phones, cameras, drones and external drives.", rationale: "HOW_TO.md: Add Files" },
  { kind: "approved_fact", statement: "The first full export is free and carries a small watermark.", rationale: "FAQ.md and momentro.me/pricing agree" },
  { kind: "approved_fact", statement: "Momentro uses the network only for licence checks, update checks and optional location-name lookups.", rationale: "FAQ.md network disclosure" },
  { kind: "prohibited_claim", statement: "Momentro works fully offline, is 100% private, or nothing ever leaves your computer.", rationale: "06 Messaging 11.6; FAQ network disclosure" },
  { kind: "prohibited_claim", statement: "Momentro makes your film instantly, effortlessly, in one click, or in a fixed time.", rationale: "06 Messaging 11.4–11.5" },
  { kind: "prohibited_claim", statement: "Momentro makes a perfect or professional film every time.", rationale: "06 Messaging 11.3; 07 Brand Language 5.5" },
  { kind: "prohibited_claim", statement: "AI decides what matters or knows your best moments.", rationale: "07 Brand Language 5.2, 5.6" },
  { kind: "prohibited_claim", statement: "Any specific price, plan or 'free forever' claim.", rationale: "Pricing not confirmed (site € vs FAQ $ vs Project Brain)" },
  { kind: "prohibited_claim", statement: "Testimonials, ratings, user counts or performance numbers.", rationale: "06 Messaging 11.12; no Evidence Library yet" },
  { kind: "prohibited_claim", statement: "Momentro works on phones or in the browser.", rationale: "Desktop app only" },
];

export const MOMENTRO_GUARDRAILS: GuardrailRule[] = [
  {
    code: "momentro.not_fully_offline",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Licence checks, update checks and optional location lookups use the network (FAQ; 06 Messaging 11.6).",
    patterns: ["\\b(fully|entirely|completely|100%) (offline|private)\\b", "\\bno internet (needed|required)\\b", "\\bnothing (ever )?leaves your (device|computer)\\b"],
  },
  {
    code: "momentro.no_instant_promise",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Processing takes real computer time (06 Messaging 11.4–11.5).",
    patterns: ["\\binstant(ly)?\\b", "\\beffortless(ly)?\\b", "\\bone[- ]click\\b", "\\bzero (work|effort)\\b", "\\bin (\\d+|a few) (seconds|minutes)\\b"],
  },
  {
    code: "momentro.no_price_claims",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Prices and plans are not confirmed; only 'first export free (with a watermark)' is.",
    patterns: ["[€$£]\\s?\\d", "\\bfree forever\\b", "\\bunlimited\\b", "\\bcompletely free\\b", "\\bper (year|month)\\b"],
  },
  {
    code: "momentro.no_fake_proof",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "No invented reviews, user counts or results (06 Messaging 11.12).",
    patterns: ["\\b(thousands|millions|hundreds) of (happy )?(users|families|customers|travell?ers)\\b", "\\b\\d+[,.]?\\d*k?\\+? (users|families|customers) (love|use|trust)\\b", "\\b(5|five)[- ]star\\b"],
  },
  {
    code: "momentro.brand_language",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "Words Momentro avoids (07 Brand Language 5.1–5.5): empty innovation, AI magic, pro-editing jargon, content-machine and absolute words.",
    patterns: ["\\b(revolutionary|game[- ]?changing|cutting[- ]edge|next[- ]generation|state[- ]of[- ]the[- ]art|breakthrough|world[- ]class|ultimate)\\b", "\\b(AI|ai) magic\\b|\\bmagical\\b", "\\b(viral|scroll[- ]stopping|content creation|creator economy)\\b", "\\b(perfect|flawless) (film|video|movie|result)", "\\bthe (easiest|fastest|best) (way|app|editor)\\b", "\\b(cinematic[- ]grade|studio[- ]quality|broadcast quality|professional results)\\b"],
  },
  {
    code: "momentro.no_shame",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Relief, never guilt or fear about memories (07 Brand Language 5.7; 06 Messaging 11.7–11.8).",
    patterns: ["\\bmemories (are )?(wasting away|dying|disappearing|lost forever)\\b", "\\bdon'?t let your family down\\b", "\\b(lazy|failed to preserve)\\b", "\\bbefore it'?s too late\\b"],
  },
  {
    code: "momentro.user_decides",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "Automation helps; the user decides (07 Brand Language 3.7, 5.6).",
    patterns: ["\\b(AI|the algorithm) (decides|knows|picks your best|tells your story|creates your memories)\\b", "\\bno decisions required\\b"],
  },
];

export const MOMENTRO_BRIEF: Partial<MarketingBrief> = {
  name: "Momentro",
  what: "a desktop app that turns a large collection of personal photos and videos into a finished film, without doing all the editing yourself",
  audience: "travellers back from a trip first, and families: people with hundreds or thousands of photos and videos across phones, cameras, drones and drives that never became a film. Busy, not video editors; they want the film, not the editing project",
  niche: "travel and family memories: trips, holidays and family moments that were recorded but never finished as a film",
  mention: "I'm on the team that makes Momentro, and…",
  product_moment: "start with one trip folder, let the computer build the first version while you get on with your day, review it, change what you want and export a finished film; your original photos and videos stay on your computer",
  never: "\"fully offline\", \"100% private\", \"nothing ever leaves your computer\", instant / effortless / one-click / perfect / professional-results promises, prices or plans, \"free forever\", \"unlimited\", invented reviews, ratings, user counts or numbers, AI magic or \"AI decides\", revolutionary / game-changing / cutting-edge, viral / scroll-stopping / content creation, shame or fear about memories (\"wasting away\", \"before it's too late\"), sales words (download now, best app, check out, link in bio), disparaging other editors, calling people's memories assets or footage",
  never_claim: "being a customer, or that you made a film of your own trip or family with it",
  skip_topics: "grief or loss, a sick or missing person, tragedies, politics, posts by minors, other people's children",
  sensitive: false,
  voice_good: [
    "Three hundred clips from one week in Portugal and not one of them watched since. That folder is the real travel souvenir for most of us.",
    "Honestly the hardest part is starting, not editing. Picking one trip folder instead of the whole archive makes it feel possible.",
    "This is the unfinished-trip problem exactly. I'm on the team that makes Momentro, and we keep hearing that the clips are there but the film never happens.",
  ],
  voice_bad: "Amazing!! Our AI magic turns your footage into a perfect cinematic movie in one click. Try the best app now!",
  search_phrases: "\"travel video from phone clips\", \"family vacation video\", \"how to make a trip video without editing\"",
  hashtags: "#travelvideo #travelmemories #familyvideo #tripvideo",
  hashtag_rule: "no #free, #instant or #viral-style hashtags",
  closing_title: "Momentro",
  closing_text: "Turn the whole journey into one finished film. Try Momentro Free.",
  card_brand: "Momentro",
  card_footer: "Momentro · for Windows and Mac",
  card_note: "",
  end_card_title: "Momentro",
  end_card_text: "Turn the whole journey into one finished film.",
  end_card_fine: "",
  colors: { dark: "#10233d", light: "#f4f9ef", ink: "#0f223e", muted: "#5a677f", pale: "#d8ffc0", accent: "#89ff2e", accent2: "#5a677f" },
  reels: false,
  brief_tone: "Momentro helps people turn unfinished trip and family media into films; keep the tone calm, warm and practical, relief not guilt.",
  patterns: [
    "Core lines: \"Turn the whole journey into one finished film.\" (lead for launch/travel) · \"Finish the memories you never had time to edit.\" · \"Less editing work. More finished memories.\" · \"Momentro may need computer time. It should require much less of yours.\" · \"The trip happened, but its film remains unfinished.\"",
    "Message patterns: recognition → relief; before → after (scattered clips → one story); computer time → human time; feature → human value; objection → honest reassurance → proof; old archive → new opportunity; memory → product → action.",
    "Instagram themes: the folder that never became a film; source files versus finished result; the computer works while you live; travel places becoming a story; small moments found in a large archive; honest behind-the-scenes.",
    "Ads structure: recognisable unfinished-media problem → real source volume → Momentro building → finished film → clear CTA. No fake interfaces, no generated films presented as Momentro output.",
    "CTAs: Try Momentro Free · Download for Windows · Download for Mac · Start With Your Trip Folder · Watch How It Works. Prefer a specific action to 'learn more'.",
    "Words to use: photos and videos, clips, trip, journey, film, first version, review, finish, watch, keep, share, your computer, original files. Avoid: footage, assets, content, render, pipeline.",
    "Visual feel: human moments before technology, natural light, eye-level observed framing, curiosity, wonder, connection, calm, nostalgia; no urgency, luxury or AI clichés; the logo is a small signature, never over the emotional image.",
  ].join("\n"),
};
