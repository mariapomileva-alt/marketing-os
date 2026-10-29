import { z } from "zod";
import type { Tx } from "@/server/db/client";
import { BACK_APP, BACK_APP_CLAIMS, BACK_APP_GUARDRAILS } from "@/domain/seed/back-app";
import { DEFAULT_UTM } from "@/domain/utm";
import { BACK_RULES_DOC, BACK_RULES_PACK, BACK_RULES_PACK_GUARDRAILS } from "@/domain/seed/back-rules-2026-10";
import { ingestSource } from "./knowledge";
import { MOMENTRO, MOMENTRO_BRIEF, MOMENTRO_CLAIMS, MOMENTRO_GUARDRAILS } from "@/domain/seed/momentro";

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, "Use 2–48 lowercase letters, digits or hyphens"),
  short_description: z.string().trim().max(400).default(""),
  category: z.string().trim().max(120).default(""),
  website_url: z.union([z.literal(""), z.string().trim().url("Website must be a full URL")]).default(""),
});
export type ProductInput = z.infer<typeof productInputSchema>;

/** Default controlled vocabularies so analytics can group by format, CTA, goal and funnel stage from day one. */
const DEFAULT_TERMS: Record<string, string[]> = {
  format: ["Short post", "Long post", "Carousel", "Reels script", "Caption", "Thread", "Helpful comment", "Article", "Email", "Ad creative"],
  goal: ["Awareness", "Engagement", "Traffic", "Registrations", "Trial starts", "Paid subscriptions"],
  funnel_stage: ["Unaware", "Problem aware", "Solution aware", "Product aware", "Customer"],
  cta: ["Download the app", "Try it now", "Read more", "Save this post", "Share with a friend", "Visit the website"],
  topic: [],
};

export function slugify(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "product";
}

export async function createProduct(tx: Tx, workspaceId: string, input: ProductInput, opts: { isDemo?: boolean } = {}) {
  const p = await tx.one<{ id: string; slug: string }>(
    `insert into products (workspace_id, slug, name, short_description, category, website_url, is_demo)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, slug`,
    [workspaceId, input.slug, input.name, input.short_description, input.category, input.website_url || null, opts.isDemo ?? false],
  );
  await tx.query("insert into brand_profiles (product_id, workspace_id) values ($1,$2)", [p.id, workspaceId]);
  for (const [vocabulary, labels] of Object.entries(DEFAULT_TERMS)) {
    for (const label of labels) {
      await tx.query("insert into taxonomy_terms (workspace_id, product_id, vocabulary, label) values ($1,$2,$3,$4)", [workspaceId, p.id, vocabulary, label]);
    }
  }
  for (const channel of ["instagram", "facebook", "threads", "website", "meta_ads", "google_ads"]) {
    const d = DEFAULT_UTM[channel];
    await tx.query("insert into utm_templates (workspace_id, product_id, channel, utm_source, utm_medium) values ($1,$2,$3,$4,$5)", [workspaceId, p.id, channel, d.source, d.medium]);
  }
  await tx.query(
    "insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing",
    [workspaceId],
  );
  return p;
}

