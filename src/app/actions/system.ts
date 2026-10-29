"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct, requireOwner } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { connectAiProvider, connectChannel, revokeAiProvider, revokeChannel, rotateAiKey } from "@/server/services/connections";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));

export async function connectAiAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    await requireOwner();
    const provider = str(data.get("provider")) as "anthropic" | "openai";
    if (!["anthropic", "openai"].includes(provider)) return fail("Choose a provider.");
    await db((tx, ctx) => connectAiProvider(tx, ctx.workspaceId, provider, String(data.get("api_key") ?? ""), str(data.get("label"))), { reason: "AI provider connected" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Key stored encrypted. It is not used until real AI generation is switched on (Stage C).");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function rotateAiAction(slug: string, id: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    await requireOwner();
    const key = String(data.get("api_key") ?? "");
    if (key.trim().length < 20) return fail("Paste the new key.");
    await db((tx, ctx) => rotateAiKey(tx, ctx.workspaceId, id, key), { reason: "AI key rotated" });
    revalidatePath(`/p/${slug}/connections`);
    return ok("Key replaced. The old key was deleted.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function revokeAiAction(slug: string, id: string) {
  await requireOwner();
  await db((tx, ctx) => revokeAiProvider(tx, ctx.workspaceId, id), { reason: "AI provider disconnected" });
  revalidatePath(`/p/${slug}`, "layout");
}

export async function connectChannelAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    await requireOwner();
    const product = await getProduct(slug);
    const mode = str(data.get("mode")) as "draft_only" | "requires_approval";
    if (!["draft_only", "requires_approval"].includes(mode)) return fail("Automatic mode is not available in this version.");
    await db((tx, ctx) => connectChannel(tx, ctx.workspaceId, product.id, str(data.get("channel")), str(data.get("account_label")), mode), { reason: "channel connected" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Channel added.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function revokeChannelAction(slug: string, id: string) {
  await requireOwner();
  const product = await getProduct(slug);
  await db((tx) => revokeChannel(tx, product.id, id), { reason: "channel disconnected" });
  revalidatePath(`/p/${slug}`, "layout");
}

export async function updateLimitsAction(slug: string, id: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    await requireOwner();
    const product = await getProduct(slug);
    const n = (k: string, min: number, max: number) => {
      const v = Number(str(data.get(k)));
      if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${k.replaceAll("_", " ")} must be a whole number from ${min} to ${max}.`);
      return v;
    };
    const tz = str(data.get("tz")) || "Europe/Riga";
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      return fail("Unknown time zone. Use a name like Europe/Riga.");
    }
    const limits = {
      daily_limit: n("daily_limit", 0, 50), account_daily_cap: n("account_daily_cap", 0, 100), min_gap_minutes: n("min_gap_minutes", 0, 1440),
      author_cooldown_days: n("author_cooldown_days", 0, 365), active_hours: { start: n("start", 0, 23), end: n("end", 1, 24), tz },
    };
    if (limits.active_hours.end <= limits.active_hours.start) return fail("Active hours must end after they start.");
    const mode = str(data.get("mode"));
    if (!["draft_only", "requires_approval"].includes(mode)) return fail("Automatic mode is not available in this version.");
    await db((tx) => tx.query("update channel_connections set limits = $3, mode = $4 where id = $1 and product_id = $2", [id, product.id, JSON.stringify(limits), mode]), { reason: "policy limits changed" });
    revalidatePath(`/p/${slug}/automations`);
    return ok("Limits saved.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function updateSettingsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    await requireOwner();
    const v = (k: string) => Number(str(data.get(k)));
    const vals = [v("min_publications_per_group"), v("min_impressions_per_group"), v("min_n_share_cell"), v("ai_run_budget_usd"), v("ai_daily_budget_usd")];
    if (vals.some((x) => !Number.isFinite(x) || x <= 0)) return fail("All values must be positive numbers.");
    await db((tx, ctx) =>
      tx.query(
        `insert into workspace_settings (workspace_id, min_publications_per_group, min_impressions_per_group, min_n_share_cell, ai_run_budget_usd, ai_daily_budget_usd)
         values ($1,$2,$3,$4,$5,$6) on conflict (workspace_id) do update set min_publications_per_group = excluded.min_publications_per_group,
           min_impressions_per_group = excluded.min_impressions_per_group, min_n_share_cell = excluded.min_n_share_cell,
           ai_run_budget_usd = excluded.ai_run_budget_usd, ai_daily_budget_usd = excluded.ai_daily_budget_usd, updated_at = now()`,
        [ctx.workspaceId, ...vals],
      ),
    { reason: "settings changed" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Settings saved.");
  } catch (e) {
    return toFailure(e, msg);
  }
}
