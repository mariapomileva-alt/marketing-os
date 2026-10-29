import { NextResponse, type NextRequest } from "next/server";
import { getAppContext, SPACE_COOKIE } from "@/server/context";
import { appUrl } from "@/server/notify/telegram";

/** Switch to another of your spaces, then go on to a page inside the app. */
export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  const space = request.nextUrl.searchParams.get("space") ?? "";
  const toRaw = request.nextUrl.searchParams.get("to") ?? "/";
  const to = toRaw.startsWith("/") && !toRaw.startsWith("//") ? toRaw : "/";
  const res = NextResponse.redirect(appUrl(to));
  if (ctx.spaces.some((s) => s.workspace_id === space)) {
    res.cookies.set(SPACE_COOKIE, space, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}
