"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { createBrief } from "@/server/services/brief";
import { briefVoice } from "@/server/services/brief-voice";
import { ok, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));

/** Rebuilds today's brief now (it is also built every morning automatically). Read-only: nothing is posted. */
export async function refreshBriefAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    await db(async (tx, ctx) => createBrief(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, await briefVoice(ctx.workspaceId)), { reason: "Morning brief refreshed", actorType: "ai" });
    revalidatePath(`/p/${slug}/overview`);
    return ok("Сводка обновлена.");
  } catch (e) {
    return toFailure(e, msg);
  }
}
