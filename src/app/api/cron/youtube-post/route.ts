import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { queueToken } from "@/server/security/queue-token";
import { drainQueue } from "@/server/services/youtube-publish";
import { dueThreadsPosts, publishThreadsPost } from "@/server/services/threads";
import { liveApis, liveThreadsApi } from "@/server/youtube/live";
import { publishDueReels } from "@/server/services/calm-shorts";
import { channelConnection, threadsToken } from "@/server/services/youtube-publish";
import { fileStore } from "@/server/storage";
import { instagramContainerStatus, instagramCreateReel, instagramPublish, instagramRefresh } from "@/server/instagram/api";

/**
 * Posting queue, called every few minutes by the database scheduler (Supabase pg_cron + pg_net, set up by the build).
 * Posts at most one approved comment or reply per channel and product per call, inside the limits, and approved
 * Threads posts whose scheduled time has come. Nothing unapproved is ever
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
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; owner_id: string }>(
      `select distinct c.product_id, c.workspace_id,
              (select m.user_id from workspace_members m where m.workspace_id = c.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from channel_connections c where c.channel in ('youtube', 'threads', 'instagram') and c.adapter_kind = 'official_api' and c.status in ('connected', 'paused')`,
    ),
  );
  const results = [];
  for (const p of products) {
    try {
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "YouTube posting queue (approved texts only)" }, (tx) =>
        drainQueue(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, liveApis()),
      );
      // Approved Threads posts placed on the calendar go out when their time comes.
      const posts = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "scheduled Threads posts (approved only)" }, async (tx) => {
        const out = [];
        for (const item of await dueThreadsPosts(tx, p.product_id)) out.push(await publishThreadsPost(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, item.id, liveThreadsApi()));
        return out;
      });
      // Approved Reels (calm shorts) whose time has come.
      const reels = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "scheduled Reels (approved only)" }, async (tx) => {
        const conn = await channelConnection(tx, p.product_id, "instagram");
        if (!conn?.external_account_id || conn.status !== "connected") return null;
        return publishDueReels(tx, p.product_id, {
          token: async () => ({ token: await threadsToken(tx, conn, { refresh: instagramRefresh }), igUserId: conn.external_account_id! }),
          fileUrl: async (path) => (await fileStore().signedUrl(path, 3600)) ?? "",
          create: instagramCreateReel, status: instagramContainerStatus, publish: instagramPublish,
        });
      });
      results.push({ product: p.product_id, ...r, posts, reels });
    } catch (e) {
      results.push({ product: p.product_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
