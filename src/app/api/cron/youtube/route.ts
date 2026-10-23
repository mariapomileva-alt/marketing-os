import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { runDiscovery } from "@/server/services/youtube";
import { configuredSource } from "@/server/youtube/source";
import { refreshCommentStats, syncReplies, youtubeConnection } from "@/server/services/youtube-publish";
import { commentStats } from "@/server/youtube/write";
import { liveWriteApi } from "@/server/youtube/live";
import { appUrl, notifyTelegram } from "@/server/notify/telegram";

/**
 * Daily YouTube search (Vercel Cron, see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * Finds videos, reads replies under our posted comments and prepares drafts only; nothing is posted. Each product runs in its own transaction.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const source = configuredSource();
  if (!source) return NextResponse.json({ skipped: "YOUTUBE_API_KEY is not set" });

  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; slug: string; name: string; owner_id: string }>(
      `select s.product_id, s.workspace_id, p.slug, p.name,
              (select m.user_id from workspace_members m where m.workspace_id = s.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from yt_settings s join products p on p.id = s.product_id where s.enabled and p.status <> 'archived'`,
    ),
  );
  const results = [];
  for (const p of products) {
    try {
      const stats = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily YouTube search" }, (tx) =>
        runDiscovery(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, source),
      );
      if (stats.draftsQueued > 0) {
        await notifyTelegram(`${p.name}: ${stats.draftsQueued} new YouTube comment draft(s) wait for your approval.\n${appUrl(`/p/${p.slug}/approvals`)}`);
      }
      // Replies under comments posted from the connected channel: read them and draft answers (never posted here).
      const replies = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily YouTube replies check" }, async (tx) =>
        (await youtubeConnection(tx, p.product_id)) ? syncReplies(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, liveWriteApi()) : null,
      );
      const key = process.env.YOUTUBE_API_KEY;
      if (key) {
        await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "daily YouTube comment stats" }, (tx) =>
          refreshCommentStats(tx, p.product_id, (c, t) => commentStats(c, t, key)),
        ).catch(() => undefined);
      }
      if (replies?.highRisk) {
        await notifyTelegram(`${p.name}: someone on YouTube may need urgent help. Please look now.\n${appUrl(`/p/${p.slug}/conversations?tab=youtube`)}`, { urgent: true });
      } else if (replies?.fresh) {
        await notifyTelegram(`${p.name}: ${replies.fresh} new repl${replies.fresh === 1 ? "y" : "ies"} on YouTube, answers drafted for your approval.\n${appUrl(`/p/${p.slug}/conversations?tab=youtube`)}`);
      }
      results.push({ product: p.slug, ...stats, replies });
    } catch (e) {
      results.push({ product: p.slug, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
