import { z } from "zod";

/** Every AI variant explains itself (brief §9). Claims to verify are listed, never silently asserted. */
export const rationaleSchema = z.object({
  for_whom: z.string().min(1),
  addresses: z.string().min(1).describe("Which Job or fear it addresses"),
  insight_source: z.string().min(1).describe("Where the insight came from (source titles or ids)"),
  difference: z.string().min(1).describe("How it differs from the other variants"),
  claims_to_verify: z.array(z.string()),
  brand_risk: z.string().describe("Possible conflict with the brand, or 'none identified'"),
  intended_outcome: z.string().min(1).describe("Intended outcome; no predicted numbers"),
});

export const hooksOutputSchema = z.object({
  variants: z
    .array(
      z.object({
        hook: z.string().min(3).max(300),
        hook_type: z.string().min(1),
        angle_name: z.string().min(1).max(80),
        angle_description: z.string().min(1),
        rationale: rationaleSchema,
        evidence_ids: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(6),
});
export type HooksOutput = z.infer<typeof hooksOutputSchema>;

export const carouselSlideSchema = z.object({ title: z.string(), text: z.string() });
export const scriptLineSchema = z.object({ timecode: z.string(), line: z.string(), visual: z.string() });

export const contentBodySchema = z.object({
  hook: z.string().optional(),
  body: z.string().optional(),
  cta: z.string().optional(),
  caption: z.string().optional(),
  slides: z.array(carouselSlideSchema).optional(),
  script: z.array(scriptLineSchema).optional(),
  posts: z.array(z.string()).optional(),
  comment: z.string().optional(),
  subject: z.string().optional(),
});
export type ContentBody = z.infer<typeof contentBodySchema>;

export const contentOutputSchema = z.object({
  variants: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        body: contentBodySchema,
        visual_concept: z.string().default(""),
        rationale: rationaleSchema,
        evidence_ids: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(4),
});
export type ContentOutput = z.infer<typeof contentOutputSchema>;

export const reviewOutputSchema = z.object({
  outcome: z.enum(["pass", "warn", "block"]),
  findings: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["warn", "block"]),
      message: z.string(),
      excerpt: z.string().optional(),
    }),
  ),
});
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

export const experimentReviewSchema = z.object({
  observations: z.array(z.string()),
  hypotheses: z.array(z.string()),
  next_action: z.string(),
  confirming_metric: z.string(),
});
export type ExperimentReviewOutput = z.infer<typeof experimentReviewSchema>;

/** YouTube comment drafts: a plain helpful one, and one that mentions the product openly (or skip). */
export const communityCommentSchema = z.object({
  responds_to: z.string().min(1).describe("The specific thought from the video the comment reacts to"),
  skip: z.boolean().describe("true when no comment from the team would be welcome here"),
  skip_reason: z.string().default(""),
  variants: z
    .array(
      z.object({
        variant: z.enum(["helpful", "with_mention"]),
        text: z.string().min(1).max(900),
      }),
    )
    .max(2),
});
export type CommunityCommentOutput = z.infer<typeof communityCommentSchema>;

/** A reply in an existing thread, with the drafter's own reading of the situation first. */
export const communityReplySchema = z.object({
  understanding: z.string().min(1).describe("What the person is really saying or asking"),
  may_mention_product: z.boolean(),
  handoff_to_human: z.boolean().describe("true when a person should decide whether to answer at all"),
  text: z.string().min(1).max(900),
});
export type CommunityReplyOutput = z.infer<typeof communityReplySchema>;

/** A calm affirmation video for YouTube: spoken lines with pauses, plus the YouTube title, description and tags. */
export const calmVideoSchema = z.object({
  title: z.string().min(10).max(95).describe("YouTube title, natural and searchable, no clickbait"),
  description: z.string().min(80).max(2500),
  tags: z.array(z.string().min(2).max(40)).min(3).max(15),
  lines: z
    .array(z.object({ text: z.string().min(2).max(110), pause: z.number().min(1).max(15).describe("Seconds of quiet after the line") }))
    .min(30)
    .max(140),
});
export type CalmVideoOutput = z.infer<typeof calmVideoSchema>;

