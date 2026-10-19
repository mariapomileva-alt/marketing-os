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
