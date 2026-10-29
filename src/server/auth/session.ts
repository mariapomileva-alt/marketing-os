import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPool } from "@/server/db/client";
import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from "@/server/env";

/**
 * Authentication. Two modes:
 *  - "supabase": Supabase Auth (email + password, or email magic link). Used in every deployed environment.
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
  const allowed = allowedEmails();
  const email = (data.user.email ?? "").toLowerCase();
  if (allowed && !allowed.includes(email) && !(await isInvited(email))) return null;
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

/**
 * ALLOWED_EMAILS (comma-separated) lists who may use this deployment. A listed address gets an account on its
 * first sign-in link; anyone else can only sign in if an account was created for them in Supabase, and is refused
 * by the app when the list is set — even if they signed up through Supabase directly.
 */
export function allowedEmails(env: Record<string, string | undefined> = process.env): string[] | null {
  const list = (env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : null;
}

/** Someone an owner invited into a space (and not revoked) may sign in with a link, without being in ALLOWED_EMAILS. */
export async function isInvited(email: string) {
  if (!email) return false;
  const r = await getPool().query("select 1 from public.workspace_invites where email = $1 and revoked_at is null limit 1", [email.trim().toLowerCase()]);
  return (r.rowCount ?? 0) > 0;
}

export async function sendMagicLink(email: string, redirectTo: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await supabaseClient();
  const listed = (allowedEmails()?.includes(email.trim().toLowerCase()) ?? false) || (await isInvited(email));
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: listed } });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Email + password sign-in. The first password comes from OWNER_PASSWORD (set by the owner in the hosting settings,
 * at least 12 characters): when an allowed address signs in with exactly that password, the server sets it as the
 * account's Supabase password (creating the account if needed) and signs in. Supabase stores only a hash.
 */
export async function passwordSignIn(emailRaw: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const email = emailRaw.trim().toLowerCase();
  const allowed = allowedEmails();
  const owner = (process.env.OWNER_PASSWORD ?? "").trim();
  // Setup problems are named (they reveal nothing about accounts); a wrong email or password is not.
  if (!allowed) return { ok: false, error: "Password sign-in is not set up: ALLOWED_EMAILS is empty in the hosting settings." };
  if (!allowed.includes(email)) return { ok: false, error: "This email is not in ALLOWED_EMAILS in the hosting settings." };
  const supabase = await supabaseClient();
  const first = await supabase.auth.signInWithPassword({ email, password });
  if (!first.error) return { ok: true };

  if (owner.length < 12) return { ok: false, error: "Password sign-in is not set up: OWNER_PASSWORD is missing or shorter than 12 characters." };
  const typed = password.trim();
  const matches = typed.length === owner.length && timingSafeEqual(Buffer.from(typed), Buffer.from(owner));
  const serviceKey = supabaseServiceKey();
  const url = supabaseUrl();
  if (!matches) return { ok: false, error: "Wrong email or password." };
  if (!serviceKey || !url) return { ok: false, error: "Password sign-in is not set up: the Supabase service key is missing." };
  password = typed;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const existing = await getPool().query<{ id: string }>("select id from auth.users where lower(email) = $1 limit 1", [email]);
  const res = existing.rows[0]
    ? await admin.auth.admin.updateUserById(existing.rows[0].id, { password, email_confirm: true })
    : await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (res.error) return { ok: false, error: `Could not set the password: ${res.error.message}` };
  const second = await supabase.auth.signInWithPassword({ email, password });
  return second.error ? { ok: false, error: second.error.message } : { ok: true };
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
