import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { generateDesk, getDeskSettings } from "@/server/services/content-desk";
import { liveDeskMedia } from "@/server/desk/live";
import { appUrl, notifyTelegram } from "@/server/notify/telegram";

/**
 * Every morning (Vercel Cron, see vercel.json): research → today's Instagram posts, carousels and article ideas, drawn
 * and checked, waiting for the owner's approval in Ideas & hooks. Nothing is published here.
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
         from products p where p.status <> 'archived' and not p.is_demo`,
    ),
  );
  const out = [];
  for (const p of products) {
    const actor = { workspaceId: p.workspace_id, userId: p.owner_id };
    try {
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "daily content desk" }, async (tx) => {
        const s = await getDeskSettings(tx, p.workspace_id, p.id);
        if (!s.enabled) return { skipped: "The content desk is off" };
        // Only when the desk is not already full, so drafts never pile up.
        const waiting = (await tx.one<{ n: number }>(
          "select count(*)::int n from content_desk_items d join content_items i on i.id = d.content_item_id where d.product_id = $1 and i.status in ('needs_human_review', 'draft')",
          [p.id],
        )).n;
        if (waiting >= (s.posts_per_day + s.carousels_per_day + s.reels_per_day) * 3 + 2) return { skipped: `${waiting} pieces already wait for approval` };
        return generateDesk(tx, actor, p.id, liveDeskMedia());
      });
      if ("created" in r && r.created.some((c) => c.status === "waiting")) {
        await notifyTelegram(`Today's content desk: ${r.created.filter((c) => c.status === "waiting").length} piece(s) wait for your approval.\n${appUrl(`/p/${p.slug}/ideas`)}`).catch(() => undefined);
      }
      out.push({ product: p.slug, ...r });
    } catch (e) {
      out.push({ product: p.slug, error: (e as Error).message.slice(0, 300) });
    }
  }
  return NextResponse.json({ desk: out });
}
