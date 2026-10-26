"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { approveThreadsPost, generateThreadsPosts, rejectThreadsPost, updateStudioSettings } from "@/server/services/threads-studio";
import { refreshStudioStatsLive } from "@/server/services/threads-studio-live";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));
const actorOf = (ctx: { workspaceId: string; user: { id: string } }) => ({ workspaceId: ctx.workspaceId, userId: ctx.user.id });
const path = (slug: string) => `/p/${slug}/threads`;
const when = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Riga" }).format(d);

const settingsSchema = z.object({
  enabled: z.boolean(),
  posts_per_day: z.coerce.number().int().min(1).max(4),
  slots: z.array(z.string()).min(1, "Add at least one posting time."),
  language: z.enum(["en", "ru"]),
  web_trends: z.boolean(),
});

export async function saveStudioSettingsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const parsed = settingsSchema.safeParse({
      enabled: data.get("enabled") === "on",
      posts_per_day: data.get("posts_per_day"),
      slots: str(data.get("slots")).split(/[\s,]+/).filter(Boolean),
      language: str(data.get("language")) || "en",
      web_trends: data.get("web_trends") === "on",
    });
    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
    await db((tx, ctx) => updateStudioSettings(tx, ctx.workspaceId, product.id, parsed.data), { reason: "Threads Studio settings changed" });
    revalidatePath(path(slug));
    return ok("Saved.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function generateThreadsPostsAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => generateThreadsPosts(tx, actorOf(ctx), product.id), { reason: "Threads posts written", actorType: "ai" });
    revalidatePath(path(slug));
    const waiting = r.created.filter((c) => c.status === "waiting").length;
    const blocked = r.created.length - waiting;
    return ok(`${waiting} post(s) wait for your approval${blocked ? `, ${blocked} stopped by the safety rules` : ""}.`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function approveThreadsPostAction(slug: string, itemId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const text = data.get("text");
    const r = await db((tx, ctx) => approveThreadsPost(tx, actorOf(ctx), product.id, itemId, typeof text === "string" ? text : undefined), { reason: "Threads post approved" });
    revalidatePath(path(slug));
    return ok(`Approved. Goes out ${when(r.scheduledFor)} (Riga).`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function approveAllThreadsAction(slug: string, ids: string[], _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const done: string[] = [];
    const problems: string[] = [];
    for (const id of ids.slice(0, 10)) {
      try {
        const r = await db((tx, ctx) => approveThreadsPost(tx, actorOf(ctx), product.id, id), { reason: "Threads post approved (all)" });
        done.push(when(r.scheduledFor));
      } catch (e) {
        problems.push(msg(e));
      }
    }
    revalidatePath(path(slug));
    return problems.length && !done.length ? fail(problems[0]) : ok(`${done.length} approved: ${done.join("; ")}.${problems.length ? ` ${problems.length} not approved: ${problems[0]}` : ""}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function rejectThreadsPostAction(slug: string, itemId: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    await db((tx, ctx) => rejectThreadsPost(tx, actorOf(ctx), product.id, itemId), { reason: "Threads post rejected" });
    revalidatePath(path(slug));
    return ok("Removed.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function refreshThreadsStatsAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx) => refreshStudioStatsLive(tx, product.id), { reason: "Threads reactions read" });
    revalidatePath(path(slug));
    return r.connected ? ok(`Reactions updated for ${r.checked} post(s).`) : fail("Threads is not connected (Connections).");
  } catch (e) {
    return toFailure(e, msg);
  }
}
