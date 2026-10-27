import type { ContentBody } from "./ai/schemas";

/** Formats available in v0.1 Content Studio, by channel. Others are planned (docs/mvp-scope.md). */
export const STUDIO_FORMATS: Record<string, { label: string; channels: string[] }> = {
  short_post: { label: "Short post", channels: ["threads", "facebook", "instagram"] },
  caption: { label: "Instagram caption", channels: ["instagram", "facebook"] },
  carousel: { label: "Carousel", channels: ["instagram", "facebook"] },
  reels_script: { label: "Reels script", channels: ["instagram", "facebook"] },
  helpful_comment: { label: "Helpful comment", channels: ["threads", "instagram", "facebook"] },
};

export const STUDIO_CHANNELS: Record<string, string> = {
  instagram: "Instagram",
  threads: "Threads",
  facebook: "Facebook Page",
  website: "Website",
};

/** The text a person would copy into the platform, in reading order. */
export function renderText(body: ContentBody, format: string): string {
  switch (format) {
    case "static_concept":
      return [...(body.slides ?? []).slice(0, 1).map((s) => `Card: ${s.title}${s.text ? `\n${s.text}` : ""}`), body.caption ? `\nCaption:\n${body.caption}` : ""].filter(Boolean).join("\n\n");
    case "carousel":
      return [
        ...(body.slides ?? []).map((s, i) => `Slide ${i + 1}: ${s.title}\n${s.text}`),
        body.caption ? `\nCaption:\n${body.caption}` : "",
      ].filter(Boolean).join("\n\n");
    case "reels_script":
      return [
        body.hook ? `Hook: ${body.hook}` : "",
        ...(body.script ?? []).map((l) => `${l.timecode}  ${l.line}\n    Visual: ${l.visual}`),
        body.caption ? `\nCaption:\n${body.caption}` : "",
      ].filter(Boolean).join("\n");
    case "helpful_comment":
      return body.comment ?? "";
    case "caption":
      return body.caption ?? "";
    default:
      return [body.hook, body.body, body.cta].filter(Boolean).join("\n\n");
  }
}

/** The text that is actually posted (excludes production notes such as visual directions). */
export function publishableText(body: ContentBody, format: string): string {
  switch (format) {
    case "carousel":
    case "reels_script":
    case "static_concept":
      return body.caption ?? "";
    default:
      return renderText(body, format);
  }
}

export function withUtm(text: string, utmUrl: string | null): string {
  if (!utmUrl) return text;
  return text.includes(utmUrl) ? text : `${text}\n\n${utmUrl}`;
}

/** Field-level diff between two bodies, stored with each human edit ("who changed what"). */
export function diffBodies(before: Record<string, unknown>, after: Record<string, unknown>): Array<{ field: string; before: unknown; after: unknown }> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const k of keys) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) out.push({ field: k, before: before?.[k] ?? null, after: after?.[k] ?? null });
  }
  return out;
}

/** Default primary metric by goal (editable before publication). */
export function defaultPrimaryMetric(goal: string): string {
  const g = goal.toLowerCase();
  if (g.includes("registration")) return "registrations";
  if (g.includes("trial")) return "trial_starts";
  if (g.includes("paid")) return "payments";
  if (g.includes("traffic")) return "clicks";
  if (g.includes("awareness")) return "reach";
  return "saves";
}
