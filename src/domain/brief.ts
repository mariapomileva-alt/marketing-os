/**
 * The marketing brief of a product: who we are, who reads us, what we never say, how our cards and Reels end. Every
 * prompt is written once with {{PLACEHOLDERS}} and filled from the brief of the product it works for, so each product
 * (Back, Momentro, …) gets its own voice and rules from the same machinery.
 */
export interface MarketingBrief {
  name: string;                 // how the team names the product in text: "Back"
  what: string;                 // one line: "a small self-help app for the first minutes of a panic attack"
  audience: string;             // who reads us
  niche: string;                // the conversation we are part of: "panic and anxiety"
  mention: string;              // an open mention of the team: "I'm on the team that makes Back, and…"
  product_moment: string;       // when the product honestly helps: "offline, no account, one tap, Call my person"
  never: string;                // claims and tones we never use
  never_claim: string;          // what the team never pretends: "personal experience of panic, a diagnosis"
  skip_topics: string;          // where a product team must not comment
  sensitive: boolean;           // health/safety topic: emergency lines and hand-off to a human
  voice_good: string[];         // 2–3 example comments in our tone (never copied)
  voice_bad: string;            // one example of what we never sound like
  search_phrases: string;       // words people search: '"panic attack at night", "what to do during a panic attack"'
  hashtags: string;             // "#panicattack #anxietytips #panicattackhelp"
  hashtag_rule: string;         // "never #relief-style promises"
  closing_title: string;        // last carousel slide title: "Back panic app"
  closing_text: string;         // last carousel slide text
  card_brand: string;           // brand word on cards: "Back"
  card_footer: string;          // footer on single/closing cards
  card_note: string;            // small note on the closing card ("" for none)
  end_card_title: string;       // Reel end card title
  end_card_text: string;        // Reel end card line
  end_card_fine: string;        // Reel end card fine print
  colors: { dark: string; light: string; ink: string; muted: string; pale: string; accent: string; accent2: string };
  reels: boolean;               // a recorded scene library exists for Reels (scripts/reels/shots)
  brief_tone: string;           // one line for the morning brief: what the product does and the tone
}

export const BACK_BRIEF: MarketingBrief = {
  name: "Back",
  what: "a small self-help app for the first minutes of a panic attack",
  audience: "people who live with panic attacks or strong anxiety, often scrolling at night or on the way somewhere, and people who love them. They want something true, small and usable, not motivation posters",
  niche: "panic and anxiety",
  mention: "I'm on the team that makes Back, and…",
  product_moment: "offline, no account, one tap, Call my person",
  never: "medical promises (cure, stop attacks, heal, guaranteed), diagnosis, medication advice, \"instead of therapy\", fear or urgency, sales words (download, best app, check out, link in bio)",
  never_claim: "personal experience of panic, a diagnosis, or that the product helped you",
  skip_topics: "a crisis, self-harm, drugs, children or politics",
  sensitive: true,
  voice_good: [
    "Letting the wave pass instead of fighting it sounds abstract until you see it. The bus stop example makes it concrete.",
    "Honestly the tip to name five colours around you is so underrated. It's small enough to actually remember when your brain is loud.",
    "Yes, the 'what if it happens on the train' fear is often worse than the train itself. I'm on the team that makes Back, and we keep running into that same pattern.",
  ],
  voice_bad: "Great video! Panic attacks are really tough. It's important to remember you are not alone on this journey. Check out our app Back!",
  search_phrases: "\"panic attack at night\", \"what to do during a panic attack\"",
  hashtags: "#panicattack #anxietytips #panicattackhelp",
  hashtag_rule: "never #relief-style promises",
  closing_title: "Back panic app",
  closing_text: "Help for the first minute. One tap, no account, works offline.",
  card_brand: "Back",
  card_footer: "Back panic app · free on iPhone",
  card_note: "In danger right now? Call your local emergency number.",
  end_card_title: "Back: Panic Attack Help",
  end_card_text: "Free on iPhone. Opens in one tap.",
  end_card_fine: "A self-help tool, not therapy or an emergency service.",
  colors: { dark: "#0c3b2e", light: "#f3ede1", ink: "#153c32", muted: "#65736c", pale: "#d7e0d5", accent: "#6d9773", accent2: "#bb8a52" },
  reels: true,
  brief_tone: "The product helps people through panic attacks; keep the tone calm.",
};

