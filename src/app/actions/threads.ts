"use server";

import { tiktokAccess, tiktokConnection } from "@/server/services/tiktok";
import { tiktokRefresh, tiktokRevoke } from "@/server/tiktok/api";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, getProduct, requireOwner } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { addInstagramReel, publishThreadsPost, refreshThreadsStats, runThreadsDiscovery, syncThreadsReplies, updateThreadsSettings } from "@/server/services/threads";
import { channelConnection } from "@/server/services/youtube-publish";
import { threadsApiSource, threadsDemoSource } from "@/server/threads/source";
import { liveInstagramApi, liveThreadsApi } from "@/server/youtube/live";
import { syncInstagramComments } from "@/server/services/instagram";
import { appUrl, notifyTelegram } from "@/server/notify/telegram";
import { fail, lines, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));
const actorOf = (ctx: { workspaceId: string; user: { id: string } }) => ({ workspaceId: ctx.workspaceId, userId: ctx.user.id });

const settingsSchema = z.object({
  enabled: z.boolean(),
  queries: z.array(z.string().min(2).max(100)).min(1, "Add at least one search phrase.").max(150, "At most 150 search phrases."),
  drafts_per_run: z.coerce.number().int().min(0).max(10),
  author_cooldown_days: z.coerce.number().int().min(1).max(365),
});

