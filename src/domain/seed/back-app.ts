import type { GuardrailRule } from "../guardrails";

/**
 * Back App configuration from the brief §6. These are REAL product rules (not demo data).
 * Status: proposed by the system, pending owner/compliance approval (D-13). Patterns cover English and
 * Russian until the product languages are confirmed (D-6).
 */
export const BACK_APP = {
  slug: "back-app",
  name: "Back App",
  short_description: "In-the-moment support during panic, acute anxiety, fear and sensory overwhelm.",
  category: "Mobile app · mental wellbeing support (not medical treatment)",
  legal_restrictions:
    "Back App provides in-the-moment support and is not medical treatment. It does not diagnose, does not cure panic attacks, and does not replace a doctor, therapist or emergency service.",
  tone_of_voice: "Calm, human, warm and specific. Short sentences. No hype, no pressure, no aggressive sales language. Readers may be in a vulnerable state.",
  prohibited_topics: ["Diagnosis of any condition", "Medication advice", "Comparisons that shame other forms of help"],
};

export const BACK_APP_CLAIMS: Array<{ kind: "approved_fact" | "prohibited_claim"; statement: string; rationale: string }> = [
  { kind: "approved_fact", statement: "Back App provides in-the-moment support during panic, acute anxiety, fear and sensory overwhelm.", rationale: "Product brief §1" },
  { kind: "approved_fact", statement: "Back App is not medical treatment.", rationale: "Product brief §6" },
  { kind: "prohibited_claim", statement: "Back App cures panic attacks or anxiety.", rationale: "Brief §6: never promise to cure panic attacks" },
  { kind: "prohibited_claim", statement: "Back App can tell you whether you have a disorder.", rationale: "Brief §6: never diagnose a user" },
  { kind: "prohibited_claim", statement: "Back App replaces a doctor, therapist or emergency service.", rationale: "Brief §6" },
];

export const BACK_APP_GUARDRAILS: GuardrailRule[] = [
  {
    code: "backapp.no_cure_promise",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Never promise to cure or permanently end panic attacks or anxiety.",
    patterns: [
      // Negated forms ("is not a cure", "does not cure") are allowed so the product can say what it is not.
      "(?<!\\b(?:not|never|no|doesn'?t|does not|can'?t|cannot|won'?t|will not)\\s+(?:a\\s+|an\\s+)?)\\bcur(?:e|es|ed|ing)\\b",
      "\\b(heal|heals|healed|healing) (your|my|the)? ?(panic|anxiety|fear)",
      "\\b(get rid of|end|stop|eliminate) (your |all |the )?(panic( attacks)?|anxiety) (forever|for good|permanently|once and for all)",
      "\\bnever (have|feel|experience) (a |another )?(panic attack|anxiety) again\\b",
      "(?<!не\\s+)(вылеч|излеч)",
      "навсегда (избав|забуд)",
      "избав(ит|иться|ьтесь)? от (панич|тревог)[\\p{L}]* навсегда",
    ],
  },
  {
    code: "backapp.no_diagnosis",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Never diagnose the reader.",
    patterns: [
      "\\byou (have|might have|probably have|likely have|suffer from) (an? )?(panic disorder|anxiety disorder|agoraphobia|ptsd|depression|ocd)",
      "(?<!\\b(?:not|never|no|doesn'?t|does not|can'?t|cannot|won'?t|will not)\\s+(?:a\\s+)?)\\bdiagnos(?:e|es|is|ed|ing)\\b",
      "у (вас|тебя) (паническое|тревожное) расстройство",
      "(?<!не\\s+(?:\\p{L}+\\s+)?)диагноз",
    ],
  },
  {
    code: "backapp.no_replacement_of_professionals",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "Never present the app as a replacement for a doctor, therapist, medication or emergency services.",
    patterns: [
      "(?<!\\b(?:not|never|doesn'?t|does not|won'?t|will not|isn'?t|is not)\\s+(?:a\\s+)?)\\b(instead of|no need for|replaces?|replacement for|better than|skip) (a |an |your |the )?(therapist|therapy|doctor|psychiatrist|psychologist|medication|meds|emergency)",
      "\\byou (don'?t|do not) need (a |an )?(therapist|therapy|doctor|psychiatrist|medication)",
      "вместо (терапевта|психотерапевта|психолога|психиатра|врача|лекарств|терапии)",
      "не нуж(ен|на|ны) (психотерапевт|психолог|врач|терапия|лекарства)",
    ],
  },
  {
    code: "backapp.no_false_urgency",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "No false urgency.",
    patterns: [
      "\\b(only today|today only|last chance|act now|hurry|don'?t wait|limited time|ends tonight|only \\d+ (left|hours))\\b",
      "только сегодня",
      "последний шанс",
      "успей(те)?",
      "спеши(те)?",
      "осталось (всего )?\\d+ (час|мест)",
    ],
  },
  {
    code: "backapp.no_fear_manipulation",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "No fear-based manipulation.",
    patterns: [
      "\\b(before it'?s too late|it will (only )?get worse|you could die|could kill you|dangerous if you don'?t)\\b",
      "пока не (стало )?поздно",
      "станет только хуже",
    ],
  },
  {
    code: "backapp.no_guarantees",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "No guaranteed outcomes.",
    patterns: ["\\bguarantee(d|s)?\\b", "\\b100 ?%", "гарантир"],
  },
  {
    code: "backapp.no_aggressive_sales",
    ruleType: "forbidden_phrase",
    severity: "warn",
    rationale: "Avoid aggressive sales language; readers may be vulnerable.",
    patterns: ["\\b(buy now|subscribe now|don'?t miss out|best deal|\\d+ ?% off|discount)\\b", "купи(те)? (сейчас|прямо)", "скидк", "не упусти"],
  },
  {
    code: "backapp.crisis_safety_line",
    ruleType: "conditional_disclaimer",
    severity: "block",
    rationale:
      "Content that mentions suicide, self-harm or an emergency must include a safety line pointing to emergency services or a crisis line (exact wording to be approved by the owner, D-13).",
    patterns: {
      when: ["suicid", "self[- ]harm", "kill (my|your)self", "end (my|your) life", "суицид", "самоповрежд", "покончить с собой", "не хочу жить"],
      require: ["\\bemergency\\b", "\\b112\\b", "\\b911\\b", "crisis (line|service)", "hotline", "экстренн", "телефон доверия", "кризисн"],
    },
  },
  {
    code: "backapp.tone_calm",
    ruleType: "tone",
    severity: "warn",
    instruction: "Calm, human, warm, specific. No hype, exclamation chains, or pressure.",
    patterns: [],
  },
];
