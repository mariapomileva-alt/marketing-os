import { NextResponse, type NextRequest } from "next/server";
import { db, getProduct } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";
import { saveYoutubeConnection } from "@/server/services/youtube-publish";
import { exchangeCode, myChannel, readState } from "@/server/youtube/write";

/** Google returns here. The token is encrypted and stored server-side; nothing is posted. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const state = readState(q.get("state") ?? "", request.cookies.get("yt_oauth_nonce")?.value);
  if (!state) return NextResponse.redirect(appUrl("/?yt=bad_state"));
  const back = (status: string) => {
    const res = NextResponse.redirect(appUrl(`/p/${state.slug}/connections?yt=${encodeURIComponent(status)}`));
    res.cookies.delete({ name: "yt_oauth_nonce", path: "/api/youtube/oauth" });
    return res;
  };
  if (q.get("error")) return back("denied");
  try {
    const product = await getProduct(state.slug);
    if (product.id !== state.productId) return back("bad_state");
    const tokens = await exchangeCode(q.get("code") ?? "", appUrl("/api/youtube/oauth/callback"));
    const channel = await myChannel(tokens.accessToken);
    await db((tx, ctx) => saveYoutubeConnection(tx, ctx.workspaceId, product.id, channel, tokens.refreshToken), { reason: `YouTube channel connected: ${channel.title}` });
    return back("connected");
  } catch (e) {
    return back(`error:${(e as Error).message.slice(0, 160)}`);
  }
}
