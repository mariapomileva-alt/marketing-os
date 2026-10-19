"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { approvalHash, canonicalJson } from "@/domain/approvals";
import { checkText, outcomeOf } from "@/domain/guardrails";
import { createHash } from "node:crypto";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));
const CRISIS = /(suicid|self[- ]?harm|kill (my|him|her)self|end (my|it all)|don'?t want to live|суицид|покончить|не хочу жить|самоповрежд)/iu;

export async function logConversationAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const text = str(data.get("text"));
    if (!text) return fail("Paste the comment.");
    const url = str(data.get("thread_url"));
    if (url && !/^https?:\/\//i.test(url)) return fail("The link must start with https://");
    const sensitive = data.get("sensitive") === "on" || CRISIS.test(text);
    await db(async (tx, ctx) => {
      const c = await tx.one<{ id: string }>(
        "insert into conversations (workspace_id, product_id, publication_id, channel, thread_url, status, sensitive) values ($1,$2,$3,$4,$5,'needs_reply',$6) returning id",
        [ctx.workspaceId, product.id, str(data.get("publication_id")) || null, str(data.get("channel")) || "instagram", url || null, sensitive],
      );
      await tx.query("insert into conversation_messages (workspace_id, product_id, conversation_id, direction, author_handle, text) values ($1,$2,$3,'inbound',$4,$5)", [
        ctx.workspaceId, product.id, c.id, str(data.get("author_handle")) || null, text,
      ]);
    }, { reason: "comment logged" });
    revalidatePath(`/p/${slug}/conversations`);
    return ok(sensitive ? "Logged and marked sensitive: the person may be in distress. Reply personally and point to emergency help; never promote the product here." : "Comment logged.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

/** A reply draft goes through the safety rules and the Approval Queue; you then post it yourself. */
export async function draftReplyAction(slug: string, conversationId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const text = str(data.get("reply"));
    if (!text) return fail("Write the reply.");
    const r = await db(async (tx, ctx) => {
      const conv = await tx.one<{ channel: string; thread_url: string | null; sensitive: boolean }>("select channel, thread_url, sensitive from conversations where id = $1 and product_id = $2", [conversationId, product.id]);
      const rules = await tx.query<{ code: string; rule_type: "forbidden_phrase"; patterns: unknown; severity: "block" | "warn"; rationale: string; active: boolean }>(
        "select code, rule_type, patterns, severity, rationale, active from product_guardrails where product_id = $1", [product.id]);
      const findings = checkText({ text, channel: conv.channel, format: "helpful_comment" }, rules.map((x) => ({ code: x.code, ruleType: x.rule_type, patterns: x.patterns, severity: x.severity, rationale: x.rationale, active: x.active })));
      if (outcomeOf(findings) === "block") return { blocked: findings.filter((f) => f.severity === "block").map((f) => f.message).join(" ") };
      const m = await tx.one<{ id: string }>(
        "insert into conversation_messages (workspace_id, product_id, conversation_id, direction, text, status) values ($1,$2,$3,'outbound',$4,'draft') returning id",
        [ctx.workspaceId, product.id, conversationId, text],
      );
      const payload = { contentVersionId: m.id, versionHash: createHash("sha256").update(text).digest("hex"), channel: conv.channel, format: "reply", destination: { account: "posted manually by you", method: "manual" as const, targetUrl: conv.thread_url }, text, utmUrl: null, media: [] };
      await tx.query(
        `insert into approval_items (workspace_id, product_id, item_type, conversation_message_id, subject_summary, payload_snapshot, payload_hash, destination, reason_in_queue)
         values ($1,$2,'reply',$3,$4,$5,$6,$7,$8)`,
        [ctx.workspaceId, product.id, m.id, `Reply on ${conv.channel}`, canonicalJson(payload), approvalHash(payload), JSON.stringify(payload.destination),
         conv.sensitive ? "Sensitive conversation: check tone and that it points to emergency help." : "Every reply needs your approval in v0.1."],
      );
      await tx.query("update conversations set status = 'needs_reply' where id = $1", [conversationId]);
      return { blocked: null };
    }, { reason: "reply drafted" });
    if (r.blocked) return fail(`A safety rule blocks this reply: ${r.blocked}`);
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Reply sent to the Approval Queue.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function markReplyPostedAction(slug: string, messageId: string) {
  const product = await getProduct(slug);
  await db(async (tx) => {
    const m = await tx.one<{ conversation_id: string; status: string }>("select conversation_id, status from conversation_messages where id = $1 and product_id = $2", [messageId, product.id]);
    if (m.status !== "approved") throw new Error("Only approved replies can be marked as posted.");
    await tx.query("update conversation_messages set status = 'posted', occurred_at = now() where id = $1", [messageId]);
    await tx.query("update conversations set status = 'replied' where id = $1", [m.conversation_id]);
  }, { reason: "reply posted manually" });
  revalidatePath(`/p/${slug}/conversations`);
}
