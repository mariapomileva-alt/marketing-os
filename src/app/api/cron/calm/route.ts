import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { createCalmVideo, videosInPipeline } from "@/server/services/calm";
import { liveCalmMedia } from "@/server/calm/live";
import { syncBlog } from "@/server/services/blog";

/** Daily (Vercel Cron, see vercel.json): reads our blog into knowledge, writes and prepares calm videos. Nothing is published here. */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Blog first, so a new article can already become today's calm video topic.
  const blog = await dailyBlog();
  return NextResponse.json({ blog, calm: await dailyCalm() });
}

/** Calm videos: keep two in the pipeline (one new script per day at most). Each still needs the owner's approval. */
async function dailyCalm() {
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; owner_id: string; slug: string }>(
      `select s.product_id, s.workspace_id, p.slug,
              (select m.user_id from workspace_members m where m.workspace_id = s.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from calm_settings s join products p on p.id = s.product_id
        where s.enabled and p.status <> 'archived' and (s.last_created_at is null or s.last_created_at < now() - interval '20 hours')`,
    ),
  );
  const out = [];
  for (const p of products) {
    try {
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily calm video" }, async (tx) => {
        if ((await videosInPipeline(tx, p.product_id)) >= 2) return { skipped: "two videos already in the pipeline" };
        return createCalmVideo(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, await liveCalmMedia(p.workspace_id));
      });
      out.push({ product: p.slug, ...r });
    } catch (e) {
      out.push({ product: p.slug, error: (e as Error).message });
    }
  }
  return out;
}

async function dailyBlog() {
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string; workspace_id: string; slug: string; owner_id: string }>(
      `select s.product_id, s.workspace_id, p.slug,
              (select m.user_id from workspace_members m where m.workspace_id = s.workspace_id and m.role = 'owner' order by m.created_at limit 1) owner_id
         from site_settings s join products p on p.id = s.product_id where s.domain is not null and p.status <> 'archived'`,
    ),
  );
  const out = [];
  for (const p of products) {
    try {
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily blog read" }, (tx) =>
        syncBlog(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.product_id, (url) => fetch(url, { cache: "no-store" }), { draft: true, max: 2 }),
      );
      out.push({ product: p.slug, ...r });
    } catch (e) {
      out.push({ product: p.slug, error: (e as Error).message });
    }
  }
  return out;
}
