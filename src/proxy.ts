import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/server/env";

/**
 * Cheap gate: requests without any session cookie go to /login. Real verification happens on the
 * server in the data access layer (getAppContext) for every page and action.
 * With Supabase Auth the proxy also refreshes the session, because pages cannot write cookies:
 * without this a signed-in owner would be sent back to /login when the access token expires (1 hour).
 */
export async function proxy(request: NextRequest) {
  const hasSession = request.cookies.getAll().some((c) => c.name === "mos_dev_session" || c.name.startsWith("sb-"));
  if (!hasSession) return NextResponse.redirect(new URL("/login", request.url));
  // The page path tells the server which project (and so which space) a request works in, also for server actions.
  request.headers.set("x-mos-path", spacePath(request));

  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (process.env.AUTH_MODE === "dev" || !url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", request.url));
  return response;
}

/**
 * The path that names the project of a request. Account connections run outside /p/…: their start link carries
 * ?product=<slug>, their callback carries it inside the signed state (read here only to pick among the user's own
 * spaces; the route itself checks the signature).
 */
export function spacePath(request: Pick<NextRequest, "nextUrl">) {
  const { pathname, searchParams } = request.nextUrl;
  const m = /^\/api\/(instagram|threads|tiktok|youtube)\/oauth\/(start|callback)$/.exec(pathname);
  if (!m) return pathname;
  let slug = searchParams.get("product") ?? "";
  if (m[2] === "callback") {
    try {
      const body = (searchParams.get("state") ?? "").split(".")[0];
      slug = String((JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { slug?: string }).slug ?? "");
    } catch { slug = ""; }
  }
  return /^[a-z0-9][a-z0-9-]{1,47}$/.test(slug) ? `/p/${slug}` : pathname;
}

export const config = {
  matcher: ["/((?!login|legal|brand/|auth/callback|api/cron|api/t$|t\\.js$|tiktok[A-Za-z0-9]+\\.txt$|_next/static|_next/image|favicon.ico).*)"],
};
