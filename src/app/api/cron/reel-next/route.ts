import { NextResponse, type NextRequest } from "next/server";
import { withContext } from "@/server/db/client";
import { rendererProduct } from "@/server/services/calm";
import { claimReelJob } from "@/server/services/content-desk";
import { fileStore } from "@/server/storage";
import { openaiKey } from "@/server/ai";
import { EXPLAIN_VOICE_INSTRUCTIONS, speak } from "@/server/calm/media";

/**
 * The GitHub renderer asks for the next Reel to make (Bearer = the renderer key from Calm Videos). Returns the Reel's
 * script and a one-time upload link for the finished file; for an explainer Reel also the voice (each step, read by
 * the calm-video voice). Nothing here publishes anything.
 */
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("mosr_")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await withContext({ userId: null, role: "service", actorType: "system", reason: "Reel render job" }, async (tx) => {
    const productId = await rendererProduct(tx, token);
    if (!productId) return { authorized: false as const };
    const job = await claimReelJob(tx, productId);
    const ctx = job ? await tx.one<{ workspace_id: string; voice: string | null }>(
      "select p.workspace_id, (select voice from calm_settings where product_id = p.id) voice from products p where p.id = $1", [productId]) : null;
    return { authorized: true as const, job, productId, ctx };
  });
  if (!r.authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!r.job) return new NextResponse(null, { status: 204 });
  const store = fileStore();
  const upload = await store.signedUploadUrl(r.job.storageKey);
  if (!upload) return NextResponse.json({ error: "Reels need Supabase storage." }, { status: 500 });
  let voice_urls: string[] | null = null;
  const spec = r.job.spec as { format?: string; intro_lines?: string[]; steps?: Array<{ title: string; text?: string }> };
  if (spec.format === "explain" && r.ctx) {
    // Voice for an explainer: the hook first, then each step (title and sentence). Without an OpenAI key, music only.
    const key = await openaiKey(r.ctx.workspace_id).catch(() => null);
    if (key) {
      try {
        // The hook is on screen; the voice reads the steps (title and sentence), so the first picture moves on quickly.
        const texts = (spec.steps ?? []).map((s) => `${s.title}. ${s.text ?? ""}`.trim());
        voice_urls = [];
        for (const [i, text] of texts.entries()) {
          const k = r.job.storageKey.replace(/\.mp4$/, `-voice-${i}.mp3`);
          await store.put(k, await speak(key, text, r.ctx.voice ?? "sage", fetch, EXPLAIN_VOICE_INSTRUCTIONS, 1.12), "audio/mpeg");
          voice_urls.push((await store.signedUrl(k, 3 * 3600))!);
        }
      } catch {
        voice_urls = null;
      }
    }
  }
  return NextResponse.json({ ...r.job, upload_url: upload, voice_urls });
}