/** Back App with its rules from the brief §6 (real configuration, pending owner approval of wording). */
export async function createBackApp(tx: Tx, workspaceId: string) {
  const existing = await tx.maybeOne<{ id: string; slug: string }>("select id, slug from products where workspace_id = $1 and slug = $2", [workspaceId, BACK_APP.slug]);
  if (existing) return existing;
  const p = await createProduct(tx, workspaceId, {
    name: BACK_APP.name,
    slug: BACK_APP.slug,
    short_description: BACK_APP.short_description,
    category: BACK_APP.category,
    website_url: "",
  });
  await tx.query("update products set legal_restrictions = $2, prohibited_topics = $3 where id = $1", [p.id, BACK_APP.legal_restrictions, BACK_APP.prohibited_topics]);
  await tx.query("update brand_profiles set tone_of_voice = $2 where product_id = $1", [p.id, BACK_APP.tone_of_voice]);
  for (const c of BACK_APP_CLAIMS) {
    await tx.query("insert into product_claims (workspace_id, product_id, kind, statement, rationale) values ($1,$2,$3,$4,$5)", [workspaceId, p.id, c.kind, c.statement, c.rationale]);
  }
  for (const g of BACK_APP_GUARDRAILS) {
    await tx.query(
      `insert into product_guardrails (workspace_id, product_id, code, rule_type, patterns, instruction, severity, rationale)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [workspaceId, p.id, g.code, g.ruleType, JSON.stringify(g.patterns ?? []), g.instruction ?? "", g.severity, g.rationale ?? ""],
    );
  }
  return p;
}

/** Momentro with its facts, rules and marketing brief (from the team's own site). Its connections start empty. */
export async function createMomentro(tx: Tx, workspaceId: string) {
  const existing = await tx.maybeOne<{ id: string; slug: string }>("select id, slug from products where workspace_id = $1 and slug = $2", [workspaceId, MOMENTRO.slug]);
  if (existing) return existing;
  const p = await createProduct(tx, workspaceId, { name: MOMENTRO.name, slug: MOMENTRO.slug, short_description: MOMENTRO.short_description, category: MOMENTRO.category, website_url: MOMENTRO.website_url });
  await tx.query(
    `update products set legal_restrictions = $2, prohibited_topics = $3, pain_points = $4, triggers = $5, desired_emotional_states = $6,
       customer_vocabulary = $7, advantages = $8, countries = $9, marketing_brief = $10 where id = $1`,
    [p.id, MOMENTRO.legal_restrictions, MOMENTRO.prohibited_topics, MOMENTRO.pain_points, MOMENTRO.triggers, MOMENTRO.desired_emotional_states,
     MOMENTRO.customer_vocabulary, MOMENTRO.advantages, ["GB", "US", "DE", "LV"], JSON.stringify(MOMENTRO_BRIEF)],
  );
  await tx.query("update brand_profiles set tone_of_voice = $2 where product_id = $1", [p.id, MOMENTRO.tone_of_voice]);
  for (const c of MOMENTRO_CLAIMS) {
    await tx.query("insert into product_claims (workspace_id, product_id, kind, statement, rationale) values ($1,$2,$3,$4,$5)", [workspaceId, p.id, c.kind, c.statement, c.rationale]);
  }
  for (const g of MOMENTRO_GUARDRAILS) {
    await tx.query(
      `insert into product_guardrails (workspace_id, product_id, code, rule_type, patterns, instruction, severity, rationale)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [workspaceId, p.id, g.code, g.ruleType, JSON.stringify(g.patterns ?? []), g.instruction ?? "", g.severity, g.rationale ?? ""],
    );
  }
  // Content desk: posts and carousels (no Reels until Momentro has its own recorded scene library), articles for momentro.me/guides.
  await tx.query(
    `insert into content_desk_settings (product_id, workspace_id, posts_per_day, carousels_per_day, reels_per_day, articles_per_week, slots)
     values ($1,$2,1,1,0,2,array['12:30','19:00']) on conflict (product_id) do nothing`,
    [p.id, workspaceId],
  );
  await tx.query("insert into site_settings (product_id, workspace_id, domain) values ($1,$2,'momentro.me') on conflict (product_id) do update set domain = excluded.domain", [p.id, workspaceId]);
  // Where the team joins conversations (both off until switched on): people talking about their clips and family films.
  await tx.query(
    `insert into yt_settings (product_id, workspace_id, queries, languages, brand_name) values ($1,$2,$3,'{en}','Momentro') on conflict (product_id) do nothing`,
    [p.id, workspaceId, ["family vacation video", "how to edit family videos", "organize family videos", "travel video from phone clips", "year in review family video"]],
  );
  await tx.query(
    "insert into threads_settings (product_id, workspace_id, queries) values ($1,$2,$3) on conflict (product_id) do nothing",
    [p.id, workspaceId, ["camera roll full of videos", "never edit my vacation videos", "family videos", "travel video", "so many clips"]],
  );
  return p;
}

export interface ProductProfile {
  id: string;
  slug: string;
  name: string;
  short_description: string;
  category: string;
  website_url: string | null;
  status: string;
  is_demo: boolean;
  countries: string[];
  pain_points: string[];
  triggers: string[];
  desired_emotional_states: string[];
  customer_vocabulary: string[];
  advantages: string[];
  prohibited_topics: string[];
  legal_restrictions: string;
  tone_of_voice: string;
  colors: Array<{ name: string; hex: string }>;
  fonts: Array<{ name: string; usage: string }>;
  good_examples: Array<{ text: string; why: string }>;
  bad_examples: Array<{ text: string; why: string }>;
}