/** A sensible brief from the product's basic facts, for a product whose brief has not been written yet. */
export function defaultBrief(p: { name: string; short_description: string; category: string }): MarketingBrief {
  return {
    name: p.name,
    what: p.short_description || p.category || "our product",
    audience: "the people the product is for (see PRODUCT FACTS)",
    niche: p.category || "the product's topic",
    mention: `I'm on the team that makes ${p.name}, and…`,
    product_moment: "what the product honestly does (PRODUCT FACTS)",
    never: "invented results or numbers, guarantees, pressure or urgency, sales words (download now, best app, check out, link in bio)",
    never_claim: "being a customer, or that the product helped you personally",
    skip_topics: "a crisis, tragedy, politics or a post by a minor",
    sensitive: false,
    voice_good: [],
    voice_bad: `Great video! Check out ${p.name}, the best app for this!`,
    search_phrases: "the words people type when they look for this",
    hashtags: "3–5 specific hashtags people follow in this topic",
    hashtag_rule: "no promise-style hashtags",
    closing_title: p.name,
    closing_text: p.short_description.slice(0, 90),
    card_brand: p.name,
    card_footer: p.name,
    card_note: "",
    end_card_title: p.name,
    end_card_text: "",
    end_card_fine: "",
    colors: { dark: "#1f2a37", light: "#f5f2ec", ink: "#1f2a37", muted: "#6b7280", pale: "#e5e7eb", accent: "#3b82f6", accent2: "#d97706" },
    reels: false,
    brief_tone: "Keep the tone calm and plain.",
  };
}

export function mergeBrief(base: MarketingBrief, stored: Partial<MarketingBrief> | null | undefined): MarketingBrief {
  const s = stored ?? {};
  return { ...base, ...s, colors: { ...base.colors, ...(s.colors ?? {}) }, voice_good: s.voice_good?.length ? s.voice_good : base.voice_good };
}

/** Fills {{KEY}} placeholders in a prompt from the brief. Unknown keys are left visible so they are easy to spot. */
export function fillPrompt(text: string, b: MarketingBrief) {
  const values: Record<string, string> = {
    NAME: b.name,
    WHAT: b.what,
    AUDIENCE: b.audience,
    NICHE: b.niche,
    MENTION: b.mention,
    PRODUCT_MOMENT: b.product_moment,
    NEVER: b.never,
    NEVER_CLAIM: b.never_claim,
    SKIP_TOPICS: b.skip_topics,
    VOICE_GOOD: b.voice_good.length ? b.voice_good.map((v) => `- "${v}"`).join("\n") : "- (no examples yet: plain, specific, kind)",
    VOICE_BAD: b.voice_bad,
    SEARCH_PHRASES: b.search_phrases,
    HASHTAGS: b.hashtags,
    HASHTAG_RULE: b.hashtag_rule,
    CLOSING_TITLE: b.closing_title,
    CLOSING_TEXT: b.closing_text,
    END_CARD: `${b.end_card_title}${b.end_card_text ? ` · ${b.end_card_text}` : ""}`,
    BRIEF_TONE: b.brief_tone,
    SAFETY: b.sensitive
      ? "If an item touches suicide, self-harm or an emergency, include a line pointing to local emergency services."
      : "Never touch tragedies, crises or someone's private pain for reach.",
    EMERGENCY: b.sensitive
      ? "Danger, self-harm, suicidal thoughts, chest pain, fainting or another possible emergency: set handoff_to_human=true,\n  may_mention_product=false, and write only a short, caring note pointing to local emergency services. Nothing else."
      : "Anger, a refund or billing problem, a bug report or anything that needs the team: set handoff_to_human=true and write\n  a short, kind holding note that the team will look at it. No promises.",
  };
  // {{#REELS}}…{{/REELS}}: kept only for a product with its own recorded Reels library.
  const sections = text.replace(/\{\{#REELS\}\}([\s\S]*?)\{\{\/REELS\}\}/g, (_, inner: string) => (b.reels ? inner : "Reels: none for this product (COUNTS.reels is 0)."));
  return sections.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => values[k] ?? m);
}
