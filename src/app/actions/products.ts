"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { seedDemo } from "@/server/services/demo";
import { createBackApp, createProduct, productInputSchema, profileUpdateSchema, slugify, updateProfile } from "@/server/services/products";
import { fail, lines, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

export async function createProductAction(_: ActionResult | null, data: FormData): Promise<ActionResult> {
  let slug = "";
  try {
    const name = str(data.get("name"));
    const input = productInputSchema.parse({
      name,
      slug: str(data.get("slug")) || slugify(name),
      short_description: str(data.get("short_description")),
      category: str(data.get("category")),
      website_url: str(data.get("website_url")),
    });
    const p = await db((tx, ctx) => createProduct(tx, ctx.workspaceId, input), { reason: "product created" });
    slug = p.slug;
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath("/", "layout");
  redirect(`/p/${slug}/products`);
}

export async function createBackAppAction() {
  const p = await db((tx, ctx) => createBackApp(tx, ctx.workspaceId), { reason: "Back App created with brief §6 rules" });
  revalidatePath("/", "layout");
  redirect(`/p/${p.slug}/products`);
}

export async function createDemoProductAction() {
  await db((tx, ctx) => seedDemo(tx, ctx.workspaceId), { reason: "demo product with invented, labelled data" });
  revalidatePath("/", "layout");
  redirect("/p/demo-calm/analytics");
}

export async function updateProfileAction(productSlug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(productSlug);
    const input = profileUpdateSchema.parse({
      name: str(data.get("name")),
      short_description: str(data.get("short_description")),
      category: str(data.get("category")),
      website_url: str(data.get("website_url")),
      countries: lines(data.get("countries")).flatMap((l) => l.split(/[,\s]+/)).filter(Boolean),
      pain_points: lines(data.get("pain_points")),
      triggers: lines(data.get("triggers")),
      desired_emotional_states: lines(data.get("desired_emotional_states")),
      customer_vocabulary: lines(data.get("customer_vocabulary")),
      advantages: lines(data.get("advantages")),
      prohibited_topics: lines(data.get("prohibited_topics")),
      legal_restrictions: str(data.get("legal_restrictions")),
      tone_of_voice: str(data.get("tone_of_voice")),
    });
    await db((tx) => updateProfile(tx, product.id, input), { reason: "profile edited" });
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath(`/p/${productSlug}`, "layout");
  return ok("Profile saved.");
}

export async function addClaimAction(productSlug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(productSlug);
    const kind = str(data.get("kind"));
    const statement = str(data.get("statement"));
    if (!["approved_fact", "prohibited_claim"].includes(kind)) return fail("Choose whether this is an approved fact or a prohibited claim.");
    if (!statement) return fail("Write the statement.");
    await db((tx, ctx) =>
      tx.query("insert into product_claims (workspace_id, product_id, kind, statement, rationale, approved_by, approved_at) values ($1,$2,$3,$4,$5,$6, now())", [
        ctx.workspaceId, product.id, kind, statement, str(data.get("rationale")), ctx.user.id,
      ]),
    );
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath(`/p/${productSlug}/products`);
  return ok("Saved.");
}

export async function approveClaimAction(productSlug: string, claimId: string) {
  const product = await getProduct(productSlug);
  await db((tx, ctx) => tx.query("update product_claims set approved_by = $3, approved_at = now() where id = $1 and product_id = $2", [claimId, product.id, ctx.user.id]));
  revalidatePath(`/p/${productSlug}/products`);
}

export async function archiveClaimAction(productSlug: string, claimId: string) {
  const product = await getProduct(productSlug);
  await db((tx) => tx.query("update product_claims set archived = true where id = $1 and product_id = $2", [claimId, product.id]));
  revalidatePath(`/p/${productSlug}/products`);
}

export async function toggleGuardrailAction(productSlug: string, id: string, active: boolean) {
  const product = await getProduct(productSlug);
  await db((tx) => tx.query("update product_guardrails set active = $3 where id = $1 and product_id = $2", [id, product.id, active]), {
    reason: active ? "guardrail enabled" : "guardrail disabled",
  });
  revalidatePath(`/p/${productSlug}/products`);
}

export async function addLinkAction(productSlug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(productSlug);
    const url = str(data.get("url"));
    if (!/^https?:\/\//i.test(url)) return fail("Links must start with https://");
    await db((tx, ctx) =>
      tx.query("insert into product_links (workspace_id, product_id, kind, label, url, cta_text) values ($1,$2,$3,$4,$5,$6)", [
        ctx.workspaceId, product.id, str(data.get("kind")) || "website", str(data.get("label")) || url, url, str(data.get("cta_text")) || null,
      ]),
    );
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath(`/p/${productSlug}/products`);
  return ok("Link added.");
}

export async function addLocaleAction(productSlug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(productSlug);
    const language = str(data.get("language")).toLowerCase();
    const country = str(data.get("country")).toUpperCase() || null;
    await db((tx, ctx) =>
      tx.query("insert into product_locales (workspace_id, product_id, language, country, is_primary) values ($1,$2,$3,$4,$5)", [
        ctx.workspaceId, product.id, language, country, data.get("is_primary") === "on",
      ]),
    );
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath(`/p/${productSlug}/products`);
  return ok("Language added.");
}

export async function addTermAction(productSlug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(productSlug);
    await db((tx, ctx) =>
      tx.query("insert into taxonomy_terms (workspace_id, product_id, vocabulary, label) values ($1,$2,$3,$4)", [ctx.workspaceId, product.id, str(data.get("vocabulary")), str(data.get("label"))]),
    );
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath(`/p/${productSlug}/products`);
  return ok("Added.");
}
