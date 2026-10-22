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

  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (process.env.AUTH_MODE === "dev" || !url || !key) return NextResponse.next();

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

export const config = {
  matcher: ["/((?!login|auth/callback|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
