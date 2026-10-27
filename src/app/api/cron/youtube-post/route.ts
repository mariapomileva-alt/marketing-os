import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { queueToken } from "@/server/security/queue-token";
import { drainQueue } from "@/server/services/youtube-publish";
import { dueThreadsPosts, publishThreadsPost } from "@/server/services/threads";
import { scheduleApprovedStudioPosts } from "@/server/services/threads-studio";
import { refreshStudioStatsLive } from "@/server/services/threads-studio-live";
import { liveApis, liveThreadsApi } from "@/server/youtube/live";
import { publishDueReels } from "@/server/services/calm-shorts";
import { channelConnection, threadsToken } from "@/server/services/youtube-publish";
import { fileStore } from "@/server/storage";
import { instagramContainerStatus, instagramCreateReel, instagramPublish, instagramRefresh } from "@/server/instagram/api";
import { publishDueTikToks, tiktokAccess, tiktokConnection } from "@/server/services/tiktok";
import { publishDueInstagramPosts } from "@/server/services/content-desk";
import { instagramCreateCarousel, instagramCreateImage, instagramPermalink } from "@/server/instagram/api";
import { publishingEnabled } from "@/server/services/youtube-publish";
import { tiktokDirectPostEnabled, tiktokRefresh, tiktokStatus, tiktokUpload } from "@/server/tiktok/api";

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
         from channel_connections c where c.channel in ('youtube', 'threads', 'instagram', 'tiktok') and c.adapter_kind = 'official_api' and c.status in ('connected', 'paused')`,
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
        await scheduleApprovedStudioPosts(tx, p.product_id);
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
      // Approved Instagram posts and carousels from the content desk whose time has come.
      const igPosts = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "scheduled Instagram posts (approved only)" }, async (tx) => {
        const conn = await channelConnection(tx, p.product_id, "instagram");
        if (!conn?.external_account_id || conn.status !== "connected") return null;
        return publishDueInstagramPosts(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, {
          token: async () => ({ token: await threadsToken(tx, conn, { refresh: instagramRefresh }), igUserId: conn.external_account_id! }),
          fileUrl: async (path) => (await fileStore().signedUrl(path, 3600)) ?? "",
          image: instagramCreateImage, carousel: instagramCreateCarousel, status: instagramContainerStatus, publish: instagramPublish, permalink: instagramPermalink,
          enabled: publishingEnabled("instagram"),
        });
      }).catch((e) => ({ error: (e as Error).message }));
      // Approved TikTok shorts whose time has come: uploaded as inbox drafts (or posted, after TikTok's audit).
      const tiktok = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "scheduled TikTok shorts (approved only)" }, async (tx) => {
        const conn = await tiktokConnection(tx, p.product_id);
        if (!conn || conn.status !== "connected") return null;
        return publishDueTikToks(tx, p.product_id, {
          access: () => tiktokAccess(tx, conn, tiktokRefresh),
          file: (path) => fileStore().get(path),
          upload: (token, bytes, mode, post) => tiktokUpload(token, bytes, mode, post),
          status: (token, id) => tiktokStatus(token, id),
          directAllowed: tiktokDirectPostEnabled(),
        });
      }).catch((e) => ({ error: (e as Error).message }));
      // About once an hour: reactions on our Threads Studio posts, so the analytics stay fresh.
      const studioStats = new Date().getUTCMinutes() < 5
        ? await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "Threads reactions" }, (tx) => refreshStudioStatsLive(tx, p.product_id, 15)).catch((e) => ({ error: (e as Error).message }))
        : null;
      results.push({ product: p.product_id, ...r, posts, reels, igPosts, tiktok, studioStats });
    } catch (e) {
      results.push({ product: p.product_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