/** The owner's morning brief: plain-language summary of yesterday and the week, what to do today, and outside news. */
const briefItem = z.object({
  text: z.string().min(3).max(320),
  section: z.string().max(40).nullable().describe("App section slug to open, e.g. analytics, conversations, calm, approvals; null if none"),
});
export const morningBriefSchema = z.object({
  greeting: z.string().min(3).max(120),
  summary: z.string().min(40).max(700).describe("Three or four calm sentences: the most important thing first"),
  spoken: z.string().min(80).max(1800).describe("The same brief as natural speech, 45–90 seconds when read aloud"),
  worked: z.array(briefItem).max(5),
  done: z.array(briefItem).max(6),
  todo: z.array(briefItem.extend({ why: z.string().max(200) })).max(5),
  missing: z.array(briefItem).max(4),
  outside: z
    .array(z.object({ kind: z.enum(["trend", "competitor", "platform"]), text: z.string().min(10).max(320), idea: z.string().max(240), source_url: z.string().max(500).nullable() }))
    .max(5),
});
export type MorningBriefOutput = z.infer<typeof morningBriefSchema>;

/** Threads Studio: a small batch of our own Threads posts, each tagged so we can learn which kinds work. */
export const THREADS_FORMATS = ["tip", "myth", "normalize", "question", "article", "list", "trend", "product"] as const;
export const threadsBatchSchema = z.object({
  posts: z
    .array(
      z.object({
        format: z.enum(THREADS_FORMATS),
        topic: z.string().min(2).max(60).describe("2–4 words, e.g. 'night panic', 'breathing', 'panic in public'"),
        source_kind: z.enum(["article", "knowledge", "product", "trend"]),
        source_title: z.string().max(200).nullable(),
        source_url: z.string().max(500).nullable().describe("Our article URL for 'article' posts, or the page read for 'trend' posts"),
        text: z.string().min(40).max(480),
        why: z.string().max(240).describe("One line: why this could resonate"),
      }),
    )
    .min(1)
    .max(4),
});
export type ThreadsBatchOutput = z.infer<typeof threadsBatchSchema>;

/** Content desk: a morning's ready-to-approve Instagram posts, carousels and article ideas, each with its research. */
export const HOOK_MECHANISMS = ["question", "statement", "micro_step", "story", "myth", "number"] as const;
/** Scenes recorded from the real app that a Reel can use (see scripts/reels/shots). */
export const REEL_SHOTS = ["home", "breathe", "try_another", "ground", "listen", "move", "read", "distract", "call_person"] as const;
export const reelSpecSchema = z.object({
  intro_style: z.enum(["dark", "light"]),
  intro_lines: z.array(z.string().min(1).max(28)).min(1).max(4).describe("The hook as 1–4 short lines shown one by one in the first two seconds"),
  scenes: z.array(z.object({ shot: z.enum(REEL_SHOTS), caption: z.string().max(48).default("") })).min(2).max(3),
});
export type ReelSpec = z.infer<typeof reelSpecSchema>;
export const contentDeskSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["post", "carousel", "article", "reel"]),
        topic: z.string().min(2).max(60).describe("2–4 words"),
        insight: z.string().min(10).max(400).describe("What the research found: the real need, question or pattern behind this piece"),
        why_now: z.string().max(300).describe("Why this, now: a trend, a question people asked us, a gap, what worked before"),
        sources: z.array(z.object({ title: z.string().max(200), url: z.string().max(500).nullable() })).max(4).default([]),
        hooks: z.array(z.object({ text: z.string().min(5).max(110), mechanism: z.enum(HOOK_MECHANISMS) })).min(3).max(3),
        chosen_hook: z.number().int().min(0).max(2),
        caption: z.string().max(2000).default("").describe("Instagram caption (posts, carousels) or a 2–3 sentence summary (articles)"),
        slides: z.array(z.object({ title: z.string().min(2).max(110), text: z.string().max(240).default("") })).max(8).default([]),
        reel: reelSpecSchema.nullable().default(null),
        article: z
          .object({
            title: z.string().max(110),
            search_query: z.string().max(110),
            answer_first: z.string().max(600).describe("40–60 words that answer the title's question directly"),
            outline: z.array(z.string().max(160)).min(3).max(8),
          })
          .nullable()
          .default(null),
      }),
    )
    .min(1)
    .max(8),
});
export type ContentDeskOutput = z.infer<typeof contentDeskSchema>;
