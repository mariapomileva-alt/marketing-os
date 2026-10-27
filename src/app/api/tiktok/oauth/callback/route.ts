import { NextResponse, type NextRequest } from "next/server";
import { db, getProduct } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";
import { readState } from "@/server/youtube/write";
import { saveTikTokConnection } from "@/server/services/tiktok";
import { tiktokExchangeCode, tiktokMe } from "@/server/tiktok/api";

/** TikTok returns here. Tokens are encrypted and stored server-side; nothing is uploaded or posted. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const state = readState(q.get("state") ?? "", request.cookies.get("tt_oauth_nonce")?.value);
  if (!state) return NextResponse.redirect(appUrl("/?tt=bad_state"));
  const back = (status: string) => {
    const res = NextResponse.redirect(appUrl(`/p/${state.slug}/connections?tt=${encodeURIComponent(status)}`));
    res.cookies.delete({ name: "tt_oauth_nonce", path: "/api/tiktok/oauth" });
    return res;
  };
  if (q.get("error")) return back("denied");
  try {
    const product = await getProduct(state.slug);
    if (product.id !== state.productId) return back("bad_state");
    const t = await tiktokExchangeCode(q.get("code") ?? "", appUrl("/api/tiktok/oauth/callback"));
    const me = await tiktokMe(t.accessToken).catch(() => null);
    const label = me?.display_name ? me.display_name : "TikTok account";
    await db((tx, ctx) => saveTikTokConnection(tx, ctx.workspaceId, product.id, label, t), { reason: `TikTok account connected: ${label}` });
    return back("connected");
  } catch (e) {
    return back(`error:${(e as Error).message.slice(0, 160)}`);
  }
}
