import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { queueToken } from "@/server/security/queue-token";
import { drainQueue, publishingEnabled } from "@/server/services/youtube-publish";
import { liveWriteApi } from "@/server/youtube/live";

/**
 * Posting queue, called every few minutes by the database scheduler (Supabase pg_cron + pg_net, set up by the build).
 * Posts at most one approved comment or reply per product per call, inside the limits. Nothing unapproved is ever
 * posted: the queue only contains texts the owner approved, and the gate re-checks the approval hash.
 */
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const given = request.headers.get("authorization") ?? "";
  const accepted = [queueToken(), process.env.CRON_SECRET].filter((x): x is string => Boolean(x)).map((t) => `Bearer ${t}`);
  return accepted.some((e) => e.length === given.length && timingSafeEqual(Buffer.from(e), Buffer.from(given)));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!publishingEnabled()) return NextResponse.json({ skipped: "publishing is switched off" });
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; owner_id: string }>(
      `select c.product_id, c.workspace_id,
              (select m.user_id from workspace_members m where m.workspace_id = c.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from channel_connections c where c.channel = 'youtube' and c.status in ('connected', 'paused')`,
    ),
  );
  const results = [];
  for (const p of products) {
    try {
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "YouTube posting queue (approved texts only)" }, (tx) =>
        drainQueue(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, liveWriteApi()),
      );
      results.push({ product: p.product_id, ...r });
    } catch (e) {
      results.push({ product: p.product_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
