import { NextResponse, type NextRequest } from "next/server";
import { getAppContext, getProduct } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";
import { newNonce, signState } from "@/server/youtube/write";
import { tiktokAuthUrl, tiktokOauthConfigured } from "@/server/tiktok/api";

/** Sends the signed-in owner to TikTok to let God of Marketing upload approved calm shorts to the team's account. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("product") ?? "";
  const main = new URL(appUrl());
  if (request.nextUrl.host !== main.host && !request.nextUrl.host.startsWith("localhost")) {
    return NextResponse.redirect(appUrl(`/api/tiktok/oauth/start?product=${encodeURIComponent(slug)}`));
  }
  const product = await getProduct(slug);
  // Connecting an account is the owner's; editors are sent back with a note.
  if ((await getAppContext()).role !== "owner") return NextResponse.redirect(appUrl(`/p/${slug}/connections`));
  if (!tiktokOauthConfigured()) return NextResponse.redirect(appUrl(`/p/${slug}/connections?tt=not_configured`));
  const nonce = newNonce();
  const res = NextResponse.redirect(tiktokAuthUrl(signState({ productId: product.id, slug, nonce }), appUrl("/api/tiktok/oauth/callback")));
  res.cookies.set("tt_oauth_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/tiktok/oauth", maxAge: 900 });
  return res;
}
