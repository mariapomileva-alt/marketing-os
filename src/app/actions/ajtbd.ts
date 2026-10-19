"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { ensureDraftCodebook, findChunkForExcerpt, jobGrammarHint, parseCriteriaLines } from "@/server/services/ajtbd";
import { fail, lines, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const done = (slug: string, message: string) => {
  revalidatePath(`/p/${slug}/audience`);
  return ok(message);
};
const nullable = (v: FormDataEntryValue | null) => str(v) || null;

export async function addAudienceAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const name = str(data.get("name"));
    if (!name) return fail("Give the audience a name.");
    await db((tx, ctx) => tx.query("insert into audiences (workspace_id, product_id, name, description) values ($1,$2,$3,$4)", [ctx.workspaceId, product.id, name, str(data.get("description"))]));
    return done(slug, "Audience added.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}

export async function addSegmentAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const code = str(data.get("code")).toUpperCase();
    const coreJob = str(data.get("core_job"));
    if (!/^[A-Z0-9]{1,6}-[A-Z0-9]{1,8}$/.test(code)) return fail("Segment code looks like BA-S1: product letters, a hyphen, then a number. Codes are never reused.");
    if (!coreJob) return fail("A segment is defined by its Core Job. Write it as “want to + verb”.");
    const criteria = parseCriteriaLines(lines(data.get("criteria")));
    if (!criteria.length) return fail("List at least one success criterion in priority order: criterion | direction | threshold.");
    await db(async (tx, ctx) => {
      const cb = await ensureDraftCodebook(tx, ctx.workspaceId, product.id);
      const seg = await tx.one<{ id: string }>(
        "insert into segments (workspace_id, product_id, audience_id, code, name) values ($1,$2,$3,$4,$5) returning id",
        [ctx.workspaceId, product.id, nullable(data.get("audience_id")), code, str(data.get("name")) || coreJob],
      );
      await tx.query(
        "insert into segment_definitions (workspace_id, product_id, segment_id, codebook_version_id, core_job, criteria_order, distinguishing) values ($1,$2,$3,$4,$5,$6,$7)",
        [ctx.workspaceId, product.id, seg.id, cb.id, coreJob, JSON.stringify(criteria), str(data.get("distinguishing"))],
      );
    }, { reason: "segment created" });
    const hint = jobGrammarHint(coreJob);
    return done(slug, hint ? `Segment added to the draft codebook. Note: ${hint}` : "Segment added to the draft codebook.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}

export async function activateCodebookAction(slug: string, codebookId: string) {
  const product = await getProduct(slug);
  await db(async (tx, ctx) => {
    await tx.query("update codebook_versions set status = 'archived' where product_id = $1 and status = 'active'", [product.id]);
    await tx.query("update codebook_versions set status = 'active', approved_by = $3, approved_at = now() where id = $1 and product_id = $2 and status = 'draft'", [codebookId, product.id, ctx.user.id]);
  }, { reason: "codebook version approved" });
  revalidatePath(`/p/${slug}/audience`);
}

export async function newDraftCodebookAction(slug: string) {
  const product = await getProduct(slug);
  await db((tx, ctx) => ensureDraftCodebook(tx, ctx.workspaceId, product.id), { reason: "new codebook draft" });
  revalidatePath(`/p/${slug}/audience`);
}

export async function addJobAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const statement = str(data.get("statement"));
    if (!statement) return fail("Write the Job.");
    const quoteId = nullable(data.get("quote_id"));
    const evidence = quoteId ? "quote" : (str(data.get("evidence_level")) || "hypothesis");
    await db(async (tx, ctx) => {
      const job = await tx.one<{ id: string }>(
        `insert into jobs (workspace_id, product_id, segment_id, parent_job_id, level, job_type, statement, context, evidence_level, quote_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [ctx.workspaceId, product.id, nullable(data.get("segment_id")), nullable(data.get("parent_job_id")), str(data.get("level")) || "core",
         str(data.get("job_type")) || "regular", statement, str(data.get("context")), evidence, quoteId],
      );
      const criteria = parseCriteriaLines(lines(data.get("criteria")));
      for (const [i, c] of criteria.entries()) {
        await tx.query(
          "insert into success_criteria (workspace_id, product_id, job_id, priority_rank, criterion, direction, threshold, source) values ($1,$2,$3,$4,$5,$6,$7,$8)",
          [ctx.workspaceId, product.id, job.id, i + 1, c.criterion, c.direction, c.threshold, str(data.get("criteria_source")) || "self"],
        );
      }
    }, { reason: "job added" });
    const hint = jobGrammarHint(statement);
    return done(slug, hint ? `Job saved. Note: ${hint}` : "Job saved.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}

export async function addFearAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const fear = str(data.get("fear"));
    if (!fear) return fail("Describe the fear as the customer's prediction (“it won't work for me in public”).");
    const reducible = str(data.get("reducible"));
    await db((tx, ctx) =>
      tx.query(
        `insert into fears (workspace_id, product_id, segment_id, fear, about_way, class, reducible_by_communication, proof_available, source, quote_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ctx.workspaceId, product.id, nullable(data.get("segment_id")), fear, str(data.get("about_way")), nullable(data.get("class")),
         reducible === "" ? null : reducible === "yes", str(data.get("proof_available")), str(data.get("source")) || "self", nullable(data.get("quote_id"))],
      ),
    );
    return done(slug, reducible === "no" ? "Saved. A fear that proof cannot remove may be a barrier: consider adding it as a barrier instead." : "Fear saved.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}

export async function addBarrierAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const barrier = str(data.get("barrier"));
    if (!barrier) return fail("Describe the barrier as a fact (“no phone signal in the metro”).");
    await db((tx, ctx) =>
      tx.query(
        `insert into barriers (workspace_id, product_id, segment_id, barrier, class, chain_node, owner, removal_mechanic, quote_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ctx.workspaceId, product.id, nullable(data.get("segment_id")), barrier, nullable(data.get("class")), str(data.get("chain_node")),
         nullable(data.get("owner")), nullable(data.get("removal_mechanic")), nullable(data.get("quote_id"))],
      ),
    );
    return done(slug, "Barrier saved. Barriers are removed by changing reality, not by messaging.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}

export async function addQuoteAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const sourceId = str(data.get("source_id"));
    const excerpt = String(data.get("text") ?? "").trim();
    if (!sourceId) return fail("Choose the source the quote comes from.");
    if (!excerpt) return fail("Paste the exact words from the source.");
    const result = await db(async (tx, ctx) => {
      const chunk = await findChunkForExcerpt(tx, product.id, sourceId, excerpt);
      if (!chunk) return null;
      await tx.query("insert into client_quotes (workspace_id, product_id, text_verbatim, chunk_id, speaker) values ($1,$2,$3,$4,$5)", [
        ctx.workspaceId, product.id, excerpt, chunk.id, str(data.get("speaker")) || "customer",
      ]);
      return chunk.id;
    }, { reason: "verbatim quote extracted" });
    if (!result) return fail("These exact words were not found in that source. Quotes must be copied verbatim, including spelling.");
    return done(slug, "Quote saved with its source.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}