export async function getProfile(tx: Tx, productId: string): Promise<ProductProfile> {
  return tx.one<ProductProfile>(
    `select p.id, p.slug, p.name, p.short_description, p.category, p.website_url, p.status, p.is_demo, p.countries, p.pain_points, p.triggers,
            p.desired_emotional_states, p.customer_vocabulary, p.advantages, p.prohibited_topics, p.legal_restrictions,
            coalesce(b.tone_of_voice, '') tone_of_voice, coalesce(b.colors, '[]') colors, coalesce(b.fonts, '[]') fonts,
            coalesce(b.good_examples, '[]') good_examples, coalesce(b.bad_examples, '[]') bad_examples
       from products p left join brand_profiles b on b.product_id = p.id where p.id = $1`,
    [productId],
  );
}

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  short_description: z.string().trim().max(400),
  category: z.string().trim().max(120),
  website_url: z.union([z.literal(""), z.string().trim().url("Website must be a full URL")]),
  countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Countries are 2-letter codes, e.g. LV")),
  pain_points: z.array(z.string().trim().min(1)),
  triggers: z.array(z.string().trim().min(1)),
  desired_emotional_states: z.array(z.string().trim().min(1)),
  customer_vocabulary: z.array(z.string().trim().min(1)),
  advantages: z.array(z.string().trim().min(1)),
  prohibited_topics: z.array(z.string().trim().min(1)),
  legal_restrictions: z.string().trim().max(4000),
  tone_of_voice: z.string().trim().max(4000),
});

export async function updateProfile(tx: Tx, productId: string, input: z.infer<typeof profileUpdateSchema>) {
  await tx.query(
    `update products set name=$2, short_description=$3, category=$4, website_url=$5, countries=$6, pain_points=$7, triggers=$8,
       desired_emotional_states=$9, customer_vocabulary=$10, advantages=$11, prohibited_topics=$12, legal_restrictions=$13 where id=$1`,
    [productId, input.name, input.short_description, input.category, input.website_url || null, input.countries, input.pain_points, input.triggers,
     input.desired_emotional_states, input.customer_vocabulary, input.advantages, input.prohibited_topics, input.legal_restrictions],
  );
  await tx.query("update brand_profiles set tone_of_voice = $2 where product_id = $1", [productId, input.tone_of_voice]);
}

export async function listClaims(tx: Tx, productId: string) {
  return tx.query<{ id: string; kind: string; statement: string; rationale: string; approved_at: string | null; archived: boolean }>(
    "select id, kind, statement, rationale, approved_at, archived from product_claims where product_id = $1 order by kind, created_at",
    [productId],
  );
}

export async function listGuardrails(tx: Tx, productId: string) {
  return tx.query<{ id: string; code: string; rule_type: string; patterns: unknown; instruction: string; severity: "block" | "warn"; rationale: string; active: boolean }>(
    "select id, code, rule_type, patterns, instruction, severity, rationale, active from product_guardrails where product_id = $1 order by severity, code",
    [productId],
  );
}

export async function listLinks(tx: Tx, productId: string) {
  return tx.query<{ id: string; kind: string; label: string; url: string; cta_text: string | null }>(
    "select id, kind, label, url, cta_text from product_links where product_id = $1 order by kind, created_at",
    [productId],
  );
}

export async function listLocales(tx: Tx, productId: string) {
  return tx.query<{ id: string; language: string; country: string | null; is_primary: boolean }>(
    "select id, language, country, is_primary from product_locales where product_id = $1 order by is_primary desc, language",
    [productId],
  );
}

export async function listTerms(tx: Tx, productId: string, vocabulary?: string) {
  return tx.query<{ id: string; vocabulary: string; label: string }>(
    `select id, vocabulary, label from taxonomy_terms where product_id = $1 and not archived ${vocabulary ? "and vocabulary = $2" : ""} order by vocabulary, label`,
    vocabulary ? [productId, vocabulary] : [productId],
  );
}

export async function allowedHosts(tx: Tx, productId: string): Promise<string[]> {
  const rows = await tx.query<{ url: string }>(
    "select url from product_links where product_id = $1 union all select website_url from products where id = $1 and website_url is not null",
    [productId],
  );
  const hosts = new Set<string>();
  for (const r of rows) {
    try {
      hosts.add(new URL(r.url).hostname.replace(/^www\./, ""));
    } catch {
      // ignore malformed
    }
  }
  return [...hosts];
}

const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.some((y) => y.trim().toLowerCase() === x.trim().toLowerCase()))];

/** Whether the rules pack of 26 Oct 2026 is already applied to this product. */
export async function rulesPackApplied(tx: Tx, productId: string) {
  return !!(await tx.maybeOne("select 1 from product_guardrails where product_id = $1 and code = $2", [productId, BACK_RULES_PACK_GUARDRAILS[0].code]));
}

