import { NextResponse } from "next/server";
import { db, getProduct } from "@/server/context";
import { fileStore } from "@/server/storage";

/** The spoken brief, served from our own origin (so the page can draw the voice) and only to workspace members. */
export async function GET(_req: Request, ctx: RouteContext<"/p/[product]/overview/audio/[briefId]">) {
  const { product: slug, briefId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(briefId)) return new NextResponse("Not found", { status: 404 });
  const product = await getProduct(slug);
  const b = await db((tx) => tx.maybeOne<{ audio_path: string | null }>("select audio_path from daily_briefs where id = $1 and product_id = $2", [briefId, product.id]));
  if (!b?.audio_path) return new NextResponse("Not found", { status: 404 });
  const bytes = await fileStore().get(b.audio_path);
  return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "audio/mpeg", "content-length": String(bytes.byteLength), "cache-control": "private, max-age=3600" } });
}
