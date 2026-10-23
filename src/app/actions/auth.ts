"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { devSignIn, passwordSignIn, sendMagicLink, signOut } from "@/server/auth/session";
import { fail, ok, type ActionResult } from "@/lib/action-result";

export async function devSignInAction() {
  await devSignIn();
  redirect("/");
}

export async function magicLinkAction(_: ActionResult | null, data: FormData): Promise<ActionResult> {
  const email = String(data.get("email") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Enter a valid email address.");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const r = await sendMagicLink(email, `${origin}/auth/callback`);
  return r.ok ? ok("Check your inbox for a sign-in link.") : fail(`Sign-in link was not sent: ${r.error}`);
}

export async function passwordSignInAction(_: ActionResult | null, data: FormData): Promise<ActionResult> {
  const email = String(data.get("email") ?? "").trim();
  const password = String(data.get("password") ?? "");
  if (!email || !password) return fail("Enter your email and password.");
  const r = await passwordSignIn(email, password);
  if (!r.ok) return fail(r.error ?? "Wrong email or password.");
  redirect("/");
}

export async function signOutAction() {
  await signOut();
  redirect("/login");
}
