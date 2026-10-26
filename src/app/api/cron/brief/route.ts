import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { createBrief } from "@/server/services/brief";
import { briefVoice } from "@/server/services/brief-voice";
import { syncCalendarLive } from "@/server/services/calendar-live";

/** Every morning (Vercel Cron, see vercel.json), after the YouTube sync: calendar sync, then the owner's brief for each active product. Read-only. */
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
    // The calendar first: it mirrors what went out on the platforms, read-only.
    const calendar = await withContext({ userId: p.owner_id, role: "service", actorType: "system", reason: "calendar sync" }, (tx) => syncCalendarLive(tx, p.workspace_id, p.id)).catch((e) => ({ error: (e as Error).message.slice(0, 200) }));
    try {
      const r = await withContext({ userId: p.owner_id, role: "service", actorType: "ai", reason: "morning brief" }, async (tx) =>
        createBrief(tx, { workspaceId: p.workspace_id, userId: p.owner_id }, p.id, await briefVoice(p.workspace_id)),
      );
      out.push({ product: p.slug, id: r.id, calendar });
    } catch (e) {
      out.push({ product: p.slug, error: (e as Error).message.slice(0, 300), calendar });
    }
  }
  return NextResponse.json({ briefs: out });
}
