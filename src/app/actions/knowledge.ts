"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { importCourse, IngestError, ingestSource, MAX_UPLOAD_BYTES, readCourseFiles } from "@/server/services/knowledge";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";
import { syncBlog } from "@/server/services/blog";

const SOURCE_TYPES = ["doc", "transcript", "interview", "call", "note", "report", "creative", "dataset"] as const;

export async function uploadSourceAction(productSlug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(productSlug);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
    if (file.size > MAX_UPLOAD_BYTES) return fail("The file is larger than 5 MB.");
    const sourceType = str(data.get("source_type")) as (typeof SOURCE_TYPES)[number];
    if (!SOURCE_TYPES.includes(sourceType)) return fail("Choose a source type.");
    const confidence = (str(data.get("confidence")) || "medium") as "low" | "medium" | "high";
    const containsPersonalData = data.get("contains_personal_data") === "on";
    const consent = data.get("consent_recorded") === "on";
    if (containsPersonalData && ["interview", "call", "transcript"].includes(sourceType) && !consent) {
      return fail("Customer interviews and calls need recorded consent before import. Tick 'Consent recorded' once you have it.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const looksTimestamped = /\*\*\[\d/.test(new TextDecoder().decode(bytes.slice(0, 4000)));
    const r = await db(
      (tx, ctx) =>
        ingestSource(tx, {
          workspaceId: ctx.workspaceId,
          productId: product.id,
          scope: "product",
          sourceType,
          title: str(data.get("title")) || file.name,
          author: str(data.get("author")) || null,
          documentDate: str(data.get("document_date")) || null,
          confidence,
          containsPersonalData,
          consentRecorded: consent,
          filename: file.name,
          mimeType: file.type || "text/plain",
          bytes,
          provenance: { uploaded_via: "knowledge library" },
          chunkAs: sourceType === "transcript" && looksTimestamped ? "transcript" : undefined,
        }),
      { reason: "knowledge upload" },
    );
    revalidatePath(`/p/${productSlug}/knowledge`);
    return r.duplicate ? ok("This exact file is already in this product's knowledge base.") : ok(`Imported ${r.chunks} passages with provenance.`);
  } catch (e) {
    if (e instanceof IngestError) return fail(e.message);
    return toFailure(e, describeDbError);
  }
}

export async function importCourseAction(productSlug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const uploads = data.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!uploads.length) return fail("Choose the course archive (.zip) and, optionally, the AJTBD files.");
    const zip = uploads.find((f) => f.name.toLowerCase().endsWith(".zip"));
    const others = uploads.filter((f) => f !== zip);
    const files = readCourseFiles({
      zip: zip ? new Uint8Array(await zip.arrayBuffer()) : undefined,
      files: await Promise.all(others.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
    });
    const r = await db((tx, ctx) => importCourse(tx, ctx.workspaceId, files), { reason: "course methodology import" });
    revalidatePath(`/p/${productSlug}/knowledge`);
    return ok(
      `Imported ${r.imported} methodology sources (${r.duplicates} were already there), pseudonymised ${r.participantsPseudonymised} participants, proposed ${r.playbookRules} playbook rules. Skipped ${r.skipped.length} files (PDFs arrive in v0.2).`,
    );
  } catch (e) {
    if (e instanceof IngestError) return fail(e.message);
    return toFailure(e, describeDbError);
  }
}

export async function approveRuleAction(productSlug: string, ruleId: string) {
  await db((tx, ctx) => tx.query("update playbook_rules set status = 'approved', approved_by = $2, approved_at = now() where id = $1 and workspace_id = $3", [ruleId, ctx.user.id, ctx.workspaceId]), {
    reason: "playbook rule approved",
  });
  revalidatePath(`/p/${productSlug}/knowledge`);
}

export async function setRuleApplicabilityAction(productSlug: string, ruleId: string, applicability: "applies" | "not_applicable") {
  const product = await getProduct(productSlug);
  await db((tx, ctx) =>
    tx.query(
      `insert into product_rule_overrides (workspace_id, product_id, rule_id, applicability) values ($1,$2,$3,$4)
       on conflict (product_id, rule_id) do update set applicability = excluded.applicability, updated_at = now()`,
      [ctx.workspaceId, product.id, ruleId, applicability],
    ),
  );
  revalidatePath(`/p/${productSlug}/knowledge`);
}

export async function syncBlogAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => syncBlog(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id }, product.id, (url) => fetch(url, { cache: "no-store" })), { reason: "Blog read", actorType: "ai" });
    revalidatePath(`/p/${slug}/knowledge`);
    const errors = r.errors.length ? ` Problems: ${r.errors.slice(0, 2).join(" ")}` : "";
    return r.found || !r.errors.length
      ? ok(`${r.found} articles on the site, ${r.added} new added to knowledge, ${r.drafted} with Threads posts drafted.${errors}`)
      : fail(r.errors.join(" "));
  } catch (e) {
    return fail((e as Error).message);
  }
}
