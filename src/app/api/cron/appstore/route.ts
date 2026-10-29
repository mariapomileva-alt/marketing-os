import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withContext } from "@/server/db/client";
import { liveAscDeps } from "@/server/appstore/api";
import { syncAppStore } from "@/server/services/app-store";

/** Every morning (Vercel Cron, see vercel.json): read Apple's newest downloads reports for each connected app. Read-only. */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const products = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.query<{ product_id: string }>("select product_id from app_store_sync"),
  );
  const out = [];
  for (const p of products) {
    const r = await withContext({ userId: null, role: "service", actorType: "system", reason: "daily App Store downloads" }, (tx) => syncAppStore(tx, p.product_id, liveAscDeps));
    out.push({ product: p.product_id, ...r });
  }
  return NextResponse.json({ ok: true, out });
}
