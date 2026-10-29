import { NextResponse, type NextRequest } from "next/server";
import { getAppContext, getProduct } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";
import { newNonce, signState } from "@/server/youtube/write";
import { threadsAuthUrl, threadsOauthConfigured } from "@/server/threads/api";

/** Sends the signed-in owner to Meta to let Marketing OS post approved texts as the product's Threads account. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("product") ?? "";
  const main = new URL(appUrl());
  if (request.nextUrl.host !== main.host && !request.nextUrl.host.startsWith("localhost")) {
    return NextResponse.redirect(appUrl(`/api/threads/oauth/start?product=${encodeURIComponent(slug)}`));
  }
  const product = await getProduct(slug);
  // Connecting an account is the owner's; editors are sent back with a note.
  if ((await getAppContext()).role !== "owner") return NextResponse.redirect(appUrl(`/p/${slug}/connections`));
  if (!threadsOauthConfigured()) return NextResponse.redirect(appUrl(`/p/${slug}/connections?th=not_configured`));
  const nonce = newNonce();
  const res = NextResponse.redirect(threadsAuthUrl(signState({ productId: product.id, slug, nonce }), appUrl("/api/threads/oauth/callback")));
  res.cookies.set("th_oauth_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/threads/oauth", maxAge: 900 });
  return res;
}
