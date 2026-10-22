/**
 * YouTube community work for a product: which videos are worth a comment, how risky a message is, and whether
 * a drafted comment sounds like a person from the team (not an ad, not a copy of an earlier comment).
 * Pure functions — no network, no database — so every rule is unit-tested.
 *
 * Owner rules (brief + YouTube agent spec): drafts only, every comment approved by a human, the team is always
 * open about who it is, never invents personal experience, never promotes to people in crisis, never targets
 * content made for children, never posts the same text twice.
 */

export interface VideoCandidate {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  language: string | null;
  durationSeconds: number | null;
  views: number | null;
  commentsDisabled: boolean;
  madeForKids: boolean;
}

export interface DiscoverySettings {
  queries: string[];
  minDurationSeconds: number;
  channelCooldownDays: number;
}

export interface VideoVerdict {
  relevance: number; // 0–100
  eligible: boolean;
  reason: string;
  matchedKeywords: string[];
  flags: string[];
}

const TOPIC_TERMS: Array<[RegExp, string, number]> = [
  [/panic attacks?/iu, "panic attack", 35],
  [/\bpanic\b/iu, "panic", 15],
  [/anxiety attack/iu, "anxiety attack", 25],
  [/\banxiety\b|\banxious\b/iu, "anxiety", 10],
  [/grounding|5[- ]4[- ]3[- ]2[- ]1/iu, "grounding", 25],
  [/breath(e|ing)/iu, "breathing", 8],
  [/(sensory )?overwhelm|overload/iu, "overwhelm", 10],
  [/first (signs|minutes)|what to do (during|when)|how to (stop|calm|get through)/iu, "in-the-moment help", 15],
  [/панич\p{L}*\s+атак/iu, "паническая атака", 35],
  [/приступ\p{L}*\s+паник|паник/iu, "паника", 15],
  [/тревог/iu, "тревога", 10],
  [/заземлен|дыхан/iu, "дыхание / заземление", 10],
  [/что делать|как пережить|первая помощь/iu, "что делать в моменте", 15],
];

/** Content where a comment from a product team would be wrong, whatever the topic score. */
const EXCLUDE: Array<[RegExp, string]> = [
  [/suicid|self[- ]?harm|kill (my|him|her)self|overdose|суицид|самоповрежд|передозиров/iu, "crisis or self-harm topic"],
  [/\b(cbd|thc|weed|cannabis|psilocybin|mushrooms|ketamine|xanax|benzo)|наркот|травк|грибы/iu, "drugs or medication"],
  [/\b(cure|cured|curing)\b.*\b(forever|permanently|in \d+ (days|minutes))|вылечи\p{L}* навсегда|за \d+ (дней|минут)/iu, "sensational medical claim"],
  [/election|trump|biden|putin|war in|выборы|политик/iu, "political content"],
  [/\b(kids?|children|for teens|школьник|детям|для детей)\b/iu, "aimed at children"],
  [/\b(prank|reaction|asmr mukbang)\b/iu, "entertainment format"],
];

