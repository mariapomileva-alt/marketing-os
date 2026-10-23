import { NextResponse } from "next/server";
import { db, getProduct } from "@/server/context";
import { fileStore } from "@/server/storage";

/** Serves a private creative only to members of the workspace (RLS applies to the lookup). */
export async function GET(_req: Request, ctx: RouteContext<"/p/[product]/creatives/[assetId]">) {
  const { product: slug, assetId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(assetId)) return new NextResponse("Not found", { status: 404 });
  const product = await getProduct(slug);
  const asset = await db((tx) => tx.maybeOne<{ storage_path: string | null; mime_type: string | null }>("select storage_path, mime_type from creative_assets where id = $1 and product_id = $2", [assetId, product.id]));
  if (!asset?.storage_path) return new NextResponse("Not found", { status: 404 });
  // Video and music can be large: send a short-lived link to the private file instead of streaming it through here.
  if (/^(video|audio)\//.test(asset.mime_type ?? "")) {
    const url = await fileStore().signedUrl(asset.storage_path, 600);
    if (url) return NextResponse.redirect(url);
  }
  const bytes = await fileStore().get(asset.storage_path);
  return new NextResponse(Buffer.from(bytes), { headers: { "content-type": asset.mime_type ?? "application/octet-stream", "cache-control": "private, max-age=300" } });
}
