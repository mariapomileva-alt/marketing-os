import { NextResponse, type NextRequest } from "next/server";
import { withContext } from "@/server/db/client";
import { rendererProduct } from "@/server/services/calm";
import { claimReelJob } from "@/server/services/content-desk";
import { fileStore } from "@/server/storage";

/**
 * The GitHub renderer asks for the next Reel to make (Bearer = the renderer key from Calm Videos). Returns the Reel's
 * script and a one-time upload link for the finished file. Nothing here publishes anything.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("mosr_")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await withContext({ userId: null, role: "service", actorType: "system", reason: "Reel render job" }, async (tx) => {
    const productId = await rendererProduct(tx, token);
    if (!productId) return { authorized: false as const };
    return { authorized: true as const, job: await claimReelJob(tx, productId) };
  });
  if (!r.authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!r.job) return new NextResponse(null, { status: 204 });
  const upload = await fileStore().signedUploadUrl(r.job.storageKey);
  if (!upload) return NextResponse.json({ error: "Reels need Supabase storage." }, { status: 500 });
  return NextResponse.json({ ...r.job, upload_url: upload });
}
