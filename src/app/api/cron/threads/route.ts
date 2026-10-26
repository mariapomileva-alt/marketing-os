import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { generateThreadsPosts, getStudioSettings } from "@/server/services/threads-studio";
import { refreshStudioStatsLive } from "@/server/services/threads-studio-live";
import { appUrl, notifyTelegram } from "@/server/notify/telegram";

/**
 * Every morning (Vercel Cron, see vercel.json), before the brief: today's Threads posts, written and reviewed, waiting
 * for the owner's approval. Nothing is posted here; approved posts go out from the posting queue at their slot.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ id: string; workspace_id: string; slug: string; owner_id: string }>(
      `select p.id, p.workspace_id, p.slug,
              (select m.user_id from workspace_members m where m.workspace_id = p.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from products p where p.status <> 'archived' and not p.is_demo
          and exists (select 1 from channel_connections c where c.product_id = p.id and c.channel = 'threads' and c.status in ('connected', 'paused'))`,
    ),
  );
  const out = [];
  for (const p of products) {
    const actor = { workspaceId: p.workspace_id, userId: p.owner_id };
    try {
      const stats = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "Threads reactions" }, (tx) => refreshStudioStatsLive(tx, p.id, 40)).catch((e) => ({ error: (e as Error).message }));
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily Threads posts" }, async (tx) => {
        const s = await getStudioSettings(tx, p.workspace_id, p.id);
        if (!s.enabled) return { skipped: "Threads Studio is off" };
        // Only when the queue is short, so drafts never pile up.
        const waiting = (await tx.one<{ n: number }>(
          "select count(*)::int n from threads_studio_posts m join content_items i on i.id = m.content_item_id where m.product_id = $1 and i.status in ('needs_human_review', 'draft')",
          [p.id],
        )).n;
        if (waiting >= s.posts_per_day * 3) return { skipped: `${waiting} posts already wait for approval` };
        return generateThreadsPosts(tx, actor, p.id);
      });
      if ("created" in r && r.created.some((c) => c.status === "waiting")) {
        await notifyTelegram(`${r.created.filter((c) => c.status === "waiting").length} Threads post(s) for today wait for your approval.\n${appUrl(`/p/${p.slug}/threads`)}`).catch(() => undefined);
      }
      out.push({ product: p.slug, stats, ...r });
    } catch (e) {
      out.push({ product: p.slug, error: (e as Error).message.slice(0, 300) });
    }
  }
  return NextResponse.json({ threads: out });
}
