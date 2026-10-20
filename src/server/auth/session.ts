import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPool } from "@/server/db/client";
import { supabaseAnonKey, supabaseUrl } from "@/server/env";

/**
 * Authentication. Two modes:
 *  - "supabase": Supabase Auth (email magic link). Used in every deployed environment.
 *  - "dev": a single local owner without email, for local development and tests only.
 *    Refused when NODE_ENV=production. The UI shows a visible "Development sign-in" banner.
 */
export interface SessionUser {
  id: string;
  email: string;
  mode: "supabase" | "dev";
}

const DEV_COOKIE = "mos_dev_session";
const DEV_EMAIL = "owner@local.dev";

export function authMode(): "supabase" | "dev" {
  const mode = process.env.AUTH_MODE === "dev" ? "dev" : "supabase";
  if (mode === "dev" && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_MODE=dev is not allowed in production");
  }
  return mode;
}

function sign(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters)");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

async function supabaseClient() {
  const store = await cookies();
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) throw new Error("Supabase URL and anon key are required when AUTH_MODE=supabase");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Called from a Server Component: cookies are refreshed by the proxy instead.
        }
      },
    },
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  await connection(); // per-request only: never evaluated while building
  if (authMode() === "dev") {
    const raw = (await cookies()).get(DEV_COOKIE)?.value;
    if (!raw) return null;
    const [id, mac] = raw.split(".");
    if (!id || !mac) return null;
    const expected = Buffer.from(sign(id));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { id, email: DEV_EMAIL, mode: "dev" };
  }
  const supabase = await supabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "", mode: "supabase" };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Dev mode: ensure the local owner exists in auth.users and set the signed cookie. */
export async function devSignIn(): Promise<void> {
  if (authMode() !== "dev") throw new Error("Development sign-in is disabled");
  const pool = getPool();
  const existing = await pool.query<{ id: string }>("select id from auth.users where email = $1", [DEV_EMAIL]);
  const id = existing.rows[0]?.id ?? (await pool.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [DEV_EMAIL])).rows[0].id;
  (await cookies()).set(DEV_COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function sendMagicLink(email: string, redirectTo: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await supabaseClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function exchangeCode(code: string): Promise<boolean> {
  const supabase = await supabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return !error;
}

export async function signOut(): Promise<void> {
  if (authMode() === "dev") {
    (await cookies()).delete(DEV_COOKIE);
    return;
  }
  const supabase = await supabaseClient();
  await supabase.auth.signOut();
}

export const SESSION_COOKIE_NAMES = [DEV_COOKIE];
