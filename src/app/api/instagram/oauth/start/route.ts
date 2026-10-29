import { NextResponse, type NextRequest } from "next/server";
import { getAppContext, getProduct } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";
import { newNonce, signState } from "@/server/youtube/write";
import { instagramAuthUrl, instagramOauthConfigured } from "@/server/instagram/api";

/** Sends the signed-in owner to Meta to let Marketing OS post approved texts as the product's Instagram account. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("product") ?? "";
  const main = new URL(appUrl());
  if (request.nextUrl.host !== main.host && !request.nextUrl.host.startsWith("localhost")) {
    return NextResponse.redirect(appUrl(`/api/instagram/oauth/start?product=${encodeURIComponent(slug)}`));
  }
  const product = await getProduct(slug);
  // Connecting an account is the owner's; editors are sent back with a note.
  if ((await getAppContext()).role !== "owner") return NextResponse.redirect(appUrl(`/p/${slug}/connections`));
  if (!instagramOauthConfigured()) return NextResponse.redirect(appUrl(`/p/${slug}/connections?ig=not_configured`));
  const nonce = newNonce();
  const res = NextResponse.redirect(instagramAuthUrl(signState({ productId: product.id, slug, nonce }), appUrl("/api/instagram/oauth/callback")));
  res.cookies.set("ig_oauth_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/instagram/oauth", maxAge: 900 });
  return res;
}
