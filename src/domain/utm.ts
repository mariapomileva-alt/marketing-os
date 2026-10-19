/**
 * UTM builder. Values are normalised to lowercase slugs so that analytics groupings do not split
 * on spelling ("Instagram" vs "instagram"). utm_content carries the creative id and is unique per product+campaign.
 */
export interface UtmInput {
  landingUrl: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term?: string | null;
}

export interface UtmLink {
  landingUrl: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string | null;
  fullUrl: string;
}

export function slugifyUtm(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export class UtmError extends Error {}

export function buildUtmLink(input: UtmInput): UtmLink {
  let url: URL;
  try {
    url = new URL(input.landingUrl);
  } catch {
    throw new UtmError("Landing URL is not a valid absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UtmError("Landing URL must use http or https");
  const parts = {
    utm_source: slugifyUtm(input.source),
    utm_medium: slugifyUtm(input.medium),
    utm_campaign: slugifyUtm(input.campaign),
    utm_content: slugifyUtm(input.content),
    utm_term: input.term ? slugifyUtm(input.term) : null,
  };
  for (const [k, v] of Object.entries(parts)) {
    if (k !== "utm_term" && !v) throw new UtmError(`${k} is empty after normalisation`);
  }
  // Existing utm_* parameters on the landing URL are replaced, other parameters are kept.
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  url.searchParams.set("utm_source", parts.utm_source);
  url.searchParams.set("utm_medium", parts.utm_medium);
  url.searchParams.set("utm_campaign", parts.utm_campaign);
  url.searchParams.set("utm_content", parts.utm_content);
  if (parts.utm_term) url.searchParams.set("utm_term", parts.utm_term);
  const landing = new URL(input.landingUrl);
  for (const key of [...landing.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) landing.searchParams.delete(key);
  return { landingUrl: landing.toString(), ...parts, fullUrl: url.toString() };
}

/** Default source/medium per channel; products can override with utm_templates. */
export const DEFAULT_UTM: Record<string, { source: string; medium: string }> = {
  instagram: { source: "instagram", medium: "social" },
  facebook: { source: "facebook", medium: "social" },
  threads: { source: "threads", medium: "social" },
  website: { source: "website", medium: "referral" },
  youtube: { source: "youtube", medium: "video" },
  tiktok: { source: "tiktok", medium: "social" },
  x: { source: "x", medium: "social" },
  linkedin: { source: "linkedin", medium: "social" },
  pinterest: { source: "pinterest", medium: "social" },
  snapchat: { source: "snapchat", medium: "social" },
  blog: { source: "blog", medium: "content" },
  email: { source: "newsletter", medium: "email" },
  meta_ads: { source: "meta", medium: "paid_social" },
  google_ads: { source: "google", medium: "cpc" },
};

/** Parses UTM parameters out of a URL (used to match imported conversions). */
export function parseUtm(url: string): Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term", string>> {
  try {
    const u = new URL(url);
    const out: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const v = u.searchParams.get(k);
      if (v) out[k] = v.toLowerCase();
    }
    return out;
  } catch {
    return {};
  }
}
