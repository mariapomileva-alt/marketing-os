import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withContext } from "@/server/db/client";
import { finishRender } from "@/server/services/calm";
import { appUrl, notifyTelegram } from "@/server/notify/telegram";

/** The renderer reports back: the private YouTube video id, or what went wrong. */
const Body = z.object({ id: z.string().uuid(), youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/).optional(), error: z.string().max(2000).optional(), seconds: z.number().optional(), renderUrl: z.string().url().regex(/^https:\/\/github\.com\//).optional(), preview: z.boolean().optional() });

export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!token.startsWith("mosr_") || !parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const ok = await withContext({ userId: null, role: "service", actorType: "system", reason: "calm video render finished" }, (tx) => finishRender(tx, token, parsed.data.id, parsed.data));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = await withContext({ userId: null, role: "service" }, (tx) =>
    tx.maybeOne<{ slug: string; name: string }>("select p.slug, p.name from calm_videos v join products p on p.id = v.product_id where v.id = $1", [parsed.data.id]),
  );
  if (p) {
    await notifyTelegram(parsed.data.youtubeVideoId
      ? `${p.name}: a new calm video is ready to watch (private on YouTube). Approve it to schedule.\n${appUrl(`/p/${p.slug}/calm`)}`
      : `${p.name}: a calm video failed to render. ${parsed.data.error?.slice(0, 200) ?? ""}\n${appUrl(`/p/${p.slug}/calm`)}`);
  }
  return NextResponse.json({ ok: true });
}
