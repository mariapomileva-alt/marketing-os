import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { runDiscovery } from "@/server/services/youtube";
import { configuredSource } from "@/server/youtube/source";
import { getThreadsSettings, refreshThreadsStats, runThreadsDiscovery, syncThreadsReplies } from "@/server/services/threads";
import { threadsApiSource } from "@/server/threads/source";
import { refreshCommentStats, syncReplies, youtubeConnection } from "@/server/services/youtube-publish";
import { commentStats } from "@/server/youtube/write";
import { liveInstagramApi, liveThreadsApi, liveWriteApi } from "@/server/youtube/live";
import { syncInstagramComments } from "@/server/services/instagram";

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
  const results: unknown[] = [];
  const threadsResults = await dailyThreads();
  const instagramResults = await dailyInstagram();


  const products = !source ? [] : await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; slug: string; name: string; owner_id: string }>(
      `select s.product_id, s.workspace_id, p.slug, p.name,
              (select m.user_id from workspace_members m where m.workspace_id = s.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from yt_settings s join products p on p.id = s.product_id where s.enabled and p.status <> 'archived'`,
    ),
  );
  for (const p of products) {
    try {
      const stats = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily YouTube search" }, (tx) =>
        runDiscovery(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, source!),
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
  return NextResponse.json({ ran: results.length, results, youtube: source ? "ran" : "YOUTUBE_API_KEY is not set", threads: threadsResults, instagram: instagramResults });
}

/** Threads: search (when switched on), replies under our replies and posts, likes and views. Drafts only. */
async function dailyThreads() {
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; slug: string; name: string; owner_id: string }>(
      `select distinct c.product_id, c.workspace_id, p.slug, p.name,
              (select m.user_id from workspace_members m where m.workspace_id = c.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from channel_connections c join products p on p.id = c.product_id
        where c.channel = 'threads' and c.adapter_kind = 'official_api' and c.status = 'connected' and p.status <> 'archived'`,
    ),
  );
  const out = [];
  const api = liveThreadsApi();
  for (const p of products) {
    const actor = { workspaceId: p.workspace_id, userId: p.owner_id };
    try {
      const found = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily Threads search" }, async (tx) => {
        const s = await getThreadsSettings(tx, p.workspace_id, p.product_id);
        if (!s.enabled) return null;
        const live = await threadsApiSource(tx, p.product_id);
        return live ? runThreadsDiscovery(tx, actor, p.product_id, live.source, live.ownUsername) : null;
      });
      const replies = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily Threads replies check" }, (tx) => syncThreadsReplies(tx, actor, p.product_id, api));
      await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "daily Threads stats" }, (tx) => refreshThreadsStats(tx, actor, p.product_id, api)).catch(() => undefined);
      const drafts = (found?.draftsQueued ?? 0) + replies.fresh;
      if (replies.highRisk) await notifyTelegram(`${p.name}: someone on Threads may need urgent help. Please look now.\n${appUrl(`/p/${p.slug}/conversations?tab=threads`)}`, { urgent: true });
      else if (drafts) await notifyTelegram(`${p.name}: ${drafts} new Threads draft(s) wait for your approval.\n${appUrl(`/p/${p.slug}/conversations?tab=threads`)}`);
      out.push({ product: p.slug, found, replies });
    } catch (e) {
      out.push({ product: p.slug, error: (e as Error).message });
    }
  }
  return out;
}

/** Instagram: comments under our own reels, answers drafted for approval. */
async function dailyInstagram() {
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; slug: string; name: string; owner_id: string }>(
      `select distinct c.product_id, c.workspace_id, p.slug, p.name,
              (select m.user_id from workspace_members m where m.workspace_id = c.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from channel_connections c join products p on p.id = c.product_id
        where c.channel = 'instagram' and c.adapter_kind = 'official_api' and c.status = 'connected' and p.status <> 'archived'`,
    ),
  );
  const out = [];
  for (const p of products) {
    try {
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily Instagram comments check" }, (tx) =>
        syncInstagramComments(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, liveInstagramApi()),
      );
      if (r.highRisk) await notifyTelegram(`${p.name}: someone on Instagram may need urgent help. Please look now.\n${appUrl(`/p/${p.slug}/conversations?tab=instagram`)}`, { urgent: true });
      else if (r.fresh) await notifyTelegram(`${p.name}: ${r.fresh} new Instagram comment(s), answers drafted for your approval.\n${appUrl(`/p/${p.slug}/conversations?tab=instagram`)}`);
      out.push({ product: p.slug, ...r });
    } catch (e) {
      out.push({ product: p.slug, error: (e as Error).message });
    }
  }
  return out;
}

