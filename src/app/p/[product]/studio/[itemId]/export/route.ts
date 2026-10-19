import { NextResponse } from "next/server";
import { db, getProduct } from "@/server/context";
import { approvedQueueItem, buildApprovalPayload, getItem } from "@/server/services/content";
import { approvalHash } from "@/domain/approvals";
import { evaluatePolicy } from "@/domain/policy";
import { renderText, STUDIO_CHANNELS, STUDIO_FORMATS } from "@/domain/content";

/**
 * Export package for manual posting (Instagram, Threads, Facebook in v0.1). Goes through the policy engine:
 * only the exact approved version can be exported. Every attempt, allowed or not, is recorded with its reason.
 */
export async function GET(_req: Request, ctx: RouteContext<"/p/[product]/studio/[itemId]/export">) {
  const { product: slug, itemId } = await ctx.params;
  const product = await getProduct(slug);
  const result = await db(async (tx, app) => {
    const item = await getItem(tx, product.id, itemId);
    if (!item) return { status: 404 as const, body: "Not found" };
    const approval = await approvedQueueItem(tx, product.id, itemId);
    const payload = await buildApprovalPayload(tx, product.id, itemId);
    const policy = evaluatePolicy({
      action: "export",
      now: new Date(),
      connection: null,
      approval: approval ? { state: "approved", payloadHash: approval.payload_hash } : null,
      currentPayloadHash: approvalHash(payload),
      executedToday: 0,
      executedTodayAccount: 0,
      lastExecutedAt: null,
      authorLastContactedAt: null,
      dedupeKeyUsed: false,
    });
    await tx.query(
      `insert into outbound_actions (workspace_id, product_id, approval_item_id, action, dedupe_key, result, reason, policy_checks)
       values ($1,$2,$3,'export',null,$4,$5,$6)`,
      [app.workspaceId, product.id, approval?.id ?? null, policy.allowed ? "executed" : "skipped", policy.reason, JSON.stringify(policy.checks)],
    );
    await tx.query("select public.log_event($1,$2,$3,'content_items',$4,$5,$6)", [
      app.workspaceId, product.id, policy.allowed ? "export.downloaded" : "export.refused", itemId, JSON.stringify({ channel: item.channel, format: item.format }), policy.reason,
    ]);
    if (!policy.allowed) return { status: 409 as const, body: `Export refused: ${policy.reason}. Open the item in Content Studio.` };
    const lines = [
      `# ${item.title}`,
      "",
      `Product: ${product.name}`,
      `Channel: ${STUDIO_CHANNELS[item.channel] ?? item.channel}`,
      `Format: ${STUDIO_FORMATS[item.format]?.label ?? item.format}`,
      `Approved version: v${item.version} (${item.content_hash.slice(0, 12)})`,
      `Destination: ${payload.destination.account}`,
      "",
      "## Text to post",
      "",
      payload.text,
      "",
      ...(item.format === "carousel" || item.format === "reels_script" ? ["## Production notes", "", renderText(item.body, item.format), ""] : []),
      ...(item.visual_concept ? ["## Visual concept", "", item.visual_concept, ""] : []),
      ...(payload.utmUrl ? ["## Tracking link", "", payload.utmUrl, ""] : []),
      "## After posting",
      "",
      "Open the item in Marketing OS and mark it as published with the link to the live post.",
      "",
    ];
    return { status: 200 as const, body: lines.join("\n"), filename: `${product.slug}-${item.channel}-${itemId.slice(0, 8)}.md` };
  }, { reason: "export requested" });
  if (result.status !== 200) return new NextResponse(result.body, { status: result.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new NextResponse(result.body, {
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${result.filename}"`, "cache-control": "no-store" },
  });
}
