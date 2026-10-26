"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { createBrief } from "@/server/services/brief";
import { briefVoice } from "@/server/services/brief-voice";
import { ok, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));

/** Rebuilds today's brief now (it is also built every morning automatically). Read-only: nothing is posted. */
export async function refreshBriefAction(slug: string, lang: "en" | "ru", _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    await db(async (tx, ctx) => createBrief(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, await briefVoice(ctx.workspaceId)), { reason: "Morning brief refreshed", actorType: "ai" });
    revalidatePath(`/p/${slug}/overview`);
    return ok(lang === "ru" ? "Сводка обновлена." : "Brief updated.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

/** Remembers the brief's text or voice language in this browser (a convenience cookie, not account data). */
export async function setBriefLangAction(name: "mos_text_lang" | "mos_voice_lang", value: "en" | "ru") {
  if (!["mos_text_lang", "mos_voice_lang"].includes(name) || !["en", "ru"].includes(value)) return;
  (await cookies()).set(name, value, { path: "/", maxAge: 31536000, sameSite: "lax" });
}
