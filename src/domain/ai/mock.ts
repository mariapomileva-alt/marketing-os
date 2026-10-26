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

function mockCommunityComment(c: Ctx) {
  const title = s(c.videoTitle, "this video");
  const product = s(c.productName, "the product");
  const n = Number(c.seed ?? 0);
  const openers = [
    "The part about the first minutes stayed with me",
    "Thank you for saying that breathing doesn't have to be perfect",
    "It helps to hear that the alarm in your body isn't the same as danger",
    "That reminder to slow down before doing anything else is so kind",
  ];
  const open = openers[Math.abs(n) % openers.length];
  return {
    responds_to: `[MOCK] A thought from "${title}"`,
    skip: false,
    skip_reason: "",
    variants: [
      { variant: "helpful" as const, text: `[MOCK] ${open}. When everything feels loud, one small step at a time is often all a person can hold. (${title.slice(0, 40)})` },
      { variant: "with_mention" as const, text: `[MOCK] ${open}. We're building ${product}, a small tool with short steps for exactly those minutes, so this felt very close to what we work on. (${title.slice(0, 40)})` },
    ],
  };
}

// Several shapes so mock replies in one thread do not trip the repetition check against each other.
function mockReplyText(message: string) {
  const quote = message.slice(0, 50);
  const shapes = [
    `[MOCK] About "${quote}": that makes sense. What usually helps you a little, even for a minute?`,
    `[MOCK] Thank you for writing back. "${quote}" sounds familiar to many people reading this thread.`,
    `[MOCK] You put "${quote}" so plainly. Has anything made those moments a bit softer lately?`,
  ];
  const n = [...message].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return shapes[n % shapes.length];
}

function mockCommunityReply(c: Ctx) {
  const danger = Boolean(c.highRisk);
  return danger
    ? { understanding: "[MOCK] The person may be in danger.", may_mention_product: false, handoff_to_human: true, text: "[MOCK] Thank you for telling us. Please contact your local emergency number or a crisis line right now. You don't have to go through this alone." }
    : { understanding: `[MOCK] The person is responding to our comment: "${s(c.message).slice(0, 60)}"`, may_mention_product: false, handoff_to_human: false, text: mockReplyText(s(c.message)) };
}

function mockCalmVideo(c: Ctx) {
  const topic = s(c.topic, "when panic rises");
  const theme = s(c.theme, "river");
  const base = [
    "You are here.", `You are watching the ${theme}.`, "Nothing is asked of you right now.", "Your body is sounding an alarm.",
    "Alarms are loud.", "Loud is not the same as dangerous.", "If you like, let your shoulders drop a little.", "Feel where your feet touch the floor.",
    "This wave has a top.", "You have been through waves before.", "You can let this moment be just this moment.", "Slowly, it is passing.",
  ];
  const lines = Array.from({ length: 36 }, (_, i) => ({ text: `[MOCK] ${base[i % base.length]}`, pause: i % 6 === 6 - 1 ? 9 : 4 }));
  return {
    title: `[MOCK] 10 Minute Calm for ${topic} · ${theme} affirmations`.slice(0, 95),
    description: `[MOCK] A slow video for ${topic}. Watch, breathe at your own pace, it's fine to stop.\n\nThis video is not medical advice. If you are in danger or think you might hurt yourself, contact your local emergency number now.\n\nMade by the team behind Back, a small app for the first minutes of panic: LINK`,
    tags: ["panic attack help", "calm affirmations", "anxiety relief", "panic attack at night"],
    lines,
  };
}

function mockMorningBrief(c: Ctx) {
  const f = (c.FACTS ?? {}) as { website?: { visits?: { yesterday?: number; last7?: number } }; waiting_for_you?: { approvals?: number } };
  const v = f.website?.visits ?? {};
  const waiting = f.waiting_for_you?.approvals ?? 0;
  return {
    greeting: "[MOCK] Доброе утро!",
    summary: `[MOCK] Вчера на сайт пришло ${v.yesterday ?? 0} человек, за неделю ${v.last7 ?? 0}. Это пример сводки: подключите Claude в Connections, и здесь появится настоящий разбор.`,
    spoken: `[MOCK] Доброе утро. Вчера на сайт пришло ${v.yesterday ?? 0} человек. Это пример голосовой сводки, настоящая появится после подключения Claude.`,
    worked: [{ text: "[MOCK] Здесь будет то, что откликнулось.", section: "analytics" }],
    done: [{ text: "[MOCK] Здесь будет то, что мы сделали вчера.", section: null }],
    todo: [{ text: `[MOCK] Посмотреть очередь одобрения (${waiting}).`, why: "Без вашего одобрения ничего не публикуется.", section: "approvals" }],
    missing: [{ text: "[MOCK] Продажи не видны: App Store Connect не подключён.", section: "connections" }],
    outside: [],
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
      : req.task === "community_comment" ? mockCommunityComment(c)
      : req.task === "community_reply" ? mockCommunityReply(c)
      : req.task === "calm_video" ? mockCalmVideo(c)
      : req.task === "morning_brief" ? mockMorningBrief(c)
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
