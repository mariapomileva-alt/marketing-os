"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { syncCalendarLive } from "@/server/services/calendar-live";
import { fail, ok, toFailure, type ActionResult } from "@/lib/action-result";
import { mixShorts } from "@/server/services/shorts-mix";
import { youtubeMover } from "@/server/services/shorts-mix-live";
import { evenDesk, evenShorts } from "@/server/services/even-plan";
import { scheduleApprovedDeskItems } from "@/server/services/content-desk";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));

/** Reads our posts from the connected platforms now (it also happens every morning). Read-only. */
export async function syncCalendarAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => syncCalendarLive(tx, ctx.workspaceId, product.id), { reason: "Calendar synced from platforms" });
    revalidatePath(`/p/${slug}/calendar`);
    const parts = Object.entries(r);
    if (!parts.length) return fail("No platform is connected yet (Connections).");
    const errors = parts.filter(([, v]) => typeof v === "string");
    const text = parts.map(([k, v]) => (typeof v === "number" ? `${k}: ${v}` : `${k}: ${String(v).replace(/^error: /, "failed (")}${typeof v === "string" ? ")" : ""}`)).join(", ");
    return errors.length === parts.length ? fail(`Could not read the platforms: ${text}`) : ok(`Synced. ${text}.`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

/**
 * Mix the scheduled shorts now: the same times stay, but shorts with the same look (cut from one long video, or your
 * own videos) are spread out. Reads YouTube first so shorts scheduled there directly are included.
 */
export async function mixShortsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const includeOwn = data.get("include_own") === "on";
    const auto = data.get("auto") === "on";
    const r = await db(async (tx, ctx) => {
      await tx.query("update calm_settings set mix_shorts = $2 where product_id = $1", [product.id, auto]);
      if (includeOwn) await syncCalendarLive(tx, ctx.workspaceId, product.id).catch(() => undefined);
      const mover = await youtubeMover(tx, product.id);
      return mixShorts(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, mover, { includeOwn });
    }, { reason: "Scheduled shorts mixed by look" });
    revalidatePath(`/p/${slug}/calendar`);
    revalidatePath(`/p/${slug}/calm`);
    if (!r.moved && !r.failed.length) return ok(`Nothing to move: the shorts are already mixed${auto ? "" : ""}.${auto ? " New approvals will be mixed automatically." : ""}`);
    const note = r.failed.length ? ` Could not move ${r.failed.length}: ${r.failed.slice(0, 2).join("; ")}.` : "";
    return (r.failed.length && !r.moved ? fail : ok)(`Moved ${r.moved} short(s); the times stay the same, the looks now alternate.${note}${auto ? " New approvals will be mixed automatically." : ""}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

/**
 * Spread everything already approved evenly over the coming days: Instagram feed 2 posts + 1 explainer Reel a day,
 * shorts at most 3 on YouTube, 2 Instagram Reels and 3 TikToks a day; then shorts are mixed by look.
 */
export async function evenPlanAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db(async (tx, ctx) => {
      await syncCalendarLive(tx, ctx.workspaceId, product.id).catch(() => undefined);
      await scheduleApprovedDeskItems(tx, ctx.workspaceId, product.id);
      const mover = await youtubeMover(tx, product.id);
      const desk = await evenDesk(tx, product.id, new Date(), mover);
      const shorts = await evenShorts(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, mover);
      return { desk, shorts };
    }, { reason: "Approved posts, Reels and shorts spread evenly over the coming days" });
    revalidatePath(`/p/${slug}/calendar`);
    revalidatePath(`/p/${slug}/ideas`);
    const note = r.shorts.failed.length ? ` Could not move ${r.shorts.failed.length}: ${r.shorts.failed.slice(0, 2).join("; ")}.` : "";
    return ok(`Spread evenly: ${r.desk.moved} Instagram post/Reel time(s) and ${r.shorts.moved} short(s) moved, ${r.shorts.mixed} swapped to mix the looks.${note}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}
