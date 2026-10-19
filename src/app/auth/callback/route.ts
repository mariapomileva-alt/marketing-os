import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/server/auth/session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const okSession = code ? await exchangeCode(code) : false;
  return NextResponse.redirect(new URL(okSession ? "/" : "/login?error=link", request.url));
}
