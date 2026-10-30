"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, getAppContext, requireOwner, SPACE_COOKIE } from "@/server/context";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";
import { sendInviteEmail } from "@/server/auth/invite";
import { appUrl } from "@/server/notify/telegram";

async function inviteEmail(email: string) {
  const r = await sendInviteEmail(email, appUrl("/login")).catch((e: Error) => ({ sent: false, reason: e.message }));
  if (r.sent) return `An invitation email went to ${email} (from Supabase; ask them to check Spam too). The link in it signs them in; they see only this space.`;
  return `No email was sent (${r.reason}). Ask ${email} to open ${appUrl("/login")} and press “Send sign-in link” with this address. They will see only this space.`;
}

const msg = (x: unknown) => (x as Error).message;

/** A new space (for a project and the people who work on it). You become its owner and it opens. */
export async function createSpaceAction(_: ActionResult | null, data: FormData): Promise<ActionResult> {
  const name = str(data.get("name"));
  if (name.length < 2) return fail("Give the space a name, e.g. Momentro.");
  let ws = "";
  try {
    await requireOwner();
    ws = (await db((tx) => tx.one<{ ws: string }>("select public.create_space($1) as ws", [name]), { reason: `Space created: ${name}` })).ws;
  } catch (e) {
    return toFailure(e, msg);
  }
  (await cookies()).set(SPACE_COOKIE, ws, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/start");
}

/** Invite a colleague by email into this space only. They sign in with a link sent to that email. */
export async function inviteAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireOwner();
    const email = str(data.get("email")).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That does not look like an email address.");
    if (email === ctx.user.email.toLowerCase()) return fail("That is your own email.");
    const role = "editor";
    await db(async (tx) => {
      const open = await tx.maybeOne("select 1 from workspace_invites where workspace_id = $1 and email = $2 and revoked_at is null", [ctx.workspaceId, email]);
      if (open) throw new Error("This person is already invited to this space.");
      await tx.query("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1,$2,$3,$4)", [ctx.workspaceId, email, role, ctx.user.id]);
    }, { reason: `Invited ${email} to the space as ${role}` });
    revalidatePath(`/p/${slug}/team`);
    return ok(`Invited. ${await inviteEmail(email)}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

/** Sends the invitation email again to someone invited who has not signed in yet. */
export async function resendInviteAction(slug: string, id: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const ctx = await requireOwner();
    const inv = await db((tx) => tx.maybeOne<{ email: string }>("select email from workspace_invites where id = $1 and workspace_id = $2 and revoked_at is null and accepted_at is null", [id, ctx.workspaceId]));
    if (!inv) return fail("This invitation is already used or taken back.");
    return ok(await inviteEmail(inv.email));
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function revokeInviteAction(slug: string, id: string) {
  const ctx = await requireOwner();
  await db(async (tx) => {
    const inv = await tx.maybeOne<{ email: string }>("update workspace_invites set revoked_at = now() where id = $1 and workspace_id = $2 returning email", [id, ctx.workspaceId]);
    // Taking back an accepted invite also removes the person from this space.
    if (inv) await tx.query("delete from workspace_members m using users u where m.user_id = u.id and m.workspace_id = $1 and lower(u.email) = $2 and m.role <> 'owner'", [ctx.workspaceId, inv.email]);
  }, { reason: "Invite taken back" });
  revalidatePath(`/p/${slug}/team`);
}

export async function switchSpaceAction(spaceId: string) {
  const ctx = await getAppContext();
  if (!ctx.spaces.some((s) => s.workspace_id === spaceId)) return;
  (await cookies()).set(SPACE_COOKIE, spaceId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}
