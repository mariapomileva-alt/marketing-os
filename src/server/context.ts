import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { notFound } from "next/navigation";
import { withContext, type Tx } from "@/server/db/client";
import { requireUser, type SessionUser } from "@/server/auth/session";

export interface AppContext {
  user: SessionUser;
  workspaceId: string;
}

/** Resolves the signed-in user and their workspace (created on first sign-in). Cached per request. */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  const ws = await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
    tx.one<{ ws: string }>("select public.bootstrap_owner($1, $2, 'My workspace') as ws", [user.id, user.email]),
  );
  return { user, workspaceId: ws.ws };
});

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

export const listProducts = cache(async (): Promise<ProductRow[]> =>
  db((tx, ctx) =>
    tx.query<ProductRow>(
      "select id, workspace_id, slug, name, short_description, status, is_demo from products where workspace_id = $1 and status <> 'archived' order by created_at",
      [ctx.workspaceId],
    ),
  ),
);

export const getProduct = cache(async (slug: string): Promise<ProductRow> => {
  const p = (await listProducts()).find((x) => x.slug === slug);
  if (!p) notFound();
  return p;
});
