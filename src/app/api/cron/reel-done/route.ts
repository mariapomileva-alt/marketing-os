import { NextResponse, type NextRequest } from "next/server";
import { withContext } from "@/server/db/client";
import { rendererProduct } from "@/server/services/calm";
import { finishReelRender } from "@/server/services/content-desk";

/** The renderer reports a finished Reel (or what went wrong). The owner then watches and approves it. */
export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("mosr_")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; storageKey?: string; error?: string };
  if (!body.id) return NextResponse.json({ error: "id missing" }, { status: 400 });
  const ok = await withContext({ userId: null, role: "service", actorType: "system", reason: "Reel rendered" }, async (tx) => {
    const productId = await rendererProduct(tx, token);
    if (!productId) return null;
    return finishReelRender(tx, productId, body.id!, { storageKey: body.storageKey, error: body.error });
  });
  if (ok === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok });
}
