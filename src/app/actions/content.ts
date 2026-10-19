"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { createIdea, createUtmForItem, decideApproval, editContent, generateContent, generateHooks, markPublished, runReviews, scheduleItem, submitForApproval } from "@/server/services/content";
import { contentBodySchema } from "@/domain/ai/schemas";
import { STUDIO_FORMATS } from "@/domain/content";
import { BudgetExceededError } from "@/domain/ai/types";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const actorOf = (ctx: { workspaceId: string; user: { id: string } }) => ({ workspaceId: ctx.workspaceId, userId: ctx.user.id });
const nullable = (v: FormDataEntryValue | null) => str(v) || null;
const describe = (e: unknown) => (e instanceof BudgetExceededError ? e.message : describeDbError(e) === "Unexpected database error." && e instanceof Error ? e.message : describeDbError(e));

export async function createIdeaAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  let id = "";
  try {
    const product = await getProduct(slug);
    const title = str(data.get("title"));
    if (!title) return fail("Give the idea a short title.");
    const r = await db((tx, ctx) =>
      createIdea(tx, actorOf(ctx), product.id, {
        title,
        insight: str(data.get("insight")),
        audienceId: null,
        segmentId: nullable(data.get("segment_id")),
        jobId: nullable(data.get("job_id")),
        fearId: nullable(data.get("fear_id")),
        quoteId: nullable(data.get("quote_id")),
        signalId: nullable(data.get("signal_id")),
        topic: str(data.get("topic")),
        funnelStage: nullable(data.get("funnel_stage")),
        sourceIds: data.getAll("source_ids").map(String).filter(Boolean),
      }),
    { reason: "idea created" });
    id = r.id;
  } catch (e) {
    return toFailure(e, describe);
  }
  revalidatePath(`/p/${slug}/ideas`);
  redirect(`/p/${slug}/ideas/${id}`);
}

export async function generateHooksAction(slug: string, ideaId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const count = Math.min(Math.max(Number(data.get("count") ?? 3), 1), 4);
    const r = await db((tx, ctx) => generateHooks(tx, actorOf(ctx), product.id, ideaId, count), { actorType: "ai", reason: "hook generation requested" });
    revalidatePath(`/p/${slug}/ideas/${ideaId}`);
    return ok(`${r.count} hook variants proposed${r.isMock ? " by the mock provider" : ""}.`);
  } catch (e) {
    return toFailure(e, describe);
  }
}

export async function generateContentAction(slug: string, ideaId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  let first = "";
  try {
    const product = await getProduct(slug);
    const format = str(data.get("format"));
    const channel = str(data.get("channel"));
    if (!STUDIO_FORMATS[format]?.channels.includes(channel)) return fail(`${STUDIO_FORMATS[format]?.label ?? format} is not available for ${channel} in this version.`);
    const hookId = str(data.get("hook_id"));
    if (!hookId) return fail("Choose a hook first.");
    const r = await db((tx, ctx) =>
      generateContent(tx, actorOf(ctx), product.id, {
        ideaId, hookId, channel, format, goal: str(data.get("goal")), language: str(data.get("language")) || "en",
        ctaTermId: nullable(data.get("cta_term_id")), campaignId: nullable(data.get("campaign_id")),
      }),
    { actorType: "ai", reason: "content generation requested" });
    first = r.itemIds[0];
  } catch (e) {
    return toFailure(e, describe);
  }
  revalidatePath(`/p/${slug}/studio`);
  redirect(`/p/${slug}/studio/${first}`);
}

export async function saveEditAction(slug: string, itemId: string, format: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    let body: Record<string, unknown> = {};
    if (format === "carousel") {
      const titles = data.getAll("slide_title").map(String);
      const texts = data.getAll("slide_text").map(String);
      body = { caption: str(data.get("caption")), slides: titles.map((t, i) => ({ title: t.trim(), text: (texts[i] ?? "").trim() })).filter((s) => s.title || s.text) };
    } else if (format === "reels_script") {
      const tc = data.getAll("line_timecode").map(String);
      const ln = data.getAll("line_text").map(String);
      const vi = data.getAll("line_visual").map(String);
      body = { hook: str(data.get("hook")), caption: str(data.get("caption")), script: tc.map((t, i) => ({ timecode: t.trim(), line: (ln[i] ?? "").trim(), visual: (vi[i] ?? "").trim() })).filter((l) => l.line) };
    } else if (format === "helpful_comment") body = { comment: str(data.get("comment")) };
    else if (format === "caption") body = { caption: str(data.get("caption")) };
    else body = { hook: str(data.get("hook")), body: str(data.get("body")), cta: str(data.get("cta")) };
    const parsed = contentBodySchema.parse(body);
    const r = await db((tx, ctx) => editContent(tx, actorOf(ctx), product.id, itemId, parsed, str(data.get("visual_concept")), str(data.get("edit_note"))), { reason: "manual edit" });
    revalidatePath(`/p/${slug}/studio/${itemId}`);
    return r.changed ? ok("Saved as a new version. Run the reviews again before sending it for approval.") : ok("No changes to save.");
  } catch (e) {
    return toFailure(e, describe);
  }
}