/**
 * Applies "Back voice, phrases and rules (26 Oct 2026)": profile and tone, approved facts and prohibited claims,
 * new safety rules, links, and the full document as knowledge. Safe to run again: nothing is added twice, and lists
 * keep what the owner already wrote.
 */
export async function applyBackRulesPack(tx: Tx, actor: { workspaceId: string; userId: string }, productId: string) {
  const pk = BACK_RULES_PACK;
  const cur = await getProfile(tx, productId);
  await tx.query(
    `update products set short_description=$2, website_url=coalesce(nullif(website_url, ''), $3), countries=$4, pain_points=$5, triggers=$6,
       desired_emotional_states=$7, advantages=$8, prohibited_topics=$9, legal_restrictions=$10 where id=$1`,
    [productId, pk.profile.short_description, pk.profile.website_url, union(cur.countries, pk.profile.countries), union(cur.pain_points, pk.profile.pain_points),
     union(cur.triggers, pk.profile.triggers), union(cur.desired_emotional_states, pk.profile.desired_emotional_states), union(cur.advantages, pk.profile.advantages),
     union(cur.prohibited_topics, pk.profile.prohibited_topics), pk.profile.legal_restrictions],
  );
  const keep = <T extends { text: string }>(a: T[], b: T[]) => [...a, ...b.filter((x) => !a.some((y) => y.text === x.text))];
  await tx.query(
    "update brand_profiles set tone_of_voice = $2, good_examples = $3, bad_examples = $4 where product_id = $1",
    [productId, pk.profile.tone_of_voice, JSON.stringify(keep(cur.good_examples, pk.profile.good_examples)), JSON.stringify(keep(cur.bad_examples, pk.profile.bad_examples))],
  );

  const existing = new Set((await listClaims(tx, productId)).filter((c) => !c.archived).map((c) => `${c.kind}:${c.statement.trim().toLowerCase()}`));
  let claims = 0;
  for (const [kind, list] of [["approved_fact", pk.facts], ["prohibited_claim", pk.prohibited]] as const) {
    for (const statement of list) {
      if (existing.has(`${kind}:${statement.toLowerCase()}`)) continue;
      await tx.query(
        "insert into product_claims (workspace_id, product_id, kind, statement, rationale, approved_by, approved_at) values ($1,$2,$3,$4,$5,$6, now())",
        [actor.workspaceId, productId, kind, statement, pk.title, actor.userId],
      );
      claims++;
    }
  }

  let rules = 0;
  for (const g of BACK_RULES_PACK_GUARDRAILS) {
    const r = await tx.query(
      `insert into product_guardrails (workspace_id, product_id, code, rule_type, patterns, instruction, severity, rationale)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (product_id, code) do nothing returning id`,
      [actor.workspaceId, productId, g.code, g.ruleType, JSON.stringify(g.patterns ?? []), g.instruction ?? "", g.severity, g.rationale ?? ""],
    );
    rules += r.length;
  }
  // The crisis line wording is now approved (it was pending as D-13).
  await tx.query(
    "update product_guardrails set rationale = $2 where product_id = $1 and code = 'backapp.crisis_safety_line'",
    [productId, `Content that mentions suicide, self-harm or an emergency must include the emergency line. Approved wording: ${pk.crisisLine}`],
  );

  const links = await listLinks(tx, productId);
  let linksAdded = 0;
  for (const l of pk.links) {
    if (links.some((x) => x.url.replace(/\/$/, "") === l.url)) continue;
    await tx.query("insert into product_links (workspace_id, product_id, kind, label, url, cta_text) values ($1,$2,$3,$4,$5,$6)", [actor.workspaceId, productId, l.kind, l.label, l.url, l.cta_text]);
    linksAdded++;
  }

  const doc = await ingestSource(tx, {
    workspaceId: actor.workspaceId, productId, scope: "product", sourceType: "doc", title: pk.title, confidence: "high",
    containsPersonalData: false, consentRecorded: false, filename: "back-voice-and-rules.md", mimeType: "text/markdown",
    bytes: new TextEncoder().encode(BACK_RULES_DOC), provenance: { pack: pk.id, approvedBy: "owner" }, chunkAs: "markdown",
  });
  return { claims, rules, links: linksAdded, knowledgeChunks: doc.duplicate ? 0 : doc.chunks };
}
