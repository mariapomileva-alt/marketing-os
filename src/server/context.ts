import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { withContext, type Tx } from "@/server/db/client";
import { requireUser, type SessionUser } from "@/server/auth/session";

export interface Space { workspace_id: string; name: string; role: "owner" | "editor" | "viewer" }
export interface AppContext {
  user: SessionUser;
  workspaceId: string;
  role: Space["role"];
  spaces: Space[];
}
export const SPACE_COOKIE = "mos_space";

/**
 * Resolves the signed-in user and the space they work in now (cookie, else their first). Invites for their email are
 * accepted here; someone with no space and no invite gets their own (first sign-in). Cached per request.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  const spaces = await withContext({ userId: null, role: "service", actorType: "system" }, async (tx) => {
    if (user.email) await tx.query("select public.accept_invites($1, $2)", [user.id, user.email]);
    await tx.one("select public.bootstrap_owner($1, $2, 'My workspace') as ws", [user.id, user.email]);
    return tx.query<Space>(
      "select m.workspace_id, w.name, m.role from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 order by m.created_at",
      [user.id],
    );
  });
  const wanted = (await cookies()).get(SPACE_COOKIE)?.value;
  const active = spaces.find((s) => s.workspace_id === wanted) ?? spaces[0];
  return { user, workspaceId: active.workspace_id, role: active.role, spaces };
});

/** Keys, tokens and account connections are the owner's: editors get a clear refusal. */
export async function requireOwner() {
  const ctx = await getAppContext();
  if (ctx.role !== "owner") throw new Error("Only the owner of this space can connect or disconnect accounts and keys.");
  return ctx;
}

/** Runs queries as the signed-in user: RLS applies to every statement. */
export async function db<T>(fn: (tx: Tx, ctx: AppContext) => Promise<T>, opts: { reason?: string; agentRunId?: string; actorType?: "user" | "ai" } = {}): Promise<T> {
  const ctx = await getAppContext();
  return withContext(
    { userId: ctx.user.id, role: "authenticated", actorType: opts.actorType ?? "user", requestId: randomUUID(), reason: opts.reason, agentRunId: opts.agentRunId },
    (tx) => fn(tx, ctx),
  );
}

export interface ProductRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  short_description: string;
  status: string;
  is_demo: boolean;
}

/** Products of the space you work in now. */
export const listProducts = cache(async (): Promise<ProductRow[]> => {
  const ctx = await getAppContext();
  return (await listAllProducts()).filter((p) => p.workspace_id === ctx.workspaceId);
});

/** Products of every space you belong to (for the switcher). */
export const listAllProducts = cache(async (): Promise<ProductRow[]> =>
  db((tx, ctx) =>
    tx.query<ProductRow>(
      "select id, workspace_id, slug, name, short_description, status, is_demo from products where workspace_id = any($1) and status <> 'archived' order by created_at",
      [ctx.spaces.map((s) => s.workspace_id)],
    ),
  ),
);

/**
 * A product of the space you work in. A product of another of your spaces switches the space first (so every write
 * goes to the right space).
 */
export const getProduct = cache(async (slug: string): Promise<ProductRow> => {
  const ctx = await getAppContext();
  const all = await listAllProducts();
  const p = all.find((x) => x.slug === slug && x.workspace_id === ctx.workspaceId);
  if (p) return p;
  const other = all.find((x) => x.slug === slug);
  if (other) redirect(`/switch?space=${other.workspace_id}&to=${encodeURIComponent(`/p/${slug}`)}`);
  notFound();
});
