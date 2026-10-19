import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate: requests without any session cookie go to /login. Real verification happens on the
 * server in the data access layer (getAppContext) for every page and action.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.getAll().some((c) => c.name === "mos_dev_session" || c.name.startsWith("sb-"));
  if (!hasSession) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|auth/callback|_next/static|_next/image|favicon.ico).*)"],
};
