import { NextResponse, type NextRequest } from "next/server";
import { getAppContext, getProduct } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";
import { authUrl, newNonce, oauthConfigured, signState } from "@/server/youtube/write";

/** Sends the signed-in owner to Google to let Marketing OS post as the product's YouTube channel. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("product") ?? "";
  // Google allows only the registered return address, so the whole round trip happens on the main address.
  const main = new URL(appUrl());
  if (request.nextUrl.host !== main.host && !request.nextUrl.host.startsWith("localhost")) {
    return NextResponse.redirect(appUrl(`/api/youtube/oauth/start?product=${encodeURIComponent(slug)}`));
  }
  const product = await getProduct(slug); // requires sign-in; 404 for products outside the workspace
  // Connecting an account is the owner's; editors are sent back.
  if ((await getAppContext()).role !== "owner") return NextResponse.redirect(appUrl(`/p/${slug}/connections`));
  if (!oauthConfigured()) {
    return NextResponse.redirect(appUrl(`/p/${slug}/connections?yt=not_configured`));
  }
  const nonce = newNonce();
  const res = NextResponse.redirect(authUrl(signState({ productId: product.id, slug, nonce }), appUrl("/api/youtube/oauth/callback")));
  res.cookies.set("yt_oauth_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/youtube/oauth", maxAge: 900 });
  return res;
}
