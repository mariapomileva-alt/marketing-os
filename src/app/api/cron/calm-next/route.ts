import { NextResponse, type NextRequest } from "next/server";
import { withContext } from "@/server/db/client";
import { claimRenderJob } from "@/server/services/calm";
import { refreshTokenFor, youtubeConnection } from "@/server/services/youtube-publish";
import { accessToken, createUploadSession } from "@/server/youtube/write";
import { fileStore } from "@/server/storage";
import { taggedUrl } from "@/domain/traffic";

/**
 * The GitHub renderer asks for the next calm video (Bearer = the renderer key shown once in Marketing OS).
 * Returns the script, short-lived links to the voice files and footage, and a YouTube upload session for a PRIVATE
 * video. Nothing here makes anything public.
 */
export const maxDuration = 60;
const FONT_URL = "https://github.com/google/fonts/raw/main/ofl/lora/Lora%5Bwght%5D.ttf";

export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("mosr_")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claimed = await withContext({ userId: null, role: "service", actorType: "system", reason: "calm video render job" }, (tx) => claimRenderJob(tx, token));
  if (!claimed.authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = claimed.job;
  if (!job) return new NextResponse(null, { status: 204 });
  try {
    const { conn, domain } = await withContext({ userId: null, role: "service", actorType: "system" }, async (tx) => ({
      conn: await youtubeConnection(tx, claimed.productId),
      domain: (await tx.maybeOne<{ domain: string | null }>("select domain from site_settings where product_id = $1", [claimed.productId]))?.domain ?? null,
    }));
    if (!conn?.secret_id || conn.status !== "connected") throw new Error("The YouTube channel is not connected (Connections → Connect YouTube channel).");
    const link = domain ? taggedUrl(`https://${domain}/`, { source: "youtube", medium: "video", key: "calm_video" }) : "";
    const credits = [...new Set(job.clips.filter((c) => c.source === "pexels").map((c) => c.author))].slice(0, 6).join(", ");
    const description = `${job.description.replace(/LINK/g, link)}${credits ? `\n\nFootage: ${credits} (Pexels).` : ""}\nVoice: AI-generated.`.slice(0, 4900);
    const yt = await accessToken(await refreshTokenFor(conn.secret_id));
    const uploadUrl = await createUploadSession(yt, { title: job.title, description, tags: job.tags });
    const store = fileStore();
    const lines = [];
    for (const [i, l] of job.lines.entries()) {
      const url = await store.signedUrl(job.audio_keys[i], 3 * 3600);
      if (!url) throw new Error("Voice files need Supabase storage for the renderer to read them.");
      lines.push({ text: l.text, pause: l.pause, audio_url: url });
    }
    const clips = [];
    for (const c of job.clips) {
      if (c.source === "pexels") clips.push({ url: c.url, kind: "video" });
      else {
        const p = job.libraryPaths[c.asset_id];
        const url = p ? await store.signedUrl(p, 3 * 3600) : null;
        if (url) clips.push({ url, kind: c.kind });
      }
    }
    const music_url = job.music_path ? await store.signedUrl(job.music_path, 3 * 3600) : null;
    return NextResponse.json({ id: job.id, title: job.title, minutes: job.minutes, lines, clips, music_url, upload_url: uploadUrl, font_url: FONT_URL });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 400);
    await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
      tx.query("update calm_videos set status = 'failed', error = $2 where id = $1", [job.id, `Could not start rendering: ${msg}`]),
    );
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