export async function saveThreadsSettingsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const parsed = settingsSchema.safeParse({ enabled: data.get("enabled") === "on", queries: lines(data.get("queries")), drafts_per_run: data.get("drafts_per_run"), author_cooldown_days: data.get("author_cooldown_days") });
    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
    await db((tx, ctx) => updateThreadsSettings(tx, ctx.workspaceId, product.id, parsed.data), { reason: "Threads settings changed" });
    revalidatePath(`/p/${slug}/conversations`);
    return ok(parsed.data.enabled ? "Saved. Threads is searched once a day; drafts wait for your approval." : "Saved. The daily Threads search is off.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function runThreadsDiscoveryAction(slug: string, mode: "api" | "demo", _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const stats = await db(async (tx, ctx) => {
      const live = mode === "api" ? await threadsApiSource(tx, product.id) : null;
      if (mode === "api" && !live) return null;
      return runThreadsDiscovery(tx, actorOf(ctx), product.id, live?.source ?? threadsDemoSource(), live?.ownUsername ?? null);
    }, { reason: `Threads search (${mode})`, actorType: "ai" });
    if (!stats) return fail("Threads is not connected yet: Connections → Connect Threads. Or try it with demo posts.");
    revalidatePath(`/p/${slug}`, "layout");
    const errors = stats.errors.length ? ` Problems: ${stats.errors.join(" ")}` : "";
    return ok(`${stats.found} posts found, ${stats.newPosts} new, ${stats.eligible} suitable. ${stats.draftsQueued} drafts wait for your approval${stats.draftsRejected ? `, ${stats.draftsRejected} held back by the checks` : ""}.${errors}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function syncThreadsAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const api = liveThreadsApi();
    const r = await db(async (tx, ctx) => {
      const sync = await syncThreadsReplies(tx, actorOf(ctx), product.id, api);
      const stats = await refreshThreadsStats(tx, actorOf(ctx), product.id, api).catch(() => ({ checked: 0 }));
      return { ...sync, statsChecked: stats.checked };
    }, { reason: "Threads replies and stats read", actorType: "ai" });
    if (r.highRisk) await notifyTelegram(`${product.name}: someone on Threads may need urgent help. Please look now.\n${appUrl(`/p/${slug}/conversations?tab=threads`)}`, { urgent: true });
    revalidatePath(`/p/${slug}`, "layout");
    const errors = r.errors.length ? ` Problems: ${r.errors.slice(0, 2).join(" ")}` : "";
    return ok(`${r.fresh} new repl${r.fresh === 1 ? "y" : "ies"}${r.fresh ? ", answers drafted for your approval" : ""}; likes and views updated.${errors}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

const reelSchema = z.object({
  url: z.string().regex(/^https:\/\/(www\.)?instagram\.com\//, "Paste the reel link from Instagram (https://www.instagram.com/reel/…)."),
  author: z.string().max(60).nullable(),
  text: z.string().min(15, "Write what the reel says or shows, in a sentence or two, so the comment can be specific.").max(3000),
});

export async function addInstagramReelAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const parsed = reelSchema.safeParse({ url: str(data.get("url")), author: str(data.get("author")) || null, text: str(data.get("text")) });
    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
    const r = await db((tx, ctx) => addInstagramReel(tx, actorOf(ctx), product.id, { ...parsed.data, author: parsed.data.author ? `@${parsed.data.author.replace(/^@/, "")}` : null }), { reason: "Instagram reel added", actorType: "ai" });
    revalidatePath(`/p/${slug}`, "layout");
    if (r.skipped) return ok("Not drafted: this reel may be about a crisis or a comment from the team would not fit. Decide yourself.");
    return ok(`${r.queued} comment draft${r.queued === 1 ? "" : "s"} ready below${r.rejected ? `, ${r.rejected} held back by the checks` : ""}.`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function publishThreadsPostAction(slug: string, itemId: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => publishThreadsPost(tx, actorOf(ctx), product.id, itemId, liveThreadsApi()), { reason: "Threads post published after approval" });
    revalidatePath(`/p/${slug}`, "layout");
    return r.published ? ok(`Published on Threads.${r.url ? ` ${r.url}` : ""}`) : fail(r.reason);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function disconnectThreadsAction(slug: string) {
  await requireOwner();
  const product = await getProduct(slug);
  await db(async (tx) => {
    const conn = await channelConnection(tx, product.id, "threads");
    if (!conn) return;
    await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [conn.id]);
    if (conn.secret_id) await tx.query("delete from secrets where id = $1", [conn.secret_id]);
  }, { reason: "Threads account disconnected" });
  revalidatePath(`/p/${slug}`, "layout");
}

export async function syncInstagramAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => syncInstagramComments(tx, actorOf(ctx), product.id, liveInstagramApi()), { reason: "Instagram comments read", actorType: "ai" });
    if (r.highRisk) await notifyTelegram(`${product.name}: someone on Instagram may need urgent help. Please look now.\n${appUrl(`/p/${slug}/conversations?tab=instagram`)}`, { urgent: true });
    revalidatePath(`/p/${slug}`, "layout");
    const errors = r.errors.length ? ` Problems: ${r.errors.slice(0, 2).join(" ")}` : "";
    return ok(`${r.media} post${r.media === 1 ? "" : "s"} with comments checked, ${r.fresh} new comment${r.fresh === 1 ? "" : "s"}${r.fresh ? ", answers drafted for your approval" : ""}.${errors}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function disconnectInstagramAction(slug: string) {
  await requireOwner();
  const product = await getProduct(slug);
  await db(async (tx) => {
    const conn = await channelConnection(tx, product.id, "instagram");
    if (!conn) return;
    await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [conn.id]);
    if (conn.secret_id) await tx.query("delete from secrets where id = $1", [conn.secret_id]);
  }, { reason: "Instagram account disconnected" });
  revalidatePath(`/p/${slug}`, "layout");
}

export async function disconnectTiktokAction(slug: string) {
  await requireOwner();
  const product = await getProduct(slug);
  await db(async (tx) => {
    const conn = await tiktokConnection(tx, product.id);
    if (!conn) return;
    // Tell TikTok too, so the access is withdrawn on their side; then forget the tokens here.
    await tiktokAccess(tx, conn, tiktokRefresh).then((a) => tiktokRevoke(a.token)).catch(() => undefined);
    await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [conn.id]);
    if (conn.secret_id) await tx.query("delete from secrets where id = $1", [conn.secret_id]);
  }, { reason: "TikTok account disconnected" });
  revalidatePath(`/p/${slug}`, "layout");
}
