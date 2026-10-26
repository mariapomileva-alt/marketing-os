"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { syncCalendarLive } from "@/server/services/calendar-live";
import { fail, ok, toFailure, type ActionResult } from "@/lib/action-result";

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
