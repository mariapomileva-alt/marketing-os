import { estimateTokens } from "../knowledge/chunker";
import type { GenerateRequest, GenerateResult, LLMProvider } from "./types";

/**
 * Deterministic MOCK provider. Used in development, tests and demos. Every string it produces starts
 * with "[MOCK]" so it can never be mistaken for real generated copy, and its reviews never "pass":
 * they return a warning that no AI review was performed.
 */
type Ctx = Record<string, unknown>;
const s = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v : fallback);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const HOOK_PATTERNS = [
  { type: "question", angle: "Name the moment", make: (job: string) => `What if the next wave of panic didn't have to be faced alone? (${job})` },
  { type: "statement", angle: "Normalise the experience", make: (job: string) => `Your body is loud right now. That is not the same as danger. (${job})` },
  { type: "micro_step", angle: "One small step", make: (job: string) => `One thing to try in the next 60 seconds. (${job})` },
  { type: "story_frame", angle: "Moment of relief", make: (job: string) => `The minute after the wave passes. (${job})` },
];

function mockHooks(c: Ctx) {
  const job = s(c.jobStatement, "the selected Job");
  const count = Math.min(Math.max(Number(c.count ?? 3), 1), 4);
  const sources = arr<{ id: string; title: string }>(c.sources);
  const fear = s(arr<string>(c.fears)[0], "no fear selected");
  return {
    variants: HOOK_PATTERNS.slice(0, count).map((p, i) => ({
      hook: `[MOCK] ${p.make(job)}`,
      hook_type: p.type,
      angle_name: p.angle,
      angle_description: `[MOCK] Angle "${p.angle}" for ${s(c.segmentName, "the selected segment")}.`,
      rationale: {
        for_whom: s(c.segmentName, "Selected segment"),
        addresses: i === 1 ? `Fear: ${fear}` : `Job: ${job}`,
        insight_source: sources.length ? sources.map((x) => x.title).join("; ") : "No sources selected",
        difference: `Variant ${i + 1} uses a ${p.type.replace("_", " ")} opening.`,
        claims_to_verify: [],
        brand_risk: "none identified (mock)",
        intended_outcome: "Stop the scroll for people in this situation and invite them to read on.",
      },
      evidence_ids: sources.map((x) => x.id),
    })),
  };
}

function mockContent(c: Ctx) {
  const format = s(c.format, "short_post");
  const hook = s(c.hook, "[MOCK] Hook");
  const product = s(c.productName, "the product");
  const cta = s(c.cta, "Learn more");
  const job = s(c.jobStatement, "the selected Job");
  const sources = arr<{ id: string; title: string }>(c.sources);
  const base = {
    for_whom: s(c.segmentName, "Selected segment"),
    addresses: `Job: ${job}`,
    insight_source: sources.length ? sources.map((x) => x.title).join("; ") : "No sources selected",
    claims_to_verify: [] as string[],
    brand_risk: "none identified (mock)",
    intended_outcome: "Invite the reader to take one small next step.",
  };
  const variants = ["Calm and direct", "Warm and personal"].map((label, i) => {
    let body: Record<string, unknown>;
    const tone = i === 0 ? "Short, plain sentences." : "A gentler, second-person voice.";
    switch (format) {
      case "carousel":
        body = {
          caption: `[MOCK] ${hook}\n\n${tone} ${cta}.`,
          slides: [
            { title: `[MOCK] ${hook}`, text: "Slide 1: name the moment." },
            { title: "[MOCK] What is happening", text: "Slide 2: explain in plain words." },
            { title: "[MOCK] One thing to try", text: "Slide 3: one concrete step." },
            { title: "[MOCK] When to get help", text: "Slide 4: when to contact a professional or emergency services." },
            { title: `[MOCK] ${product}`, text: `Slide 5: ${cta}.` },
          ],
        };
        break;
      case "reels_script":
        body = {
          hook: `[MOCK] ${hook}`,
          script: [
            { timecode: "00:00–00:03", line: `[MOCK] ${hook}`, visual: "Close-up, soft natural light" },
            { timecode: "00:03–00:08", line: "[MOCK] Name what the body is doing.", visual: "Hands on chest, slow breathing" },
            { timecode: "00:08–00:15", line: "[MOCK] One step to try now.", visual: "Text overlay with the step" },
            { timecode: "00:15–00:20", line: `[MOCK] ${cta}.`, visual: `${product} screen, calm palette` },
          ],
          caption: `[MOCK] ${hook} ${tone}`,
        };
        break;
      case "helpful_comment":
        body = { comment: `[MOCK] ${tone} A practical thought about ${job}, without mentioning the product unless asked.` };
        break;
      case "caption":
        body = { caption: `[MOCK] ${hook}\n\n${tone} Something useful about ${job}.\n\n${cta}.` };
        break;
      default:
        body = { hook: `[MOCK] ${hook}`, body: `[MOCK] ${tone} Something useful about ${job}.`, cta: `[MOCK] ${cta}` };
    }
    return {
      label,
      body,
      visual_concept: i === 0 ? "[MOCK] Plain background, one line of text, deep green accent" : "[MOCK] Warm photo of a quiet moment, no faces in distress",
      rationale: { ...base, difference: i === 0 ? "Direct and brief." : "Warmer, more personal wording." },
      evidence_ids: sources.map((x) => x.id),
    };
  });
  return { variants };
}

function mockReview(task: string) {
  return {
    outcome: "warn" as const,
    findings: [
      {
        code: "mock.review_not_performed",
        severity: "warn" as const,
        message: `[MOCK] No ${task.replace("_", " ")} was performed: the mock AI provider is active. Only the deterministic guardrails ran.`,
      },
    ],
  };
}

function mockExperimentReview() {
  return {
    observations: ["[MOCK] No AI analysis was performed; see the computed numbers."],
    hypotheses: [],
    next_action: "[MOCK] Connect a real AI provider to get a drafted review, or write the conclusion yourself.",
    confirming_metric: "—",
  };
}

export class MockProvider implements LLMProvider {
  readonly id = "mock" as const;
  readonly isMock = true;

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const started = Date.now();
    const c = req.context ?? {};
    const raw =
      req.task === "hooks" ? mockHooks(c)
      : req.task === "content" ? mockContent(c)
      : req.task === "experiment_review" ? mockExperimentReview()
      : mockReview(req.task);
    const output = req.schema.parse(raw);
    const rawText = JSON.stringify(raw);
    return {
      output,
      raw: rawText,
      usage: { inputTokens: estimateTokens(req.system + req.input), outputTokens: estimateTokens(rawText) },
      costUsd: 0,
      model: "mock-1",
      provider: "mock",
      isMock: true,
      latencyMs: Date.now() - started,
    };
  }

  /** Deterministic hashed bag-of-words embedding (256 dims). Good enough to exercise search; labelled mock. */
  async embed(texts: string[]) {
    const dims = 256;
    const vectors = texts.map((t) => {
      const v = new Array<number>(dims).fill(0);
      for (const w of t.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
        let h = 2166136261;
        for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
        v[Math.abs(h) % dims] += 1;
      }
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / norm);
    });
    return { vectors, model: "mock-embed-256", dims };
  }
}
