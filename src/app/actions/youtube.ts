"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { approveDraft, receiveReply, rejectDraft, runDiscovery, updateYtSettings } from "@/server/services/youtube";
import { configuredSource, demoSource } from "@/server/youtube/source";
import { appUrl, notifyTelegram } from "@/server/notify/telegram";
import { fail, lines, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));

const settingsSchema = z.object({
  enabled: z.boolean(),
  brand_name: z.string().max(40).nullable(),
  queries: z.array(z.string().min(2).max(100)).min(1, "Add at least one search phrase.").max(20),
  languages: z.array(z.string().regex(/^[a-z]{2}$/, "Languages are two-letter codes, e.g. en, ru")).min(1),
  min_duration_seconds: z.coerce.number().int().min(0).max(3600),
  channel_cooldown_days: z.coerce.number().int().min(1).max(365),
  drafts_per_run: z.coerce.number().int().min(0).max(10),
  daily_publish_limit: z.coerce.number().int().min(0).max(10),
  published_within_days: z.coerce.number().int().min(1).max(90),
});

export async function saveYtSettingsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const parsed = settingsSchema.safeParse({
      enabled: data.get("enabled") === "on",
      brand_name: str(data.get("brand_name")) || null,
      queries: lines(data.get("queries")),
      languages: str(data.get("languages")).split(/[,\s]+/).filter(Boolean),
      min_duration_seconds: data.get("min_duration_seconds"),
      channel_cooldown_days: data.get("channel_cooldown_days"),
      drafts_per_run: data.get("drafts_per_run"),
      daily_publish_limit: data.get("daily_publish_limit"),
      published_within_days: data.get("published_within_days"),
    });
    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
    await db((tx, ctx) => updateYtSettings(tx, ctx.workspaceId, product.id, parsed.data), { reason: "YouTube settings changed" });
    revalidatePath(`/p/${slug}/conversations`);
    return ok(parsed.data.enabled ? "Saved. The daily search is on: drafts wait for your approval." : "Saved. The daily search is off.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function runYtDiscoveryAction(slug: string, mode: "api" | "demo", _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const source = mode === "demo" ? demoSource() : configuredSource();
    if (!source) return fail("The YouTube API key is not set yet (YOUTUBE_API_KEY). Use demo videos to try the flow, or add the key in Vercel.");
    const stats = await db((tx, ctx) => runDiscovery(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, source), { reason: `YouTube search (${mode})`, actorType: "ai" });
    if (mode === "api" && stats.draftsQueued > 0) {
      await notifyTelegram(`${product.name}: ${stats.draftsQueued} new YouTube comment draft(s) wait for your approval.\n${appUrl(`/p/${slug}/approvals`)}`);
    }
    revalidatePath(`/p/${slug}`, "layout");
    const errors = stats.errors.length ? ` Problems: ${stats.errors.join(" ")}` : "";
    return ok(`${stats.found} videos found, ${stats.newVideos} new, ${stats.eligible} suitable. ${stats.draftsQueued} drafts sent to the Approval Queue${stats.draftsRejected ? `, ${stats.draftsRejected} held back by the voice or safety checks` : ""}.${errors}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

/** A reply someone wrote under our YouTube comment, pasted in until replies are read through the API. */
export async function logYtReplyAction(slug: string, conversationId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const text = str(data.get("text"));
    if (!text) return fail("Paste what the person wrote.");
    const r = await db((tx, ctx) => receiveReply(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, conversationId, str(data.get("author")) || null, text), { reason: "YouTube reply received", actorType: "ai" });
    if (r.risk === "high") await notifyTelegram(`${product.name}: someone on YouTube may need urgent help. Please look now.\n${appUrl(`/p/${slug}/conversations?tab=youtube`)}`, { urgent: true });
    revalidatePath(`/p/${slug}`, "layout");
    return r.risk === "high"
      ? ok("Marked HIGH RISK. A short safety note without the product is waiting for your decision; answering at all is your call.")
      : ok(`Reply drafted and sent to the Approval Queue (${r.kind.replaceAll("_", " ")}).`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function approveYtDraftAction(slug: string, messageId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => approveDraft(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, messageId, str(data.get("text")) || null), { reason: "YouTube draft approved" });
    if (!r.ok) return fail(`Not approved: ${r.problems.join(" ")}`);
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Approved. Copy the text, open the video and post it from the Back channel, then press “I posted it”.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function rejectYtDraftAction(slug: string, messageId: string) {
  const product = await getProduct(slug);
  await db((tx, ctx) => rejectDraft(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, messageId), { reason: "YouTube draft rejected" });
  revalidatePath(`/p/${slug}`, "layout");
}
