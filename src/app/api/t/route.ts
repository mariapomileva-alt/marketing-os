import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withContext } from "@/server/db/client";
import { classifySource, deviceOf, isBot } from "@/domain/traffic";
import { encryptionKey } from "@/server/security/crypto";

/**
 * Public collector for the website counter (public/t.js). Accepts only known site keys, ignores bots, stores no IP:
 * the visitor hash mixes the day, so the same person cannot be followed across days.
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const s = (max: number) => z.string().max(max).nullish();
const Body = z.object({ k: z.string().regex(/^[a-f0-9]{16,40}$/), kind: z.enum(["pageview", "app_store_click"]), p: s(300), lp: s(300), r: s(500), us: s(80), um: s(80), uc: s(80), ut: s(80) });
const clean = (v: string | null | undefined) => (v ? v.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 60) || null : null);

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  const done = new NextResponse(null, { status: 204, headers: CORS });
  const ua = request.headers.get("user-agent");
  if (isBot(ua)) return done;
  const text = (await request.text()).slice(0, 4000);
  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(text));
  } catch {
    return done;
  }
  if (!parsed.success) return done;
  const b = parsed.data;
  await withContext({ userId: null, role: "service", actorType: "system" }, async (tx) => {
    const site = await tx.maybeOne<{ product_id: string; workspace_id: string; domain: string | null }>("select product_id, workspace_id, domain from site_settings where site_key = $1", [b.k]);
    if (!site) return;
    const { source, referrerHost } = classifySource({ utmSource: b.us, referrer: b.r, userAgent: ua, ownHost: site.domain });
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const day = new Date().toISOString().slice(0, 10);
    const visitor = createHash("sha256").update(`${day}|${ip}|${ua}|${site.product_id}|`).update(encryptionKey(1)).digest("base64url").slice(0, 22);
    await tx.query(
      `insert into site_events (workspace_id, product_id, kind, path, source, medium, campaign, content, referrer_host, visitor_hash, device, country, landing_path)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [site.workspace_id, site.product_id, b.kind, (b.p ?? "/").slice(0, 300), source, clean(b.um), clean(b.uc), clean(b.ut), referrerHost, visitor, deviceOf(ua), request.headers.get("x-vercel-ip-country"), (b.lp ?? b.p ?? "/").slice(0, 300)],
    );
  });
  return done;
}
