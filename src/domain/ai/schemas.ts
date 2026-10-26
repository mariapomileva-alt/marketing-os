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
