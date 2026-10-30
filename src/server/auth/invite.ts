import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseServiceKey, supabaseUrl } from "@/server/env";

/**
 * Sends the invitation email (Supabase Auth "Invite user"): the link signs the person in on its own. Someone who
 * already has an account gets nothing new from Supabase; they sign in with "Send sign-in link" on the sign-in page.
 */
export async function sendInviteEmail(email: string, redirectTo: string): Promise<{ sent: boolean; reason?: string }> {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (process.env.AUTH_MODE === "dev" || !url || !key) return { sent: false, reason: "email sign-in is not set up on this deployment" };
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error) return { sent: true };
  if (/already been registered|already registered|exists/i.test(error.message)) return { sent: false, reason: "already has an account" };
  return { sent: false, reason: error.message };
}