export async function runReviewsAction(slug: string, itemId: string) {
  const product = await getProduct(slug);
  await db((tx, ctx) => runReviews(tx, actorOf(ctx), product.id, itemId), { actorType: "ai", reason: "reviews requested" });
  revalidatePath(`/p/${slug}/studio/${itemId}`);
}

export async function createUtmAction(slug: string, itemId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const landing = str(data.get("landing_url"));
    if (!landing) return fail("Choose a landing page.");
    const r = await db((tx, ctx) => createUtmForItem(tx, actorOf(ctx), product.id, itemId, landing), { reason: "UTM link created" });
    revalidatePath(`/p/${slug}/studio/${itemId}`);
    return ok(`Link ready: ${r.full_url}`);
  } catch (e) {
    return toFailure(e, describe);
  }
}

export async function submitForApprovalAction(slug: string, itemId: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    await db((tx, ctx) => submitForApproval(tx, actorOf(ctx), product.id, itemId), { reason: "sent to approval queue" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Sent to the Approval Queue.");
  } catch (e) {
    return toFailure(e, describe);
  }
}

export async function decideApprovalAction(slug: string, approvalId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const decision = str(data.get("decision")) as "approved" | "rejected" | "changes_requested";
    if (!["approved", "rejected", "changes_requested"].includes(decision)) return fail("Choose a decision.");
    const note = str(data.get("note"));
    if (decision !== "approved" && !note) return fail("Add a short note so the reason is visible later.");
    await db((tx, ctx) => decideApproval(tx, actorOf(ctx), product.id, approvalId, decision, note), { reason: `approval: ${decision}` });
    revalidatePath(`/p/${slug}`, "layout");
    return ok(decision === "approved" ? "Approved." : decision === "rejected" ? "Rejected." : "Sent back for changes.");
  } catch (e) {
    return toFailure(e, describe);
  }
}

export async function scheduleAction(slug: string, itemId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const raw = str(data.get("scheduled_for"));
    const when = raw ? new Date(raw) : null;
    if (raw && Number.isNaN(when!.getTime())) return fail("Choose a valid date and time.");
    await db((tx) => scheduleItem(tx, product.id, itemId, when), { reason: when ? "scheduled" : "unscheduled" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok(when ? "Placed on the calendar." : "Removed from the calendar.");
  } catch (e) {
    return toFailure(e, describe);
  }
}

export async function markPublishedAction(slug: string, itemId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const raw = str(data.get("published_at"));
    const at = raw ? new Date(raw) : new Date();
    await db((tx, ctx) => markPublished(tx, actorOf(ctx), product.id, itemId, str(data.get("external_url")), at), { reason: "marked as published" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Marked as published. Its experiment is now locked and ready for metrics.");
  } catch (e) {
    return toFailure(e, describe);
  }
}

export async function backToDraftAction(slug: string, itemId: string) {
  const product = await getProduct(slug);
  await db((tx) => tx.query("update content_items set status = 'draft', scheduled_for = null where id = $1 and product_id = $2 and status in ('approved','scheduled','rejected')", [itemId, product.id]), { reason: "sent back to draft" });
  revalidatePath(`/p/${slug}`, "layout");
}

export async function updateExperimentAction(slug: string, itemId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const minSample = str(data.get("min_sample"));
    await db((tx) =>
      tx.query(
        `update experiments set hypothesis = $3, primary_metric = $4, counter_metric = $5, min_sample = $6, window_days = $7, production_cost = $8
          where content_item_id = $1 and product_id = $2`,
        [itemId, product.id, str(data.get("hypothesis")), str(data.get("primary_metric")), str(data.get("counter_metric")) || null, minSample ? Number(minSample) : null,
         Number(str(data.get("window_days")) || 14), str(data.get("production_cost")) ? Number(str(data.get("production_cost"))) : null],
      ),
    { reason: "experiment pre-registration edited" });
    revalidatePath(`/p/${slug}/studio/${itemId}`);
    return ok("Experiment plan saved.");
  } catch (e) {
    return toFailure(e, describe);
  }
}
