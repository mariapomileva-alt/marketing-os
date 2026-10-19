"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";
import { parseNumber } from "@/domain/csv";

export async function addCompetitorAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const name = str(data.get("name"));
    if (!name) return fail("Name the competitor.");
    const url = str(data.get("website_url"));
    if (url && !/^https?:\/\//i.test(url)) return fail("Website must start with https://");
    await db((tx, ctx) =>
      tx.query("insert into competitors (workspace_id, product_id, name, website_url, positioning, notes) values ($1,$2,$3,$4,$5,$6)", [
        ctx.workspaceId, product.id, name, url || null, str(data.get("positioning")), str(data.get("notes")),
      ]),
    );
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath(`/p/${slug}/competitors`);
  return ok("Competitor added.");
}

const STRUCTURE = ["persona", "problem", "emotional_trigger", "hook", "angle", "mechanism", "proof", "body_summary", "cta", "visual_device", "funnel_destination", "format", "topic"] as const;

export async function addSignalAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const platform = str(data.get("platform"));
    if (!platform) return fail("Choose the platform.");
    const url = str(data.get("url"));
    if (url && !/^https?:\/\//i.test(url)) return fail("URL must start with https://");
    const perf: Record<string, number> = {};
    for (const k of ["days_active", "variants", "views", "likes", "comments", "shares", "views_vs_account_median"]) {
      const n = parseNumber(str(data.get(`perf_${k}`)));
      if (n !== null) perf[k] = n;
    }
    const fields = Object.fromEntries(STRUCTURE.map((k) => [k, str(data.get(k))]));
    await db((tx, ctx) =>
      tx.query(
        `insert into signals (workspace_id, product_id, competitor_id, url, platform, author, observed_on, text_content, ${STRUCTURE.join(", ")},
           observed_performance, relevance_reason, adaptation_idea)
         values ($1,$2,$3,$4,$5,$6,$7,$8,${STRUCTURE.map((_, i) => `$${i + 9}`).join(",")},$${STRUCTURE.length + 9},$${STRUCTURE.length + 10},$${STRUCTURE.length + 11})`,
        [ctx.workspaceId, product.id, str(data.get("competitor_id")) || null, url || null, platform, str(data.get("author")) || null, str(data.get("observed_on")) || null,
         str(data.get("text_content")), ...STRUCTURE.map((k) => fields[k]), JSON.stringify(perf), str(data.get("relevance_reason")), str(data.get("adaptation_idea"))],
      ),
    );
  } catch (e) {
    return toFailure(e, describeDbError);
  }
  revalidatePath(`/p/${slug}/signals`);
  return ok("Signal saved. Its structure, not its wording, is what we reuse.");
}

export async function setSignalStatusAction(slug: string, id: string, status: "shortlisted" | "adapted" | "rejected" | "new") {
  const product = await getProduct(slug);
  await db((tx) => tx.query("update signals set validation_status = $3 where id = $1 and product_id = $2", [id, product.id, status]));
  revalidatePath(`/p/${slug}/signals`);
}
