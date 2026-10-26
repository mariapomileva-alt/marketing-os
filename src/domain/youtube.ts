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
/** Phrases that make a comment read as written by a bot or a marketing team. */
const BOT_PHRASES = /\b(great (video|point|content)|i (really )?appreciate|resonates?|it'?s important to (remember|note)|on (this|your) journey|valuable (insights?|content)|delve|in today'?s world|as someone who|absolutely!|game[- ]changer|thanks for sharing this valuable)\b/iu;

/** The tired question shape: "Does anyone else…?", "Has anyone here…?", "Am I the only one…?" */
const ANYONE_ELSE = /\b(does|did|do|has|have|is|anyone|am i the only)\b[^?]{0,20}\b(anyone|anybody|only one)\b[^?]*\?["”’)\s]*$/iu;
/** "It's not X, it's Y" / "isn't about X — it's Y" reveals and "Not the X. The Y." corrections: the commonest AI tell. */
const REVEAL = /\b(it'?s|this is|that'?s|it is|this isn'?t|it isn'?t|that isn'?t)( not)? (just |really |about |only )*[^.?!\n]{2,40}(,|;|—|–| -)\s*(it'?s|but|it is)\b|(^|[.!?\n]\s*)not (the|a|just) [^.?!\n]{2,40}\.\s+(the|a|just|it'?s) /iu;
/** Openings the drafter fell into: quoting a phrase and calling it "such a…", or "I'm glad you…". */
const SUCH_A_OPENING = /^\W*["“'‘][^"”’]{3,140}["”’]\s+(is|was)\s+(such|so|quietly)\b/iu;
const GLAD_OPENING = /^\s*i'?m (so |really |really glad|glad)/iu;
const endsWithQuestion = (t: string) => /\?["”’)\s]*$/u.test(t.trim());

/**
 * What the team's recent texts keep doing, as plain instructions for the next draft. Counted, not guessed, so the
 * drafter gets told exactly which habit to break this time (e.g. "8 of the last 10 ended with a question").
 */
export function styleNotes(previous: string[], kind = "texts"): string[] {
  const recent = previous.filter((t) => t?.trim()).slice(0, 10);
  if (recent.length < 3) return [];
  const notes: string[] = [];
  const q = recent.filter(endsWithQuestion).length;
  if (q / recent.length > 0.34) notes.push(`${q} of the last ${recent.length} ${kind} ended with a question. This one must not end with a question: end on a thought, a small concrete detail or simple recognition.`);
  const anyone = recent.filter((t) => ANYONE_ELSE.test(t)).length;
  if (anyone) notes.push(`${anyone} of the last ${recent.length} ${kind} asked "does anyone else / has anyone…". Never use that question shape.`);
  const such = recent.filter((t) => SUCH_A_OPENING.test(t)).length;
  if (such >= 2) notes.push(`${such} recent ${kind} opened by quoting a phrase and calling it "such a …". Open some other way: with your own thought, a detail, or the person's situation.`);
  const suchA = recent.filter((t) => /\b(is|was) (such a|so|quietly the)\b/iu.test(t)).length;
  if (suchA >= 3) notes.push(`${suchA} recent ${kind} praise a phrase as "such a … one" / "quietly the kindest part". Skip the praise; react with your own idea.`);
  const glad = recent.filter((t) => GLAD_OPENING.test(t)).length;
  if (glad >= 2) notes.push(`${glad} recent ${kind} opened with "I'm glad…". Do not open that way.`);
  const reveal = recent.filter((t) => REVEAL.test(t)).length;
  if (reveal >= 2) notes.push(`${reveal} recent ${kind} used an "it's not X, it's Y" turn. Say the point directly instead.`);
  const firsts = new Map<string, number>();
  for (const t of recent) { const w = normalise(t).split(" ")[0]; if (w) firsts.set(w, (firsts.get(w) ?? 0) + 1); }
  for (const [w, n] of firsts) if (n >= 3 && !["i", "a"].includes(w)) notes.push(`${n} recent ${kind} start with "${w}". Start differently.`);
  return notes;
}

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
  const bot = BOT_PHRASES.exec(draft);
  if (bot) problems.push(`Sounds like a bot ("${bot[0]}"). Say it the way a person would.`);
  if (/#\w/.test(draft)) problems.push("Hashtags read as marketing in a comment.");
  if (/^\s*[-•*]\s/m.test(draft)) warnings.push("Lists look formal in a YouTube comment.");
  if ((draft.match(/—/g) ?? []).length > 2) warnings.push("Many dashes; real comments rarely have more than one.");
  const recent = previous.slice(0, 10);
  if (ANYONE_ELSE.test(draft) && recent.some((p) => ANYONE_ELSE.test(p))) problems.push('Asks "does anyone else…?" again: the team\'s most repeated closing. End some other way.');
  if (endsWithQuestion(draft) && recent.length >= 4 && recent.slice(0, 4).filter(endsWithQuestion).length >= 3) problems.push("Ends with a question again; most recent comments already did. End on a thought instead.");
  if (REVEAL.test(draft)) warnings.push('"It\'s not X, it\'s Y" turn reads as AI-written; say the point directly.');
  if (SUCH_A_OPENING.test(draft) && recent.some((p) => SUCH_A_OPENING.test(p))) warnings.push('Opens like recent comments (quote + "such a…").');

  return { ok: problems.length === 0, problems, warnings, scores: { maxSimilarity, promo, exclamations, emoji, words }, mentionsProduct };
}

/**
 * The phrases searched in one run: all of them when the list is short, otherwise a window that moves every day, so
 * a long list is covered over a few days without exceeding the platform's daily quota.
 */
export function queriesForRun(queries: string[], perRun: number, now = new Date()): string[] {
  if (queries.length <= perRun) return queries;
  const day = Math.floor(now.getTime() / 86_400_000);
  const start = (day * perRun) % queries.length;
  return Array.from({ length: perRun }, (_, i) => queries[(start + i) % queries.length]);
}
