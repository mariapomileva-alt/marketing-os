/**
 * Deterministic guardrail engine. It runs before any AI review and its "block" findings cannot be
 * overridden by the AI or by approval: the text has to change. Patterns are case-insensitive unicode
 * regular expressions stored per product (product_guardrails) plus global rules that apply to every product.
 */
export type Severity = "block" | "warn";

export interface GuardrailRule {
  code: string;
  ruleType: "forbidden_phrase" | "forbidden_topic" | "required_disclaimer" | "tone" | "claim_check" | "conditional_disclaimer";
  patterns: unknown; // string[] for forbidden_phrase / required_disclaimer; {when: string[], require: string[]} for conditional_disclaimer
  instruction?: string;
  severity: Severity;
  rationale?: string;
  active?: boolean;
}

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  excerpt?: string;
  source: "global" | "product" | "format";
}

export interface CheckInput {
  text: string;
  channel: string;
  format: string;
  allowedHosts?: string[];
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "iu");
  } catch {
    return null;
  }
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function firstMatch(text: string, patterns: string[]): { pattern: string; match: RegExpExecArray } | null {
  for (const p of patterns) {
    const re = compile(p);
    if (!re) continue;
    const m = re.exec(text);
    if (m) return { pattern: p, match: m };
  }
  return null;
}

/** Rules that apply to every product (brief §11): no pretending to be a customer, no invented experience. */
export const GLOBAL_RULES: GuardrailRule[] = [
  {
    code: "global.no_customer_impersonation",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "AI must never pretend to be a customer or invent personal experience.",
    patterns: [
      "\\b(as a (long[- ]time )?(user|customer|client) (of|myself))\\b",
      "\\bI(?:'ve| have) been using (it|this app|the app) for\\b",
      "\\b(this app|it) (changed|saved) my life\\b",
      "как (давний )?(пользователь|клиент)",
      "я (уже )?(давно )?пользуюсь (этим )?приложением",
      "(это приложение|оно) (изменило|спасло) мою жизнь",
    ],
  },
  {
    code: "global.no_fake_reviews",
    ruleType: "forbidden_phrase",
    severity: "block",
    rationale: "No invented testimonials or ratings.",
    patterns: ["\\b(\\d{2,3}(,\\d{3})*\\+? (happy|satisfied) (users|customers))\\b", "\\b5[- ]star(s)? (reviews?|rating) from\\b", "тысяч(и)? довольных (пользователей|клиентов)"],
  },
];

/** Channel/format limits checked by code. */
export const FORMAT_LIMITS: Record<string, { maxChars?: number; maxHashtags?: number }> = {
  "threads:short_post": { maxChars: 500, maxHashtags: 1 },
  "threads:helpful_comment": { maxChars: 500, maxHashtags: 0 },
  "threads:thread": { maxChars: 500 },
  "instagram:caption": { maxChars: 2200, maxHashtags: 30 },
  "instagram:carousel": { maxChars: 2200, maxHashtags: 30 },
  "instagram:helpful_comment": { maxChars: 2200, maxHashtags: 0 },
  "facebook:short_post": { maxChars: 63206 },
  "x:short_post": { maxChars: 280 },
};

const URL_RE = /\bhttps?:\/\/[^\s)>\]]+/giu;

export function checkText(input: CheckInput, productRules: GuardrailRule[]): Finding[] {
  const findings: Finding[] = [];
  const text = input.text;
  const rules: Array<GuardrailRule & { source: "global" | "product" }> = [
    ...GLOBAL_RULES.map((r) => ({ ...r, source: "global" as const })),
    ...productRules.filter((r) => r.active !== false).map((r) => ({ ...r, source: "product" as const })),
  ];

  for (const rule of rules) {
    if (rule.ruleType === "forbidden_phrase") {
      const list = Array.isArray(rule.patterns) ? (rule.patterns as string[]) : [];
      const hit = firstMatch(text, list);
      if (hit) {
        findings.push({
          code: rule.code,
          severity: rule.severity,
          message: rule.rationale || `Matches a forbidden pattern (${rule.code}).`,
          excerpt: excerptAround(text, hit.match.index, hit.match[0].length),
          source: rule.source,
        });
      }
    } else if (rule.ruleType === "required_disclaimer") {
      const list = Array.isArray(rule.patterns) ? (rule.patterns as string[]) : [];
      if (list.length && !firstMatch(text, list)) {
        findings.push({ code: rule.code, severity: rule.severity, message: rule.rationale || "Required disclaimer is missing.", source: rule.source });
      }
    } else if (rule.ruleType === "conditional_disclaimer") {
      const p = (rule.patterns ?? {}) as { when?: string[]; require?: string[] };
      const trigger = firstMatch(text, p.when ?? []);
      if (trigger && !firstMatch(text, p.require ?? [])) {
        findings.push({
          code: rule.code,
          severity: rule.severity,
          message: rule.rationale || "This topic requires a safety line that is missing.",
          excerpt: excerptAround(text, trigger.match.index, trigger.match[0].length),
          source: rule.source,
        });
      }
    }
    // tone / claim_check / forbidden_topic are natural-language rules handled by the AI reviewers.
  }

  const limits = FORMAT_LIMITS[`${input.channel}:${input.format}`];
  if (limits?.maxChars && text.length > limits.maxChars) {
    findings.push({ code: "format.too_long", severity: "block", message: `Text is ${text.length} characters; ${input.channel} allows ${limits.maxChars}.`, source: "format" });
  }
  const hashtags = (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
  if (limits?.maxHashtags !== undefined && hashtags > limits.maxHashtags) {
    findings.push({ code: "format.hashtags", severity: "warn", message: `${hashtags} hashtags; recommended maximum here is ${limits.maxHashtags}.`, source: "format" });
  }
  if (input.allowedHosts) {
    for (const m of text.matchAll(URL_RE)) {
      let host = "";
      try {
        host = new URL(m[0]).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      if (!input.allowedHosts.includes(host)) {
        findings.push({ code: "links.unknown_host", severity: "block", message: `Link to ${host}, which is not one of this product's links.`, excerpt: m[0], source: "format" });
      } else if (!/[?&]utm_source=/.test(m[0])) {
        findings.push({ code: "links.missing_utm", severity: "warn", message: "Link has no UTM parameters; use the UTM builder.", excerpt: m[0], source: "format" });
      }
    }
  }
  return findings;
}

export function outcomeOf(findings: Finding[]): "pass" | "warn" | "block" {
  if (findings.some((f) => f.severity === "block")) return "block";
  if (findings.length) return "warn";
  return "pass";
}

/** Collects every human-readable string in a content body for checking. */
export function flattenBody(body: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(body);
  return parts.join("\n");
}
