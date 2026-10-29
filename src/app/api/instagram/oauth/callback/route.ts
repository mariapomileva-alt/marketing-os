import { NextResponse, type NextRequest } from "next/server";
import { db, getProduct } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";
import { saveTokenConnection } from "@/server/services/youtube-publish";
import { readState } from "@/server/youtube/write";
import { INSTAGRAM_SCOPES, instagramExchangeCode, instagramMe } from "@/server/instagram/api";

/** Instagram returns here. The long-lived token is encrypted and stored server-side; nothing is posted. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const state = readState(q.get("state") ?? "", request.cookies.get("ig_oauth_nonce")?.value);
  if (!state) return NextResponse.redirect(appUrl("/?ig=bad_state"));
  const back = (status: string) => {
    const res = NextResponse.redirect(appUrl(`/p/${state.slug}/connections?ig=${encodeURIComponent(status)}`));
    res.cookies.delete({ name: "ig_oauth_nonce", path: "/api/instagram/oauth" });
    return res;
  };
  if (q.get("error")) return back("denied");
  try {
    const product = await getProduct(state.slug);
    if (product.id !== state.productId) return back("bad_state");
    const t = await instagramExchangeCode((q.get("code") ?? "").replace(/#_$/, ""), appUrl("/api/instagram/oauth/callback"));
    const me = await instagramMe(t.accessToken);
    await db((tx, ctx) => saveTokenConnection(tx, ctx.workspaceId, product.id, "instagram", { id: me.user_id ?? me.id ?? t.userId, label: `@${me.username}` }, t.accessToken, t.expiresAt, t.granted ?? INSTAGRAM_SCOPES), { reason: `Instagram account connected: @${me.username}` });
    return back("connected");
  } catch (e) {
    return back(`error:${(e as Error).message.slice(0, 160)}`);
  }
}