export function parseIsoDuration(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

export function scoreVideo(v: VideoCandidate, s: DiscoverySettings, channelLastCommentedAt: Date | null, now: Date): VideoVerdict {
  const text = `${v.title}\n${v.description}`;
  const matched: string[] = [];
  let score = 0;
  for (const [re, label, weight] of TOPIC_TERMS) {
    if (re.test(text)) {
      matched.push(label);
      score += re.test(v.title) ? weight : Math.round(weight / 2);
    }
  }
  score = Math.min(100, score);
  const flags: string[] = [];
  for (const [re, label] of EXCLUDE) if (re.test(text)) flags.push(label);
  if (v.madeForKids) flags.push("made for kids");
  if (v.commentsDisabled) flags.push("comments are off");
  if (v.durationSeconds !== null && v.durationSeconds < s.minDurationSeconds) flags.push(`shorter than ${s.minDurationSeconds} s (Shorts)`);
  if (channelLastCommentedAt) {
    const days = (now.getTime() - channelLastCommentedAt.getTime()) / 86_400_000;
    if (days < s.channelCooldownDays) flags.push(`we commented on this channel ${Math.floor(days)} days ago (limit: once per ${s.channelCooldownDays} days)`);
  }
  const relevant = score >= 35;
  const eligible = relevant && flags.length === 0;
  const reason = !relevant
    ? `Not clearly about panic in the moment (score ${score}).`
    : flags.length
      ? `Relevant, but skipped: ${flags.join("; ")}.`
      : `About ${matched.slice(0, 3).join(", ")}; a short, useful comment fits.`;
  return { relevance: score, eligible, reason, matchedKeywords: matched, flags };
}

// ---------------------------------------------------------------------------
// Messages from people: what they need and how risky it is
// ---------------------------------------------------------------------------
export type MessageKind =
  | "question_about_back" | "personal_experience" | "thanks" | "criticism" | "asks_for_advice"
  | "price_or_features" | "severe_state" | "immediate_danger" | "spam" | "other";
export type Risk = "low" | "medium" | "high";

const DANGER = /suicid|kill (my|him|her)self|end (my|it all)|don'?t want to (live|be here)|hurt (my|him|her)self|self[- ]?harm|can'?t (keep|stay) (myself )?safe|chest pain|pain in my chest|can'?t breathe at all|pass(ed|ing)? out|faint(ed|ing)?|overdos|суицид|покончить|не хочу жить|навредить себе|самоповрежд|боль в груди|теряю сознание|потерял\p{L}* сознание/iu;
const SEVERE = /every day for (months|years)|can'?t (leave|go out of) (the )?house|lost my job|nothing helps|so hopeless|не выхожу из дома|ничего не помогает|безнадёжн|безнадежн/iu;

export function classifyMessage(text: string): { kind: MessageKind; risk: Risk; reason: string } {
  const t = text.trim();
  if (DANGER.test(t)) return { kind: "immediate_danger", risk: "high", reason: "Mentions possible danger or a medical emergency: a person decides, no product mention." };
  if (SEVERE.test(t)) return { kind: "severe_state", risk: "high", reason: "Describes a heavy, ongoing state: answer gently, point to professional help, no product mention." };
  if (/(https?:\/\/\S+){2,}|crypto|giveaway|whatsapp me|telegram me|dm me for/iu.test(t)) return { kind: "spam", risk: "medium", reason: "Looks like spam: usually no reply." };
  if (/\b(what|which) (is this|app)|what'?s back|is (it|back) (free|on android)|что за приложение|как называется/iu.test(t)) return { kind: "question_about_back", risk: "low", reason: "Asks about Back directly: an open, factual answer is fine." };
  if (/price|cost|subscription|android|offline|цена|стоит|подписк|андроид/iu.test(t)) return { kind: "price_or_features", risk: "low", reason: "Asks about price or features." };
  if (/thank|helpful|love this|спасибо|полезно/iu.test(t)) return { kind: "thanks", risk: "low", reason: "Thanks: a short warm reply." };
  if (/another app|scam|doesn'?t work|useless|cure anxiety|очередное приложение|развод|не работает/iu.test(t)) return { kind: "criticism", risk: "medium", reason: "Scepticism: acknowledge it, no defensiveness, no promises." };
  if (/\?|what should i|any tips|how do you|что делать|как вы|посоветуйте/iu.test(t)) return { kind: "asks_for_advice", risk: "medium", reason: "Asks for advice: general, non-medical support only." };
  if (/\b(i|me|my)\b|\bу меня\b|\bя\b/iu.test(t)) return { kind: "personal_experience", risk: "medium", reason: "Shares personal experience: respond to the person first." };
  return { kind: "other", risk: "low", reason: "General comment." };
}

/**
 * A neutral, product-free note for high-risk messages. It is still only a draft: a person decides whether and how
 * to answer. Wording of crisis resources is owner-approved (D-13); this draft names no specific hotline.
 */
export function safetyDraft(language: "en" | "ru"): string {
  return language === "ru"
    ? "Спасибо, что написали об этом. То, что вы чувствуете, важно. Если вам сейчас может грозить опасность или вы думаете о том, чтобы навредить себе, пожалуйста, позвоните в местную экстренную службу (112 в ЕС) или обратитесь на кризисную линию вашей страны. Вы не обязаны справляться с этим в одиночку."
    : "Thank you for sharing this. What you're feeling matters. If you might be in danger right now or are thinking about hurting yourself, please call your local emergency number (112 in the EU, 911 in the US) or a crisis line in your country. You don't have to get through this alone.";
}

// ---------------------------------------------------------------------------
// Human voice and repetition checks
// ---------------------------------------------------------------------------
function normalise(t: string) {
  return t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function shingles(t: string, n = 3): Set<string> {
  const words = normalise(t).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  if (!out.size && words.length) out.add(words.join(" "));
  return out;
}

/** Jaccard similarity of 3-word shingles, 0–1. */
export function similarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const opening = (t: string) => normalise(t).split(" ").slice(0, 4).join(" ");
const closing = (t: string) => normalise(t).split(" ").slice(-4).join(" ");

export interface VoiceCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
  scores: { maxSimilarity: number; promo: number; exclamations: number; emoji: number; words: number };
  mentionsProduct: boolean;
}

const PROMO = /\b(download|install|best app|must[- ]have|game[- ]changer|check out|link in|use code|sign up|free trial|скачай|установи|лучшее приложение|переходи по ссылке|промокод)\b/giu;
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Phrases that say openly who is writing, in English and Russian, for a given product name. */
export function disclosurePattern(name: string): RegExp {
  const n = esc(name);
  return new RegExp(
    `(i'?m (on|from|part of) (the )?(team|${n})|we('re| are) (building|making|working on) ${n}|we make ${n}|(from|on) the ${n} team|i work on ${n}|я из команды|мы делаем ${n}|мы созда[её]м ${n}|мы работаем над ${n})`,
    "iu",
  );
}
const FAKE_EXPERIENCE = /\b(i (had|have|used to have|get) (a )?panic attacks?|when i (had|have) panic|back (saved|helped|cured) me|it helped me|у меня (были|бывают|была) (панич|приступ)|мне помогло|меня спас)/iu;
const CLAIMS = /\b(cure|cures|guarantee|stops? (a |your )?panic attacks?|replace(s)? (therapy|a therapist|your doctor)|вылеч|гарантир|останавливает приступ|заменяет терап)/iu;
const EMOJI = /\p{Extended_Pictographic}/gu;

export function checkVoice(draft: string, previous: string[], productName = "Back"): VoiceCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const words = normalise(draft).split(" ").filter(Boolean).length;
  // The product name is capitalised; "Back then" / "Back to normal" at the start of a sentence are ordinary English.
  const mentionsProduct = new RegExp(`\\b${esc(productName)}\\b(?! (then|in the day|to normal|home))`, "u").test(draft);
  const maxSimilarity = previous.reduce((m, p) => Math.max(m, similarity(draft, p)), 0);
  const promo = (draft.match(PROMO) ?? []).length;
  const exclamations = (draft.match(/!/g) ?? []).length;
  const emoji = (draft.match(EMOJI) ?? []).length;

  if (maxSimilarity >= 0.35) problems.push(`Too close to an earlier comment (${Math.round(maxSimilarity * 100)}% overlap).`);
  if (previous.some((p) => opening(p) && opening(p) === opening(draft))) problems.push("Starts the same way as an earlier comment.");
  if (previous.some((p) => closing(p) && closing(p) === closing(draft))) warnings.push("Ends the same way as an earlier comment.");
  if (mentionsProduct && !disclosurePattern(productName).test(draft)) problems.push(`Mentions ${productName} without saying we are the team behind it.`);
  if (FAKE_EXPERIENCE.test(draft)) problems.push("Sounds like personal experience or a testimonial; the team never claims that.");
  if (CLAIMS.test(draft)) problems.push("Makes a medical promise (cure, stops attacks, replaces therapy).");
  if (promo > 0) problems.push("Uses sales language (download, best app, check out…).");
  if (exclamations > 1) warnings.push("More than one exclamation mark reads as forced.");
  if (emoji > 1) warnings.push("More than one emoji.");
  if (words > 90) warnings.push(`Long for a comment (${words} words); aim for under 70.`);
  if (words < 8) warnings.push("Very short; may read as generic.");
  if (/^(great|nice|awesome|amazing) (video|content)/iu.test(draft.trim())) problems.push("Generic opener; respond to a specific thought from the video instead.");

  return { ok: problems.length === 0, problems, warnings, scores: { maxSimilarity, promo, exclamations, emoji, words }, mentionsProduct };
}
