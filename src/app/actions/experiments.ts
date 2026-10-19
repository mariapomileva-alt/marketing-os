"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const OUTCOMES = ["inconclusive", "supported", "not_supported", "stopped"] as const;

/**
 * Human conclusion of an experiment. The computed numbers are frozen with it. A "confirmed result" is only
 * recorded when the owner states the test had comparable arms; otherwise the conclusion stays an observation.
 */
export async function concludeExperimentAction(slug: string, experimentId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const outcome = str(data.get("outcome_status")) as (typeof OUTCOMES)[number];
    if (!OUTCOMES.includes(outcome)) return fail("Choose an outcome.");
    const conclusion = str(data.get("conclusion"));
    if (!conclusion) return fail("Write the conclusion in your own words.");
    const designed = data.get("designed_test") === "on";
    await db(async (tx, ctx) => {
      const e = await tx.one<{ id: string; content_item_id: string; primary_metric: string; locked_at: string | null }>(
        "select id, content_item_id, primary_metric, locked_at::text from experiments where id = $1 and product_id = $2",
        [experimentId, product.id],
      );
      if (!e.locked_at) throw new Error("This item is not published yet; there is nothing to conclude.");
      const computed = await tx.one<{ metrics: Record<string, number>; conversions: Record<string, number> }>(
        `select coalesce((select jsonb_object_agg(metric, value) from metric_latest ml join publications p on p.id = ml.publication_id where p.content_item_id = $1), '{}') metrics,
                coalesce((select jsonb_object_agg(type, n) from (select c.type, count(*) n from conversions c join utm_links u on u.id = c.utm_link_id
                   where u.content_item_id = $1 and c.match_status = 'matched' group by 1) x), '{}') conversions`,
        [e.content_item_id],
      );
      await tx.query(
        "update experiments set outcome_status = $3, conclusion = $4, computed_summary = $5, concluded_by = $6, concluded_at = now() where id = $1 and product_id = $2",
        [experimentId, product.id, outcome, conclusion, JSON.stringify({ ...computed, frozen_at: new Date().toISOString() }), ctx.user.id],
      );
      const kind = outcome === "supported" && designed ? "confirmed_result" : "observation";
      const a = await tx.one<{ id: string }>(
        "insert into assertions (workspace_id, product_id, kind, origin, statement, confidence, subject_type, subject_id, confirmed_by) values ($1,$2,$3,'human',$4,$5,'experiment',$6,$7) returning id",
        [ctx.workspaceId, product.id, kind, conclusion, designed ? "high" : "medium", experimentId, kind === "confirmed_result" ? ctx.user.id : null],
      );
      await tx.query("insert into assertion_evidence (workspace_id, product_id, assertion_id, experiment_id) values ($1,$2,$3,$4)", [ctx.workspaceId, product.id, a.id, experimentId]);
    }, { reason: `experiment concluded: ${outcome}` });
    revalidatePath(`/p/${slug}/experiments`);
    return ok("Conclusion saved with the numbers as they are now.");
  } catch (e) {
    return toFailure(e, (x) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x)));
  }
}
